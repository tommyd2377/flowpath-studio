import { createPluginSession, pluginObject as object } from './plugin-session';
import { validKnowledgeResult, type KnowledgePassage, type PluginContext } from './plugin-contract';

export type LiveTextDisplay = 'text' | 'knowledge';
export type LiveTextState = { text: string; writing: boolean; visible: boolean; canUndo: boolean; message: string; sources?: KnowledgePassage[]; pending?: boolean;
  display?: LiveTextDisplay; hasKnowledge?: boolean };
type Snapshot = { text: string; sources: KnowledgePassage[] };
type DisplayBuffer = Snapshot & { undo: Snapshot[]; message: string };
type Workspace = { display: LiveTextDisplay; visible: boolean; hasKnowledge: boolean; buffers: Record<LiveTextDisplay, DisplayBuffer> };
type Options = { workspace?: Workspace; onChange: (state: LiveTextState) => void; send: (event: Record<string, unknown>) => void; textEnabled?: boolean; searchKnowledge?: (query: string, signal: AbortSignal) => Promise<unknown> };
type TextAction = 'start_dictation' | 'stop_dictation' | 'show' | 'hide' | 'replace' | 'append' | 'clear' | 'undo' | 'read';

const MAX_TEXT = 4_000, MAX_EVENTS = 8_000;
const commands: Record<string, TextAction> = {
  'start writing': 'start_dictation', 'start dictation': 'start_dictation',
  'stop writing': 'stop_dictation', 'stop dictation': 'stop_dictation',
  'show the text box': 'show', 'show text box': 'show',
  'hide the text box': 'hide', 'hide text box': 'hide',
  'close the text box': 'hide', 'close text box': 'hide',
};
const actions: TextAction[] = ['start_dictation', 'stop_dictation', 'show', 'hide', 'replace', 'append', 'clear', 'undo', 'read'];
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const validText = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_TEXT
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

/** Page-local display buffers; each voice connection gets fresh tool/async authority. */
export function createLiveTextSession({ onChange, send, textEnabled = true, searchKnowledge, workspace }: Options) {
  let text = '', writing = false, visible = false, message = '', finished = false, generation = 0;
  let transcriptBuffer = '', lastTranscriptEnd = -1, dictationCheckpoint = false, bufferBoundary = true;
  let controlBarrier = -1, textRevision = 0;
  let sources: KnowledgePassage[] = [];
  let pendingSearch: object | null = null;
  let undo: Snapshot[] = [];
  let display: LiveTextDisplay = 'text', hasKnowledge = false;
  const buffers: Record<LiveTextDisplay, DisplayBuffer> = {
    text: { text: '', sources: [], undo: [], message: '' }, knowledge: { text: '', sources: [], undo: [], message: '' },
  };
  if (workspace && textEnabled) {
    Object.assign(buffers, workspace.buffers);
    ({ display, visible, hasKnowledge } = workspace);
    ({ text, sources, undo } = buffers[display]);
  }
  const events = new Set<string>();
  const readRevisions = new Map<string, number>();
  const emit = () => onChange({ text, writing, visible, canUndo: undo.length > 0, message, sources, pending: !!pendingSearch, display, hasKnowledge });
  function activate(next: LiveTextDisplay) {
    if (next === display) return;
    buffers[display] = { text, sources, undo, message };
    ({ text, sources, undo, message } = buffers[next]);
    display = next;
    writing = false; dictationCheckpoint = false;
    textRevision++;
  }
  function checkpoint() {
    if (undo.at(-1)?.text !== text || undo.at(-1)?.sources !== sources) undo.push({ text, sources });
    if (undo.length > 10) undo.shift();
  }
  function replace(next: string, saveUndo = true, nextSources: KnowledgePassage[] = []) {
    if (next === text && (nextSources === sources || !nextSources.length && !sources.length)) return;
    if (saveUndo) checkpoint();
    text = next; sources = nextSources;
    textRevision++;
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
    sources = [];
    text += text.length ? fragment : fragment.trimStart();
    textRevision++;
  }
  function control(action: TextAction, value = '', local = false) {
    if (local || action === 'hide') { generation++; controlBarrier = lastTranscriptEnd; }
    if (action === 'show' || action === 'start_dictation') activate('text');
    if ((action === 'replace' || action === 'append') && display === 'knowledge') {
      const original = { text, sources };
      activate('text');
      replace(original.text, true, original.sources);
    }
    message = '';
    if (action === 'read') return;
    pendingSearch = null;
    if (action === 'show') { visible = true; return; }
    if (action === 'hide') { visible = false; writing = false; dictationCheckpoint = false; return; }
    if (action === 'start_dictation') {
      visible = true;
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
        if (previous !== undefined) { text = previous.text; sources = previous.sources; textRevision++; }
      } else if (action === 'replace') { visible = true; replace(value); }
      else if (action === 'append') { visible = true; replace(text + value); }
    }
  }

  // Exact dictation/display phrases are reserved controls, including within dictation.
  // Keep a possible command prefix until its next fragment, so "stop writ" is never displayed.
  // Literal quotations containing these phrases need delegated replace/append instead.
  function consumeTranscript(delta: string) {
    transcriptBuffer += delta;
    const pattern = /\b(?:(?:start|stop)\s+(?:writing|dictation)|(?:show|hide|close)\s+(?:the\s+)?text\s+box)\b/ig;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(transcriptBuffer))) {
      if (!match.index && !bufferBoundary) continue;
      appendDictation(transcriptBuffer.slice(0, match.index));
      control(commands[match[0].toLowerCase().replace(/\s+/g, ' ')], '', true);
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
      if (Object.keys(commands).some(command => command.startsWith(suffix))) held = length;
    }
    const ready = transcriptBuffer.slice(0, transcriptBuffer.length - held);
    appendDictation(ready);
    if (ready) bufferBoundary = !/[a-z0-9_]/i.test(ready.at(-1)!);
    transcriptBuffer = held ? transcriptBuffer.slice(-held) : '';
    emit();
  }

  const plugins = createPluginSession({ send, generation: () => generation, barrier: () => controlBarrier,
    onLimit: () => { writing = false; message = 'Plugin updates reached this conversation’s limit.'; emit(); },
    executors: {
      ...(textEnabled ? { update_text_box(input: unknown, context: PluginContext) {
        const args = object(input), delegationId = context.delegationId;
        let status = 'invalid_action';
        if (args && Object.keys(args).length === 2 && Object.keys(args).every(key => ['action', 'text'].includes(key))
          && actions.includes(args.action as TextAction) && validText(args.text)
          && (['replace', 'append'].includes(String(args.action)) || args.text === '')) {
          if (['replace', 'append', 'clear', 'undo'].includes(String(args.action))
            && readRevisions.has(delegationId) && readRevisions.get(delegationId) !== textRevision) status = 'superseded';
          else if (args.action === 'append' && text.length + args.text.length > MAX_TEXT) status = 'text_too_long';
          else {
            if (args.action === 'read') readRevisions.set(delegationId, textRevision);
            if (['hide', 'stop_dictation', 'show'].includes(String(args.action))) appendDictation(transcriptBuffer);
            if (args.action !== 'read') { transcriptBuffer = ''; bufferBoundary = true; }
            control(args.action as TextAction, args.text);
            if (readRevisions.has(delegationId)) readRevisions.set(delegationId, textRevision);
            status = 'applied'; emit();
          }
        }
        return { status, text, writing, visible };
      } } : {}),
      ...(searchKnowledge ? { async search_waveform_knowledge(input: unknown, context: PluginContext) {
        const args = object(input);
        if (!args || Object.keys(args).length !== 2 || typeof args.query !== 'string' || !args.query.trim()
          || args.query.length > 1000 || typeof args.display !== 'boolean') return { status: 'invalid_action' };
        const ticket = {};
        if (args.display && textEnabled) {
          appendDictation(transcriptBuffer); transcriptBuffer = ''; bufferBoundary = true;
          writing = false; dictationCheckpoint = false;
          activate('knowledge'); hasKnowledge = true;
          pendingSearch = ticket; visible = true; message = ''; emit();
        }
        const expectedRevision = textRevision;
        let result: unknown;
        try { result = await searchKnowledge(args.query, context.signal); }
        catch {
          if (context.isCurrent() && pendingSearch === ticket) { pendingSearch = null; message = 'Sources could not be loaded. Your existing text is still available.'; emit(); }
          return { status: 'unavailable' };
        }
        if (!context.isCurrent()) return { status: 'superseded' };
        const currentDisplay = pendingSearch === ticket;
        if (currentDisplay) pendingSearch = null;
        if (!validKnowledgeResult(result)) { if (currentDisplay) { message = 'Sources could not be verified.'; emit(); } return { status: 'unavailable' }; }
        let displayed = false;
        if (args.display && textEnabled && currentDisplay && result.passages.length && expectedRevision === textRevision && !writing) {
          replace(result.passages.map((p, i) => `[${i + 1}] “${p.quote}”`).join('\n\n'), true, result.passages);
          visible = true; writing = false; transcriptBuffer = ''; bufferBoundary = true; message = ''; displayed = true; emit();
        }
        if (args.display && textEnabled && currentDisplay && !result.passages.length) message = 'No relevant passages found in your selected documents.';
        emit();
        return { status: result.passages.length ? 'found' : 'no_matches', ...result, displayed };
      } } : {}),
    },
  });

  emit();
  return {
    // Copy only display content/Undo, never pending work, tool IDs or microphone history.
    workspace(): Workspace {
      const held = { ...buffers, [display]: { text, sources, undo, message: '' } };
      return { display, visible, hasKnowledge, buffers: {
        text: { ...held.text, undo: [...held.text.undo], message: '' },
        knowledge: { ...held.knowledge, undo: [...held.knowledge.undo], message: '' },
      } };
    },
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
        if (event.type === 'response.event' || event.type === 'session.delegation.created') { plugins.event(event); return; }
        if (!textEnabled) return;
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
    action(action: 'stop' | 'clear' | 'undo' | 'hide' | 'show') {
      if (!['stop', 'clear', 'undo', 'hide', 'show'].includes(action)) return;
      if (action === 'stop' || action === 'hide') appendDictation(transcriptBuffer);
      transcriptBuffer = '';
      bufferBoundary = true;
      control(action === 'stop' ? 'stop_dictation' : action, '', true);
      emit();
    },
    display(next: LiveTextDisplay) {
      if (!textEnabled || !['text', 'knowledge'].includes(next) || next === 'knowledge' && !hasKnowledge) return;
      if (next === display && visible) return;
      appendDictation(transcriptBuffer); transcriptBuffer = ''; bufferBoundary = true;
      generation++; controlBarrier = lastTranscriptEnd; pendingSearch = null;
      writing = false; dictationCheckpoint = false;
      activate(next); visible = true; emit();
    },
    finish() {
      if (finished) return;
      appendDictation(transcriptBuffer);
      finished = true;
      pendingSearch = null;
      writing = false;
      transcriptBuffer = '';
      plugins.finish(); readRevisions.clear(); events.clear();
      emit();
    },
  };
}
