import { randomUUID } from 'node:crypto';
import type WebSocket from 'ws';
import { PluginAccessError } from './plugin-access';
import { voiceSessionConfig, type WaveformPrompt } from './voice-config';

type Socket = Pick<WebSocket, 'send' | 'terminate'> & {
  on(event: 'open' | 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'message', listener: (data: WebSocket.RawData) => void): unknown;
};
type AuthorizedTarget = {
  /** Server-resolved provider ID, never the browser's application session ID. */
  providerId: string;
  /** Exact current policy/content/grant revision; changes must invalidate the operation. */
  revision: string;
  /** Server-projected capabilities only, retaining the already-reviewed persona. */
  waveform: WaveformPrompt;
};
type Options = {
  /** Must authorize identity, content, grants and ownership of the same still-running application session each time. */
  authorize(): Promise<AuthorizedTarget>;
  /** Required injection: the runtime supplies its existing server-only provider authentication. No default network call. */
  socketFactory(providerId: string): Socket;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** Narrow server-owned in-call update. Never creates/restarts voice, handles tools, changes model or logs events. */
export async function updateRunningPluginVoice(options: Options): Promise<void> {
  options.signal?.throwIfAborted();
  const initial = await options.authorize();
  options.signal?.throwIfAborted();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(initial.providerId) || !initial.revision) throw new PluginAccessError('The conversation changed.', 409);
  const config = voiceSessionConfig(initial.waveform);
  const configuration = JSON.stringify(config);
  const updateId = `plugin_update_${randomUUID()}`, contextId = `plugin_context_${randomUUID()}`;
  const toolNames = config.delegation.responses.tools.map(tool => tool.name);
  // Fixed, short application context, below the 500-token append bound. Private catalogues belong only in the checked backend config.
  const context = `The server has updated this visitor's allowed plugins. This replaces earlier unavailable-plugin statements only for these registered tools: ${toolNames.join(', ') || 'none'}. For an explicit request to use an available plugin, delegate to the backend. The backend has the allowed catalogue. Never request, repeat or store access codes in conversation. A tool result is the only confirmation an operation succeeded.`;
  const backend = config.delegation.responses;
  const socket = options.socketFactory(initial.providerId);
  await new Promise<void>((resolve, reject) => {
    let done = false, phase: 'opening' | 'updating' | 'context' = 'opening', handling = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      socket.terminate();
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new PluginAccessError('The plugin update was canceled.', 409));
    const timer = setTimeout(() => finish(new PluginAccessError('The running conversation did not confirm the plugin update.', 503)), options.timeoutMs ?? 10_000);
    const current = async () => {
      const next = await options.authorize();
      if (done) return false;
      if (next.providerId !== initial.providerId || next.revision !== initial.revision || JSON.stringify(voiceSessionConfig(next.waveform)) !== configuration) {
        throw new PluginAccessError('Plugin access changed during the update.', 409);
      }
      options.signal?.throwIfAborted();
      return true;
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { abort(); return; }
    socket.on('open', () => {
      if (done || phase !== 'opening' || handling) return;
      handling = true;
      void (async () => {
        if (!await current()) return;
        phase = 'updating';
        socket.send(JSON.stringify({ type: 'session.update', event_id: updateId, session: { delegation: { type: 'responses', responses: {
          instructions: backend.instructions, tools: backend.tools, tool_choice: backend.tool_choice,
          parallel_tool_calls: false, max_output_tokens: backend.max_output_tokens,
        } } } }));
      })().catch(error => finish(error instanceof PluginAccessError ? error : new PluginAccessError('The plugin update failed.', 503)))
        .finally(() => { handling = false; });
    });
    socket.on('message', raw => {
      if (done) return;
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw.toString()); }
      catch { finish(new PluginAccessError('The plugin update could not be verified.', 503)); return; }
      if (!event || typeof event !== 'object') return;
      if (event.type === 'error' || event.type === 'session.closed') { finish(new PluginAccessError('The plugin update was not accepted.', 503)); return; }
      const updateAccepted = phase === 'updating' && event.type === 'session.updated' && event.client_event_id === updateId;
      const contextAccepted = phase === 'context' && event.type === 'session.instructions.appended' && event.client_event_id === contextId;
      if ((!updateAccepted && !contextAccepted) || handling) return;
      handling = true;
      void (async () => {
        if (!await current()) return;
        if (contextAccepted) { finish(); return; }
        phase = 'context';
        socket.send(JSON.stringify({ type: 'session.instructions.append', event_id: contextId, delegation_id: null, content: context }));
      })().catch(error => finish(error instanceof PluginAccessError ? error : new PluginAccessError('The plugin update failed.', 503)))
        .finally(() => { handling = false; });
    });
    socket.on('error', () => finish(new PluginAccessError('The plugin update connection failed.', 503)));
    socket.on('close', () => { if (!done) finish(new PluginAccessError('The plugin update connection closed.', 503)); });
  });
}
