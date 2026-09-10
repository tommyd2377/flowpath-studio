import 'server-only';
import { AppError } from './errors';
import { visitorAccess } from './visitor-store';
import { demoExploreResult, exploreSettings, mapForQuery, type ExploreKind } from './explore-model';
import { searchExplore } from './explore-provider';
import { assertNoStripeTestPaidAi } from './billing-ai-guard';
import { recordPlatformEvent } from './platform-events';

/** Both HTTP and voice use the same transactional search allowance and publication checks. */
export async function authorizedExplore(slug: string, input: { query: string; kind: ExploreKind; requestId: string }, signal: AbortSignal, expectedPublication?: string) {
  if (signal.aborted) throw new AppError('Search cancelled.', 499);
  const preview = await visitorAccess(slug);
  const settings = exploreSettings(preview.content);
  if (!settings.enabled || input.kind === 'images' && !settings.images || input.kind === 'map' && !settings.maps) throw new AppError('This search capability is not enabled on this published site.', 403);
  const snapshot = JSON.stringify(preview.content);
  if (expectedPublication && snapshot !== expectedPublication) throw new AppError('This site changed. Reload before searching.', 409);
  if (preview.availability.live) await assertNoStripeTestPaidAi(preview.siteId);
  const reserved = await visitorAccess(slug, { requestId: input.requestId, kind: 'search' });
  if (signal.aborted) throw new AppError('Search cancelled.', 499);
  if (reserved.siteId !== preview.siteId || JSON.stringify(reserved.content) !== snapshot || reserved.availability.live !== preview.availability.live) throw new AppError('This site changed. Reload before searching.', 409);
  const observed = { surface: 'public' as const, kind: expectedPublication ? 'voice' as const : 'chat' as const, operationId: 'search_explore', requestId: input.requestId, count: 1 };
  const usesProvider = reserved.availability.live && !(input.kind === 'map' && mapForQuery(input.query));
  try {
    if (usesProvider) await recordPlatformEvent(reserved.siteId, { ...observed, type: 'provider_usage', status: 'reserved' }).catch(() => undefined);
    const result = reserved.availability.live ? await searchExplore(input.query, input.kind, settings, signal, {
      onUsage: usage => { void recordPlatformEvent(reserved.siteId, { ...observed, type: 'provider_usage', status: usage ? 'confirmed' : 'unknown', ...(usage ? { usage } : {}) }).catch(() => undefined); },
    }) : demoExploreResult(input.query, input.kind);
    const current = await visitorAccess(slug);
    if (JSON.stringify(current.content) !== snapshot || current.siteId !== preview.siteId) throw new AppError('This site changed while searching. Reload to continue.', 409);
    if (signal.aborted) throw new AppError('Search cancelled.', 499);
    return { result, searchRemaining: current.availability.searchRemaining };
  } catch (error) {
    if (usesProvider) await recordPlatformEvent(reserved.siteId, { ...observed, type: 'provider_usage', status: 'unknown' }).catch(() => undefined);
    throw error;
  }
}
