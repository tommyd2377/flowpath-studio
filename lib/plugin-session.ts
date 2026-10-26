import type { PluginExecutor } from './plugin-contract';

export const pluginObject = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object'
  && !Array.isArray(value) ? value as Record<string, unknown> : null;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
type BackendResponse = { generation: number; calls: number; pending: number; continued: boolean; completed: boolean; failed: boolean };

/** One executor owns each completed call; one continuation follows all settled outputs. */
export function createPluginSession(options: {
  send(event: Record<string, unknown>): void; executors: Record<string, PluginExecutor>;
  generation(): number; barrier(): number; onLimit(): void;
}) {
  let finished = false, limited = false;
  const controller = new AbortController();
  const responses = new Map<string, BackendResponse>(), delegations = new Map<string, string>();
  const generations = new Map<string, number>(), calls = new Set<string>();
  function resume(response: BackendResponse) {
    if (finished || response.failed || !response.completed || response.continued || !response.calls || response.pending) return;
    response.continued = true;
    options.send({ type: 'response.create' });
  }
  function output(response: BackendResponse, callId: string, result: Record<string, unknown>) {
    if (finished) return;
    options.send({ type: 'response.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) } });
    response.pending--;
    resume(response);
  }
  return {
    event(envelope: Record<string, unknown>) {
      if (finished || limited) return;
      if (envelope.type === 'session.delegation.created') {
        const d = pluginObject(envelope.delegation);
        if (d?.target === 'responses' && id(d.id) && !generations.has(d.id) && generations.size < 128
          && typeof envelope.offset_ms === 'number' && Number.isFinite(envelope.offset_ms) && envelope.offset_ms >= 0) {
          generations.set(d.id, envelope.offset_ms <= options.barrier() ? -1 : options.generation());
        }
        return;
      }
      if (envelope.type !== 'response.event') return;
      const event = pluginObject(envelope.event), delegationId = envelope.delegation_id;
      if (!event || !id(delegationId)) return;
      const object = pluginObject(event.response);
      if (event.type === 'response.created') {
        if (!id(object?.id) || responses.has(object.id)) return;
        if (responses.size >= 128) { options.onLimit(); return; }
        responses.set(object.id, { generation: generations.get(delegationId) ?? options.generation(), calls: 0, pending: 0, continued: false, completed: false, failed: false });
        delegations.set(delegationId, object.id);
        return;
      }
      const responseId = id(event.response_id) ? event.response_id : id(object?.id) ? object.id : delegations.get(delegationId);
      const response = responseId ? responses.get(responseId) : undefined;
      if (!response || delegations.get(delegationId) !== responseId) return;
      if (['response.completed', 'response.failed', 'response.incomplete'].includes(String(event.type))) {
        response.completed = true;
        response.failed = event.type !== 'response.completed' || ['failed', 'incomplete', 'cancelled'].includes(String(object?.status));
        resume(response);
        return;
      }
      if (event.type !== 'response.output_item.done' || response.continued) return;
      const item = pluginObject(event.item);
      // Unknown functions belong to neither of these executors. Never acknowledge them twice.
      if (item?.type !== 'function_call' || typeof item.name !== 'string' || !Object.hasOwn(options.executors, item.name)
        || !id(item.call_id) || calls.has(item.call_id)) return;
      if (calls.size >= 64) {
        limited = true; response.failed = true; options.onLimit();
        options.send({ type: 'response.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ status: 'limit_reached' }) } });
        return;
      }
      calls.add(item.call_id); response.calls++; response.pending++;
      const isCurrent = () => !finished && !response.failed && response.generation === options.generation()
        && (!generations.has(delegationId) || generations.get(delegationId) === options.generation());
      if (item.status !== undefined && item.status !== 'completed') { output(response, item.call_id, { status: 'not_completed' }); return; }
      if (!isCurrent()) { output(response, item.call_id, { status: 'superseded' }); return; }
      let args: unknown;
      try {
        if (typeof item.arguments !== 'string' || item.arguments.length > 30_000) throw new Error();
        args = JSON.parse(item.arguments);
      } catch { output(response, item.call_id, { status: 'invalid_action' }); return; }
      try {
        const result = options.executors[item.name](args, { delegationId, isCurrent, signal: controller.signal });
        const callId = item.call_id;
        if (result instanceof Promise) void result.then(value => output(response, callId, isCurrent() ? value : { status: 'superseded' }),
          () => output(response, callId, { status: 'unavailable' }));
        else output(response, callId, result);
      } catch { output(response, item.call_id, { status: 'unavailable' }); }
    },
    finish() { finished = true; controller.abort(); responses.clear(); delegations.clear(); generations.clear(); calls.clear(); },
  };
}
