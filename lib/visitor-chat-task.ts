import { type VisitorWorkStage } from './visitor-progress';
import { navigationConfirmation } from './visitor-navigation';
import 'server-only';
import { activeCarouselImage } from './visitor-active-image';
import { carouselInstructions, carouselNavigationSchema, carouselNavigationTool } from './visitor-carousel-control';
import { demoWebsiteQuery } from './visitor-demo-query';
import { visitorTaskContext } from './visitor-task-context';
import { createHash, randomUUID } from 'node:crypto';
import { runVisitorTask } from './visitor-task-runner';
import { conversationWordLimit } from './voice-settings';
import { createVisitorTaskBridge, requiresWebsiteQuery } from './visitor-task-bridge';
import { createVisitorRealtimeMailbox } from './visitor-realtime-mailbox';
import { validateVisitorContext, type VisitorContext } from './visitor-realtime-context';
import { parseWorkspaceToolReply, publishedWorkspace, workspaceInstructions, workspaceToolJsonSchema } from './visitor-workspace';
import { exploreSettings, exploreContextForResult } from './explore-model';
import { exploreVoiceTool, validateExploreVoice } from './explore-voice';
import { contextualSearchQuery, searchPlacement } from './explore-workspace';
import { visitorDiagnostic, diagnosticError } from './visitor-diagnostics';
import { createVisitorResearchCache, completedSearchAnswer } from './visitor-research-cache';
import { publishedContentTool, readPublishedContent } from './visitor-published-content';
import { authorizedExplore } from './explore-service';
import { visitorAccess } from './visitor-store';
import { assistantPurposeInstructions, type VisitorAvailability } from './visitor-model';
import type { SiteContent } from './site-model';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import type { VisitorRequest } from './visitor-request';
import type { VisitorChatEvent } from './visitor-chat-protocol';
import type { ProviderUsage } from './provider-usage';
import { safeTestRecorder, type TestRecorder } from './visitor-test-events';

/** A text task uses the existing publication-bound mailbox, never an audio session. */
export function visitorChatTask(options: { record?: TestRecorder; preview?: boolean; slug: string; siteId: string; content: SiteContent; catalog?: KnowledgeCatalog; media?: MediaLibrary; request: Extract<VisitorRequest, { kind: 'chat' }>; availability: VisitorAvailability; signal: AbortSignal; onUsage: (usage: ProviderUsage) => void }) {
  const record = safeTestRecorder(options.record);
  const lifecycle = new AbortController(), signal = AbortSignal.any([options.signal, lifecycle.signal]);
  const snapshot = JSON.stringify(options.content), expiresAt = Date.now() + 120_000;
  const timer = setTimeout(() => lifecycle.abort(), 120_000);
  let output: ReadableStreamDefaultController<Uint8Array>, closed = false;
  let context: VisitorContext = options.request.context ?? {};
  let acknowledge: { id: string; resolve: (status: string) => void } | undefined;
  const emit = (event: VisitorChatEvent) => { if (!closed) { record({ type: 'chat.event', data: event }); output.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`)); } };
  const lookup = createVisitorResearchCache();
  let lastStage: VisitorWorkStage | undefined;
  const progress = (stage: VisitorWorkStage) => { if (!signal.aborted && stage !== lastStage) { lastStage = stage; emit({ type: 'progress', requestId: options.request.requestId, stage }); } };
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
      record({ type: 'screen.accepted', data: { context, navigationAck: update.navigationAck } });
      acknowledge.resolve(update.navigationAck.status);
    }, () => lifecycle.abort());
    try {
      emit({ type: 'control', control: mailbox.capability }); progress('working');
      const display = async (target: Extract<VisitorChatEvent, { type: 'navigation' }>['target']) => {
        await assertCurrent(); progress('displaying');
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
        progress('finishing');
        return { status, currentView: context };
      };
      const taskBridge = options.slug ? await createVisitorTaskBridge(options.slug, context.taskSession?.sessionId, async (query, kind, signal) => lookup(async (query, kind, signal) => (await authorizedExplore(options.slug, { query, kind, requestId: randomUUID(), parentTraceId: options.request.requestId }, signal, snapshot)).result, query, kind, signal), { onProgress: progress, request: options.request.text, traceId: options.request.requestId }) : null;
      const tools = [publishedContentTool, ...(context.carousel ? [carouselNavigationTool] : []), ...(taskBridge ? [taskBridge.tool] : []), { type: 'function', name: 'update_workspace', description: 'Arrange published information or retained external results. Use exact references and the latest state returned by previous tools. Wait for browser acknowledgment.', parameters: workspaceToolJsonSchema() },
        ...(exploreSettings(options.content).enabled ? [exploreVoiceTool] : [])];
      let previewRound = 0;
      const previewFetch: typeof fetch = async () => {
        if (!taskBridge) throw new Error('The published query is unavailable.');
        const current = await visitorTaskContext(options.slug), session = await current.store.read(taskBridge.sessionId, current.publication);
        const output = previewRound++ === 0
          ? [{ type: 'function_call', call_id: 'offline-query', name: 'visitor_task', arguments: JSON.stringify(demoWebsiteQuery(options.request.text, { ...current, session, signal })) }]
          : [{ type: 'message', content: [{ type: 'output_text', text: session.clarification?.question ?? 'The website is ready. You can refine these filters or open an item.' }] }];
        return Response.json({ status: 'completed', output });
      };
      const result = await runVisitorTask({ record, fetch: options.preview ? previewFetch : undefined, model: 'gpt-5.6-luna', channel: 'chat', responseWordLimit: conversationWordLimit(options.content, 'chat'), apiKey: options.preview ? 'offline-preview' : process.env.OPENAI_API_KEY?.trim() ?? '', signal,
        activeImage: options.preview ? undefined : () => activeCarouselImage(options.slug, context, options.media, signal, options.request.text, options.request.requestId),
        onAnswer: (text, round) => { if (!signal.aborted) emit({ type: 'answer', requestId: options.request.requestId, round, text, provisional: true }); },
        instructions: async () => `${taskBridge ? await taskBridge.instructions(context.carousel) : ''}\n${assistantPurposeInstructions(options.content)}\n${carouselInstructions(context, publishedWorkspace(options.content, options.catalog, options.media))}\n${workspaceInstructions(context.workspace!, publishedWorkspace(options.content, options.catalog, options.media, context.externalResults), context.scene, options.request.text, options.catalog, options.media, 'tool')}`,
        context: { request: options.request.text, history: options.request.history, currentView: context }, tools, beforeModel: () => taskBridge?.beforeModel() ?? Promise.resolve(), onUsage: async usage => { options.onUsage(usage); await taskBridge?.usage(usage); },
        execute: async (name, args) => {
          await assertCurrent();
          if (name === 'navigate_carousel') return { data: await display({ kind: 'carousel', ...carouselNavigationSchema.parse(JSON.parse(args)) }) };
          if (name === 'read_published_content') { progress('retrieving'); return { data: readPublishedContent(JSON.parse(args), publishedWorkspace(options.content, options.catalog, options.media), options.catalog) }; }
          if (name === 'visitor_task' && taskBridge) {
            const capability = String((JSON.parse(args) as { capabilityId: string }).capabilityId);
            let confirmation: string | undefined;
            const result = await taskBridge.execute(args, signal, view => {
              const kind = ({ home: 'home', 'view.reset': 'browse', 'view.back': 'back', 'record.detail': 'open' } as Record<string, string>)[capability];
              confirmation = kind ? navigationConfirmation(options.request.text, kind, view.detail ? [view.detail.record.name] : []) : undefined;
              return display({ kind: 'task', view });
            });
            return { ...result, ...(result.data.status === 'applied' && confirmation ? { directText: confirmation, displaySatisfied: true } : {}) };
          }
          if (name === 'update_workspace') {
            const reply = parseWorkspaceToolReply(JSON.parse(args), context.workspace!, publishedWorkspace(options.content, options.catalog, options.media, context.externalResults), context.scene);
            if (taskBridge && reply.batch && requiresWebsiteQuery(reply.batch)) return { data: { status: 'unavailable', message: 'Use visitor_task query.patch, record.detail or selection.compare for the carousel. Semantic cards cannot bypass the authoritative collection query.' } };
            if (!reply.batch) return { data: { status: 'unavailable', message: reply.message }, directText: reply.message };
            return { data: await display({ kind: 'workspace', batch: reply.batch }) };
          }
          const requested = validateExploreVoice(JSON.parse(args), options.content, context.explore, context.workspace);
          if (!requested.search) return { data: await display({ kind: 'explore', command: requested.command }) };
          if (context.workspace) {
            searchPlacement(context.workspace, context.externalResults ?? [], requested.search.annotationTarget);
            requested.search.query = contextualSearchQuery(requested.search.query, context.workspace, publishedWorkspace(options.content, options.catalog, options.media), context.explore);
          }
          progress('searching');
          const found = await lookup(async (query, kind, signal) => (await authorizedExplore(options.slug, { requestId: randomUUID(), parentTraceId: options.request.requestId, query, kind, ...(requested.search?.annotationTarget ? { annotationTarget: requested.search.annotationTarget } : {}) }, signal, snapshot)).result, requested.search.query, requested.search.kind, signal, requested.search.annotationTarget ? JSON.stringify(requested.search.annotationTarget) : '');
          const applied = await display({ kind: 'explore', result: found });
          return { directText: completedSearchAnswer(options.request.text, found), displaySatisfied: true, data: { ...applied, evidence: { ...exploreContextForResult(found, found.kind, null), answer: found.answer, sources: found.sources, citations: found.citations } } };
        },
      });
      if (context.carousel && result.text && !result.displaySatisfied) await display({ kind: 'answer', text: result.text });
      await taskBridge?.finish(); await assertCurrent(); emit({ type: 'done', text: result.text, displaySatisfied: result.displaySatisfied, availability: (await visitorAccess(options.slug)).availability });
    } finally { unsubscribe(); await mailbox.close(); }
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller;
      void work().catch(error => {
        record({ type: signal.aborted ? 'chat.cancelled' : 'chat.failed', data: { error, context } });
        visitorDiagnostic({ traceId: options.request.requestId, channel: 'server', stage: 'backend', operation: 'chat', status: signal.aborted ? 'cancelled' : 'failed', ...diagnosticError(error) });
        if (!options.signal.aborted) emit({ type: 'error', message: 'The task could not finish. Any confirmed views remain available.', diagnostic: diagnosticError(error) }); }).finally(() => { clearTimeout(timer); if (!closed) { closed = true; controller.close(); } });
    },
    cancel() { closed = true; lifecycle.abort(); clearTimeout(timer); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
}
