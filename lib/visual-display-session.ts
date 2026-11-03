import { emptyVisualDisplayState, validateVisualDisplay, visualDisplayAction, VISUAL_TEXT_LIMIT, type VisualDisplayConfiguration, type VisualDisplayState } from './visual-display';
import type { PluginContext } from './plugin-contract';

/** Deterministic session state. Voice and visible controls call the same validated operation. */
export function createVisualDisplaySession(configuration: VisualDisplayConfiguration | null | undefined, onChange: (state: VisualDisplayState) => void) {
  const parsed = validateVisualDisplay(configuration), images = parsed.ok ? parsed.value?.images ?? [] : [];
  let state = emptyVisualDisplayState();
  let revision = 0, finished = false;
  const reads = new Map<string, number>();
  const emit = () => onChange({ ...state });
  const selected = () => images.find(i => i.id === state.imageId);
  function execute(input: unknown, context?: PluginContext): Record<string, unknown> {
    if (context && (finished || !context.isCurrent() || context.signal.aborted)) return { status: 'superseded' };
    const action = visualDisplayAction(input);
    if (!action) return { status: 'invalid_action' };
    if (!images.length) return { status: 'unavailable' };
    if (context && action.action !== 'read' && reads.has(context.delegationId) && reads.get(context.delegationId) !== revision) return { status: 'superseded' };
    if (action.action === 'read') {
      if (context && reads.size < 128) reads.set(context.delegationId, revision);
      return { status: 'read', visible: state.visible, imageId: state.imageId, text: state.text };
    }
    if (action.action === 'hide') state.visible = false;
    else {
      const index = images.findIndex(i => i.id === state.imageId);
      const image = action.action === 'select' ? images.find(i => i.id === action.imageId)
        : action.action === 'next' ? images[(index + 1) % images.length]
        : action.action === 'previous' ? images[(index < 0 ? images.length : index + images.length - 1) % images.length]
        : selected() ?? images[0];
      if (!image) return { status: 'unknown_image' };
      if (['replace_text','append_text'].includes(action.action)) {
        const next = action.action === 'append_text' ? (state.imageId ? state.text : image.text) + action.text : action.text;
        if (next.length > VISUAL_TEXT_LIMIT) return { status: 'text_too_long' };
        state.text = next;
      } else if (state.imageId !== image.id) state.text = image.text;
      state.imageId = image.id; state.visible = true; state.requested = true;
    }
    revision++;
    if (context && reads.has(context.delegationId)) reads.set(context.delegationId, revision);
    emit();
    const image = selected();
    return { status: 'applied', visible: state.visible, imageId: state.imageId,
      ...(image ? { title: image.title, description: image.description } : {}), text: state.text };
  }
  return { execute, state: () => ({ ...state }), dismiss() { if (state.visible) { state.visible = false; revision++; emit(); } },
    finish() { finished = true; reads.clear(); }, reset() { state = emptyVisualDisplayState(); revision++; reads.clear(); emit(); } };
}
