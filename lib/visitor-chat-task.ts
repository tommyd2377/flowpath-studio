import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { runVisitorTask } from './visitor-task-runner';
import { createVisitorRealtimeMailbox } from './visitor-realtime-mailbox';
import { validateVisitorContext, type VisitorContext } from './visitor-realtime-context';
import { parseWorkspaceReply, publishedWorkspace, workspaceInstructions, workspaceJsonSchema } from './visitor-workspace';
import { exploreSettings, exploreContextForResult } from './explore-model';
import { exploreVoiceTool, validateExploreVoice } from './explore-voice';
import { contextualSearchQuery, searchPlacement } from './explore-workspace';
import { visitorDiagnostic, diagnosticError } from './visitor-diagnostics';
import { authorizedExplore } from './explore-service';
import { visitorAccess } from './visitor-store';
import { assistantPurposeInstructions, type VisitorAvailability } from './visitor-model';
import type { SiteContent } from './site-model';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import type { VisitorRequest } from './visitor-request';
import type { VisitorChatEvent } from './visitor-chat-protocol';
import type { ProviderUsage } from './provider-usage';

/** A text task uses the existing publication-bound mailbox, never an audio session. */
export function visitorChatTask(options: { slug: string; siteId: string; content: SiteContent; catalog?: KnowledgeCatalog; media?: MediaLibrary; request: Extract<VisitorRequest, { kind: 'chat' }>; availability: VisitorAvailability; signal: AbortSignal; onUsage: (usage: ProviderUsage) => void }) {
  const lifecycle = new AbortController(), signal = AbortSignal.any([options.signal, lifecycle.signal]);
  const snapshot = JSON.stringify(options.content), expiresAt = Date.now() + 120_000;
  const timer = setTimeout(() => lifecycle.abort(), 120_000);
  let output: ReadableStreamDefaultController<Uint8Array>, closed = false;
  let context: VisitorContext = options.request.context ?? {};
  let acknowledge: { id: string; resolve: (status: string) => void } | undefined;
  const emit = (event: VisitorChatEvent) => { if (!closed) output.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`)); };
  async function assertCurrent() {
    signal.throwIfAborted();
    if (JSON.stringify((await visitorAccess(options.slug)).content) !== snapshot) throw new Error('The publication changed. Reload before continuing.');
  }
  async function work() {
    const mailbox = await createVisitorRealtimeMailbox({ slug: options.slug, siteId: options.siteId, publicationKey: createHash('sha256').update(snapshot).digest('hex'), expiresAt });
    const unsubscribe = mailbox.subscribe(update => {
      if (update.end) { lifecycle.abort(); return; }
      if (!acknowledge || update.navigationAck?.id !== acknowledge.id) return;
      context = validateVisitorContext(update.context, options.content, options.catalog, options.media);
      acknowledge.resolve(update.navigationAck.status);
    }, () => lifecycle.abort());
    try {
      emit({ type: 'control', control: mailbox.capability });
      const display = async (target: Extract<VisitorChatEvent, { type: 'navigation' }>['target']) => {
        await assertCurrent();
        const id = randomUUID();
        const status = await new Promise<string>((resolve, reject) => {
          const aborted = () => { clearTimeout(timeout); acknowledge = undefined; reject(new DOMException('Cancelled', 'AbortError')); };
          const timeout = setTimeout(() => { signal.removeEventListener('abort', aborted); acknowledge = undefined; reject(new Error('The browser did not acknowledge the requested view.')); }, 12_000);
          acknowledge = { id, resolve: value => { clearTimeout(timeout); signal.removeEventListener('abort', aborted); acknowledge = undefined; resolve(value); } };
          signal.addEventListener('abort', aborted, { once: true });
          if (signal.aborted) { aborted(); return; }
          emit({ type: 'navigation', id, target });
        });
        await assertCurrent();
        if (status !== 'applied') throw new Error('The browser did not apply the requested view.');
        return { status, currentView: context };
      };
      const tools = [{ type: 'function', name: 'update_workspace', description: 'Arrange published information or retained external results. Use exact references and the latest state returned by previous tools. Wait for browser acknowledgment.', parameters: workspaceJsonSchema() },
        ...(exploreSettings(options.content).enabled ? [exploreVoiceTool] : [])];
      const result = await runVisitorTask({ model: 'gpt-5.6-luna', channel: 'chat', apiKey: process.env.OPENAI_API_KEY?.trim() ?? '', signal,
        instructions: () => `${assistantPurposeInstructions(options.content)}\n${workspaceInstructions(context.workspace!, publishedWorkspace(options.content, options.catalog, options.media, context.externalResults), context.scene, options.request.text, options.catalog, options.media, 'tool')}`,
        context: { request: options.request.text, history: options.request.history, currentView: context }, tools, onUsage: options.onUsage,
        execute: async (name, args) => {
          await assertCurrent();
          if (name === 'update_workspace') {
            const reply = parseWorkspaceReply(JSON.parse(args), context.workspace!, publishedWorkspace(options.content, options.catalog, options.media, context.externalResults), context.scene);
            if (!reply.batch) return { data: { status: 'unavailable', message: reply.message }, directText: reply.message };
            return { data: await display({ kind: 'workspace', batch: reply.batch }) };
          }
          const requested = validateExploreVoice(JSON.parse(args), options.content, context.explore, context.workspace);
          if (!requested.search) return { data: await display({ kind: 'explore', command: requested.command }) };
          if (context.workspace) {
            searchPlacement(context.workspace, context.externalResults ?? [], requested.search.annotationTarget);
            requested.search.query = contextualSearchQuery(requested.search.query, context.workspace, publishedWorkspace(options.content, options.catalog, options.media), context.explore);
          }
          const { result: found } = await authorizedExplore(options.slug, { requestId: randomUUID(), ...requested.search }, signal, snapshot);
          const applied = await display({ kind: 'explore', result: found });
          return { data: { ...applied, evidence: { ...exploreContextForResult(found, found.kind, null), answer: found.answer, sources: found.sources, citations: found.citations } } };
        },
      });
      await assertCurrent(); emit({ type: 'done', text: result.text, availability: (await visitorAccess(options.slug)).availability });
    } finally { unsubscribe(); await mailbox.close(); }
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller;
      void work().catch(error => {
        visitorDiagnostic({ traceId: options.request.requestId, channel: 'server', stage: 'backend', operation: 'chat', status: signal.aborted ? 'cancelled' : 'failed', ...diagnosticError(error) });
        if (!signal.aborted) emit({ type: 'error', message: 'The task could not finish. Any confirmed views remain available.' }); }).finally(() => { clearTimeout(timer); if (!closed) { closed = true; controller.close(); } });
    },
    cancel() { closed = true; lifecycle.abort(); clearTimeout(timer); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
}
