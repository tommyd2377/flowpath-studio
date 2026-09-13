import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { WorkspaceAuthority, WorkspaceRecord } from '@thevoice/platform-ui/workspace';
import type { SiteContent } from './site-model';
import { greetingPointText } from './site-greeting';

export type GreetingVisual = { slot: number; text: string; record: WorkspaceRecord };

/** Resolve only the published greeting selections, preserving their spoken order. */
export function greetingVisuals(content: SiteContent, authority: WorkspaceAuthority, catalog?: KnowledgeCatalog | null): GreetingVisual[] {
  return (content.greetingPoints ?? []).slice(0, 3).flatMap((point, slot) => {
    if (!point) return [];
    const text = greetingPointText(point, content, catalog);
    const kind = point.kind === 'custom' ? 'source' : point.kind;
    const id = point.kind === 'custom' ? `greeting:${slot + 1}` : point.id;
    const record = authority.records.find(record => record.reference.kind === kind && record.reference.id === id);
    return text && record ? [{ slot, text, record }] : [];
  });
}

const normalize = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const filler = new Set('a an and are as at be by can for from has have here i in is it its me my of on or our the their there this to us we welcome what with you your'.split(' '));
const words = (text: string) => normalize(text).split(' ').filter(word => word.length > 2 && !filler.has(word));

/** Caption evidence advances focus; elapsed time alone never chooses a subject. */
export function greetingCue(points: GreetingVisual[], text: string, after = -1): number {
  const caption = ` ${normalize(text)} `;
  const spoken = new Set(words(text));
  let matched = after;
  for (let index = after + 1; index < points.length; index++) {
    const point = points[index];
    const phrase = normalize(point.text);
    const name = normalize(point.record.name);
    const terms = [...new Set(words(point.text))].filter(word => !points.some((other, otherIndex) => otherIndex !== index && words(other.text).includes(word)));
    const exact = phrase && caption.includes(` ${phrase} `);
    const named = point.record.reference.id.startsWith('greeting:') ? false : words(name).length > 0 && caption.includes(` ${name} `);
    if (exact || named || terms.length >= 2 && terms.filter(term => spoken.has(term)).length >= 2) matched = index;
  }
  return matched;
}

/** A visual observer only: it never controls audio, sends requests or changes narration. */
export function followGreeting(points: GreetingVisual[], show: (index: number | null, signal: AbortSignal) => void) {
  let active = true, heard = false, speaking = false, shown = false, cue = -1, displayedCue = -1;
  let pending: AbortController | undefined;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  const deadline = setTimeout(() => finish(), 60_000);
  function display(index: number | null) {
    displayedCue = index ?? -1;
    pending?.abort(); pending = new AbortController(); show(index, pending.signal);
  }
  function cancel() { active = false; clearTimeout(quiet); clearTimeout(deadline); pending?.abort(); }
  function finish() {
    if (!active) return;
    cancel();
    if (shown) display(null);
  }
  return {
    caption(text: string) {
      if (!active) return;
      const next = greetingCue(points, text, cue);
      if (next === cue) return;
      cue = next;
      if (speaking && cue >= 0) display(cue);
    },
    audio(state: { inputActive: boolean; outputActive: boolean }) {
      if (!active) return;
      if (state.inputActive) { cancel(); return; }
      speaking = state.outputActive;
      clearTimeout(quiet);
      if (speaking) {
        heard = true;
        if (!shown || cue !== displayedCue) { shown = true; display(cue >= 0 ? cue : null); }
      } else if (heard) {
        if (cue === points.length - 1) finish();
        else quiet = setTimeout(finish, 1500);
      }
    },
    finish, cancel,
  };
}
