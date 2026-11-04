import type { KnowledgePassage } from './plugin-contract';
import { pluginObject } from './plugin-session';
import { practiceDefinition } from './practice-catalog';
import { PRACTICE_IDS, type PracticeController, type PracticeId, type PracticeInput, type PracticeView } from './practice-contract';

export type PracticeDisplay = PracticeView & { id: PracticeId; name: string };

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

export function createPracticeSession(enabled: readonly PracticeId[]) {
  const controllers = new Map<PracticeId, PracticeController>();
  let sources: readonly KnowledgePassage[] = [];
  let selected: PracticeId | undefined;
  let finished = false;

  function execute(input: unknown): Record<string, unknown> {
    const row = pluginObject(input);
    if (finished || !row || Object.keys(row).length !== 7
      || !PRACTICE_IDS.includes(row.plugin as PracticeId)
      || !boundedText(row.action, 24) || !boundedText(row.title, 100)
      || !boundedText(row.prompt, 700) || !boundedText(row.detail, 1600)
      || !boundedText(row.sourceId, 12) || typeof row.score !== 'number' || !Number.isSafeInteger(row.score)
      || row.score < 0 || row.score > 10) return { status: 'invalid_action' };
    const id = row.plugin as PracticeId;
    const definition = practiceDefinition(id);
    if (!definition || !enabled.includes(id)) return { status: 'unavailable' };
    const controller = controllers.get(id) ?? definition.create();
    const { action, title, prompt, detail, score, sourceId } = row as PracticeInput;
    const result = controller.apply({ action, title, prompt, detail, score, sourceId }, { sources });
    if (!result.ok) return { status: 'invalid_action', message: result.error };
    controllers.set(id, controller);
    selected = id;
    const view = controller.state();
    return { status: 'applied', title: view.title, prompt: view.prompt, detail: view.detail,
      progress: view.progress, ...(result.message ? { message: result.message } : {}) };
  }

  return {
    execute,
    acceptSources(passages: readonly KnowledgePassage[]) { if (!finished) sources = passages; },
    hide() { selected = undefined; },
    show(id: PracticeId) { if (!finished && controllers.has(id)) selected = id; },
    display(): PracticeDisplay | undefined {
      if (!selected) return;
      const state = controllers.get(selected)?.state();
      const definition = practiceDefinition(selected);
      if (state && definition) return { ...state, id: selected, name: definition.name };
    },
    opened() { return [...controllers.keys()]; },
    finish() { finished = true; selected = undefined; sources = []; controllers.clear(); },
  };
}
