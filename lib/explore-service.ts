import 'server-only';
import { AppError } from './errors';
import { visitorAccess } from './visitor-store';
import { demoExploreResult, exploreSettings, mapForQuery, type AnnotationTarget, type ExploreKind } from './explore-model';
import { getPublishedKnowledgeSnapshot } from './knowledge-store';
import { getPublishedMedia } from './media-store';
import { publishedWorkspace } from './visitor-workspace';
import { workspaceRecord } from '@thevoice/platform-ui/workspace';
import { searchExplore } from './explore-provider';
import { assertNoStripeTestPaidAi } from './billing-ai-guard';
import { recordPlatformEvent } from './platform-events';
import { visitorDiagnostic, diagnosticError } from './visitor-diagnostics';

/** Both HTTP and voice use the same transactional search allowance and publication checks. */
export async function authorizedExplore(slug: string, input: { query: string; kind: ExploreKind; requestId: string; annotationTarget?: AnnotationTarget }, signal: AbortSignal, expectedPublication?: string) {
  const startedAt = performance.now();
  visitorDiagnostic({ traceId: input.requestId, channel: 'server', stage: 'search', status: 'started', operation: input.kind });
  try {
  if (signal.aborted) throw new AppError('Search cancelled.', 499);
  const preview = await visitorAccess(slug);
  const settings = exploreSettings(preview.content);
  if (!settings.enabled || input.kind === 'images' && !settings.images || input.kind === 'map' && !settings.maps) throw new AppError('This search capability is not enabled on this published site.', 403);
  const snapshot = JSON.stringify(preview.content);
  if (expectedPublication && snapshot !== expectedPublication) throw new AppError('This site changed. Reload before searching.', 409);
  let subject: { name: string; summary?: string } | undefined;
  if (input.annotationTarget) {
    if (!settings.annotations || input.kind !== 'web') throw new AppError('Web additions are not enabled on this published site.', 403);
    const catalog = await getPublishedKnowledgeSnapshot(preview.siteId, preview.content.knowledgeRevisionId);
    const media = await getPublishedMedia(preview.siteId, preview.content.mediaRevisionId);
    const authority = publishedWorkspace(preview.content, catalog, media);
    const record = workspaceRecord(authority, input.annotationTarget.reference);
    if (authority.publicationId !== input.annotationTarget.publicationId || !record) throw new AppError('That card is not part of the current publication. Reload before searching.', 409);
    subject = { name: record.name, summary: record.body?.slice(0, 1200) };
  }
  if (preview.availability.live) await assertNoStripeTestPaidAi(preview.siteId);
  const reserved = await visitorAccess(slug, { requestId: input.requestId, kind: 'search' });
  if (signal.aborted) throw new AppError('Search cancelled.', 499);
  if (reserved.siteId !== preview.siteId || JSON.stringify(reserved.content) !== snapshot || reserved.availability.live !== preview.availability.live) throw new AppError('This site changed. Reload before searching.', 409);
  const observed = { surface: 'public' as const, kind: expectedPublication ? 'voice' as const : 'chat' as const, operationId: 'search_explore', requestId: input.requestId, count: 1 };
  const usesProvider = reserved.availability.live && !(input.kind === 'map' && mapForQuery(input.query));
  try {
    if (usesProvider) await recordPlatformEvent(reserved.siteId, { ...observed, type: 'provider_usage', status: 'reserved' }).catch(() => undefined);
    const found = reserved.availability.live ? await searchExplore(input.query, input.kind, settings, signal, {
      subject,
      onUsage: usage => { void recordPlatformEvent(reserved.siteId, { ...observed, type: 'provider_usage', status: usage ? 'confirmed' : 'unknown', ...(usage ? { usage } : {}) }).catch(() => undefined); },
    }) : demoExploreResult(input.query, input.kind);
    const result = input.annotationTarget ? { ...found, annotationTarget: input.annotationTarget } : found;
    const current = await visitorAccess(slug);
    if (JSON.stringify(current.content) !== snapshot || current.siteId !== preview.siteId) throw new AppError('This site changed while searching. Reload to continue.', 409);
    if (signal.aborted) throw new AppError('Search cancelled.', 499);
    visitorDiagnostic({ traceId: input.requestId, channel: 'server', stage: 'search', status: 'succeeded', operation: input.kind, durationMs: performance.now() - startedAt, images: result.images.length, sources: result.sources.length });
    return { result, searchRemaining: current.availability.searchRemaining };
  } catch (error) {
    visitorDiagnostic({ traceId: input.requestId, channel: 'server', stage: 'search', status: signal.aborted ? 'cancelled' : 'failed', operation: input.kind, durationMs: performance.now() - startedAt });
    if (usesProvider) await recordPlatformEvent(reserved.siteId, { ...observed, type: 'provider_usage', status: 'unknown' }).catch(() => undefined);
    throw error;
  }
  } catch (error) {
    visitorDiagnostic({ traceId: input.requestId, channel: 'server', stage: 'search', status: signal.aborted ? 'cancelled' : 'failed', durationMs: performance.now() - startedAt, ...diagnosticError(error) });
    throw error;
  }
}
