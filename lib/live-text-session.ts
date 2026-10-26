export type LiveTextState = { text: string; writing: boolean; canUndo: boolean; message: string };
type Options = { onChange: (state: LiveTextState) => void; send: (event: Record<string, unknown>) => void };
type TextAction = 'start_dictation' | 'stop_dictation' | 'replace' | 'append' | 'clear' | 'undo' | 'read';
type BackendResponse = { generation: number; calls: number; continued: boolean; completed: boolean; failed: boolean };

const MAX_TEXT = 4_000, MAX_CALLS = 64, MAX_EVENTS = 8_000;
const commands = ['start writing', 'start dictation', 'stop writing', 'stop dictation'];
const actions: TextAction[] = ['start_dictation', 'stop_dictation', 'replace', 'append', 'clear', 'undo', 'read'];
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object'
  && !Array.isArray(value) ? value as Record<string, unknown> : null;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const validText = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_TEXT
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

/** One conversation's ephemeral text. No storage, logging, extra model or financial authority. */
export function createLiveTextSession({ onChange, send }: Options) {
  let text = '', writing = false, message = '', finished = false, generation = 0, toolsLimited = false;
  let transcriptBuffer = '', lastTranscriptEnd = -1, dictationCheckpoint = false, bufferBoundary = true;
  let controlBarrier = -1;
  const undo: string[] = [];
  const events = new Set<string>(), calls = new Set<string>();
  const responses = new Map<string, BackendResponse>();
  const delegations = new Map<string, string>();
  const delegationGenerations = new Map<string, number>();
  const emit = () => onChange({ text, writing, canUndo: undo.length > 0, message });
  function checkpoint() {
    if (undo.at(-1) !== text) undo.push(text);
    if (undo.length > 10) undo.shift();
  }
  function replace(next: string, saveUndo = true) {
    if (next === text) return;
    if (saveUndo) checkpoint();
    text = next;
  }
  function appendDictation(fragment: string) {
    if (!writing || !fragment) return;
    if (text.length + fragment.length > MAX_TEXT) {
      writing = false;
      message = 'The text box is full. Copy or clear it to keep writing.';
      generation++;
      return;
    }
    if (!dictationCheckpoint) { checkpoint(); dictationCheckpoint = true; }
    text += text.length ? fragment : fragment.trimStart();
  }
  function control(action: TextAction, value = '', local = false) {
    if (local) { generation++; controlBarrier = lastTranscriptEnd; }
    message = '';
    if (action === 'read') return;
    if (action === 'start_dictation') {
      if (!writing) dictationCheckpoint = false;
      writing = true;
    } else if (action === 'stop_dictation') {
      writing = false;
      dictationCheckpoint = false;
    } else {
      writing = false;
      dictationCheckpoint = false;
      if (action === 'clear') replace('');
      else if (action === 'undo') {
        const previous = undo.pop();
        if (previous !== undefined) text = previous;
      } else if (action === 'replace') replace(value);
      else if (action === 'append') replace(text + value);
    }
  }

  // These four exact phrases are reserved voice controls, including within dictation.
  // Keep a possible command prefix until its next fragment, so "stop writ" is never displayed.
  // Literal quotations containing these phrases need delegated replace/append instead.
  function consumeTranscript(delta: string) {
    transcriptBuffer += delta;
    const pattern = /\b(start|stop)\s+(writing|dictation)\b/ig;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(transcriptBuffer))) {
      if (!match.index && !bufferBoundary) continue;
      appendDictation(transcriptBuffer.slice(0, match.index));
      control(match[1].toLowerCase() === 'start' ? 'start_dictation' : 'stop_dictation', '', true);
      transcriptBuffer = transcriptBuffer.slice(match.index + match[0].length).replace(/^[\s,.:;!?]+/, '');
      bufferBoundary = true;
      pattern.lastIndex = 0;
    }
    let held = 0;
    const lower = transcriptBuffer.toLowerCase();
    for (let length = 1; length <= Math.min(lower.length, 24); length++) {
      const start = lower.length - length;
      if (start ? /[a-z0-9_]/i.test(lower[start - 1]) : !bufferBoundary) continue;
      const suffix = lower.slice(start).replace(/\s+/g, ' ');
      if (commands.some(command => command.startsWith(suffix))) held = length;
    }
    const ready = transcriptBuffer.slice(0, transcriptBuffer.length - held);
    appendDictation(ready);
    if (ready) bufferBoundary = !/[a-z0-9_]/i.test(ready.at(-1)!);
    transcriptBuffer = held ? transcriptBuffer.slice(-held) : '';
    emit();
  }

  function continueResponse(response: BackendResponse) {
    if (!response.completed || response.continued || !response.calls || response.failed || finished) return;
    response.continued = true;
    send({ type: 'response.create' });
  }
  function result(callId: string, status: string) {
    send({ type: 'response.item.create', item: { type: 'function_call_output', call_id: callId,
      output: JSON.stringify({ status, text, writing }) } });
  }
  function backend(envelope: Record<string, unknown>) {
    if (toolsLimited) return;
    const event = object(envelope.event);
    if (!event) return;
    const delegationId = identifier(envelope.delegation_id) ? envelope.delegation_id : null;
    const responseObject = object(event.response);
    if (event.type === 'response.created') {
      if (!identifier(responseObject?.id) || !delegationId || responses.has(responseObject.id)) return;
      if (responses.size >= 128) { message = 'Text updates reached this conversation’s limit.'; emit(); return; }
      responses.set(responseObject.id, { generation: delegationGenerations.get(delegationId) ?? generation,
        calls: 0, continued: false, completed: false, failed: false });
      delegations.set(delegationId, responseObject.id);
      return;
    }
    const responseId = identifier(event.response_id) ? event.response_id
      : identifier(responseObject?.id) ? responseObject.id : delegationId ? delegations.get(delegationId) : undefined;
    const response = responseId ? responses.get(responseId) : undefined;
    if (!response || !delegationId || delegations.get(delegationId) !== responseId) return;
    if (event.type === 'response.completed' || event.type === 'response.failed' || event.type === 'response.incomplete') {
      response.completed = true;
      response.failed = event.type !== 'response.completed' || ['failed', 'incomplete', 'cancelled'].includes(String(responseObject?.status));
      continueResponse(response);
      return;
    }
    if (event.type !== 'response.output_item.done' || response.continued) return;
    const item = object(event.item);
    if (item?.type !== 'function_call' || !identifier(item.call_id) || calls.has(item.call_id)) return;
    if (calls.size >= MAX_CALLS) {
      toolsLimited = true;
      response.failed = true;
      message = 'Text updates reached this conversation’s limit. Start a new conversation to continue.';
      writing = false;
      result(item.call_id, 'limit_reached');
      emit();
      return;
    }
    calls.add(item.call_id);
    response.calls++;
    let status = 'invalid_action';
    if (item.status !== undefined && item.status !== 'completed') status = 'not_completed';
    else if (response.failed || response.generation !== generation
      || delegationGenerations.has(delegationId) && delegationGenerations.get(delegationId) !== generation) status = 'superseded';
    else if (item.name === 'update_text_box' && typeof item.arguments === 'string' && item.arguments.length <= 30_000) {
      let args: Record<string, unknown> | null = null;
      try { args = object(JSON.parse(item.arguments)); } catch { /* Invalid arguments never modify the panel. */ }
      if (args && Object.keys(args).length === 2 && Object.keys(args).every(key => ['action', 'text'].includes(key))
        && actions.includes(args.action as TextAction) && validText(args.text)
        && (['replace', 'append'].includes(String(args.action)) || args.text === '')) {
        if (args.action === 'append' && text.length + args.text.length > MAX_TEXT) status = 'text_too_long';
        else {
          if (args.action !== 'read') { transcriptBuffer = ''; bufferBoundary = true; }
          control(args.action as TextAction, args.text);
          status = 'applied';
          emit();
        }
      }
    }
    result(item.call_id, status);
    continueResponse(response);
  }

  emit();
  return {
    event(input: unknown) {
      if (finished) return;
      try {
        const event = object(input);
        if (!event) return;
        if (identifier(event.event_id)) {
          if (events.has(event.event_id)) return;
          if (events.size >= MAX_EVENTS) {
            writing = false; message = 'Text updates reached this conversation’s limit.'; emit(); return;
          }
          events.add(event.event_id);
        }
        if (event.type === 'response.event') { backend(event); return; }
        if (event.type === 'session.delegation.created') {
          const delegation = object(event.delegation);
          if (delegation?.target !== 'responses' || !identifier(delegation.id) || delegationGenerations.has(delegation.id)
            || delegationGenerations.size >= 128 || typeof event.offset_ms !== 'number' || !Number.isFinite(event.offset_ms)
            || event.offset_ms < 0) return;
          // Provider audio timing rejects old work even when its metadata arrives after a local control.
          // If all metadata and transcript fragments were delayed past the barrier, their age is unknown;
          // without a provider acknowledgment, no browser-only clock can establish an exact stop boundary.
          delegationGenerations.set(delegation.id, event.offset_ms <= controlBarrier ? -1 : generation);
          return;
        }
        if (event.type !== 'session.input_transcript.delta' || !validText(event.delta)
          || typeof event.start_ms !== 'number' || typeof event.end_ms !== 'number'
          || !Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms)
          || event.start_ms < 0 || event.end_ms < event.start_ms || event.start_ms < lastTranscriptEnd) return;
        lastTranscriptEnd = event.end_ms;
        consumeTranscript(event.delta);
      } catch {
        writing = false;
        message = 'Text updates paused. Your existing text is still available.';
        emit();
      }
    },
    action(action: 'stop' | 'clear' | 'undo') {
      if (!['stop', 'clear', 'undo'].includes(action)) return;
      if (action === 'stop') appendDictation(transcriptBuffer);
      transcriptBuffer = '';
      bufferBoundary = true;
      control(action === 'stop' ? 'stop_dictation' : action, '', true);
      emit();
    },
    finish() {
      if (finished) return;
      appendDictation(transcriptBuffer);
      finished = true;
      writing = false;
      transcriptBuffer = '';
      responses.clear(); delegations.clear(); delegationGenerations.clear(); events.clear(); calls.clear();
      emit();
    },
  };
}
