import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { WorkspaceAuthority, WorkspaceRecord } from '@thevoice/platform-ui/workspace';
import type { SiteContent } from './site-model';
import { greetingPointTopic, type GreetingTopic } from './site-greeting';
import type { GreetingRecordTopic } from './greeting-records';

export type GreetingVisual = { slot: number; text: string; topic: GreetingTopic; record: WorkspaceRecord; recordId?: string; cueAliases?: string[] };

/** Resolve only the published greeting selections, preserving their spoken order. */
export function greetingVisuals(content: SiteContent, authority: WorkspaceAuthority, catalog?: KnowledgeCatalog | null, recordTopics: GreetingRecordTopic[] = []): GreetingVisual[] {
  const visuals = (content.greetingPoints ?? []).slice(0, 3).flatMap<GreetingVisual>((point, slot) => {
    if (!point) return [];
    const topic = greetingPointTopic(point, content, catalog, recordTopics);
    // V2 items open through the task service, which validates current-publication
    // records. This descriptor is a speech cue, never workspace authority.
    if (point.kind === 'record') return topic ? [{ slot, topic, text: [topic.title, topic.body].filter(Boolean).join('. '), recordId: point.id,
      record: { reference: { kind: 'source' as const, id: point.id, revisionId: authority.publicationId }, name: topic.title, body: topic.body, component: 'information' as const } }] : [];
    const kind = point.kind === 'custom' ? 'source' : point.kind;
    const id = point.kind === 'custom' ? `greeting:${slot + 1}` : point.id;
    const record = authority.records.find(record => record.reference.kind === kind && record.reference.id === id);
    return topic && record ? [{ slot, topic, text: [topic.title, topic.body].filter(Boolean).join('. '), record }] : [];
  });
  return visuals.map((visual, index) => {
    const point = content.greetingPoints?.[visual.slot];
    const kind = point?.kind === 'record' ? recordTopics.find(topic => topic.id === point.id)?.kind
      : point?.kind === 'entity' ? catalog?.entities.find(entity => entity.id === point.id)?.kind : undefined;
    if (!/^(?:person|profile|biography)$/.test(normalize(kind ?? '').replace(/^type /, ''))) return visual;
    const names = normalize(visual.record.name).split(' ').filter(name => !nameTitles.has(name));
    const cueAliases = [...new Set([names[0], names.at(-1)])].filter((name): name is string => Boolean(name && name.length > 3
      && !visuals.some((other, otherIndex) => otherIndex !== index && normalize(other.record.name).split(' ').includes(name))));
    return cueAliases.length ? { ...visual, cueAliases } : visual;
  });
}

const normalize = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const filler = new Set('a an and are as at be by can for from has have here i in is it its me my of on or our the their there this to us we welcome what with you your'.split(' '));
const nameTitles = new Set('mr mrs ms miss dr doctor prof professor jr sr ii iii iv'.split(' '));
const words = (text: string) => normalize(text).split(' ').filter(word => word.length > 2 && !filler.has(word));

/** Return the end of the earliest sufficient evidence for only the next topic. */
function greetingCueEnd(points: GreetingVisual[], text: string, after: number): number | null {
  const index = after + 1;
  const point = points[index];
  if (!point) return null;
  const caption = ` ${text} `;
  const phrase = normalize(point.text);
  const name = normalize(point.record.name);
  const terms = [...new Set(words(point.text))].filter(word => !points.some((other, otherIndex) => otherIndex !== index && words(other.text).includes(word)));
  const end = (value: string) => { const start = value ? caption.indexOf(` ${value} `) : -1; return start >= 0 ? start + value.length : null; };
  const exact = end(phrase);
  const named = point.record.reference.id.startsWith('greeting:') || !words(name).length ? null : end(name);
  // Narration may naturally use a person's first or last name. These aliases
  // come only from published person records and remain subject to the consumed
  // caption boundary, so a mention in an earlier story cannot cue a later card.
  const aliases = (point.cueAliases ?? []).map(end);
  const termEnds = terms.flatMap(term => { const position = end(term); return position === null ? [] : [position]; }).sort((a, b) => a - b);
  const evidence = [exact, named, ...aliases, termEnds.length >= 2 ? termEnds[1] : null].filter((position): position is number => position !== null);
  return evidence.length ? Math.min(...evidence) : null;
}

/** Caption evidence advances focus; elapsed time alone never chooses a subject. */
export function greetingCue(points: GreetingVisual[], text: string, after = -1): number {
  // A list of later topic names must not jump over the selected introduction.
  return greetingCueEnd(points, normalize(text), after) === null ? after : after + 1;
}

/** Carry the consumed boundary forward when a cumulative caption rolls or is revised. */
function captionCursor(previous: string, current: string, consumed: number) {
  if (!consumed || current.startsWith(previous)) return consumed;
  let common = 0;
  while (common < previous.length && common < current.length && previous[common] === current[common]) common++;
  if (common >= consumed) return consumed;
  // Live retains a rolling caption tail. Locate the retained suffix instead of
  // treating its old topic mentions as newly spoken evidence.
  for (let start = previous.indexOf(current[0]); start >= 0; start = previous.indexOf(current[0], start + 1)) {
    if (current.startsWith(previous.slice(start))) return Math.max(0, consumed - start);
  }
  return 0;
}

/** A visual observer only: it never controls audio, sends requests or changes narration. */
export function followGreeting(points: GreetingVisual[], show: (index: number | null, signal: AbortSignal) => void) {
  let active = true, heard = false, speaking = false, shown = false, cue = -1, displayedCue = -1;
  let captionText = '', captionVersion = 0, examinedCaption = 0;
  let normalizedCaption = '', consumedCaption = 0;
  let pending: AbortController | undefined;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  const deadline = setTimeout(() => finish(), 120_000);
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
  function advance() {
    if (!speaking || examinedCaption === captionVersion) return;
    examinedCaption = captionVersion;
    const end = greetingCueEnd(points, normalizedCaption.slice(consumedCaption), cue);
    if (end === null) return;
    consumedCaption += end;
    cue++;
    shown = true; display(cue);
  }
  return {
    caption(text: string) {
      if (!active || text === captionText) return;
      const current = normalize(text);
      consumedCaption = captionCursor(normalizedCaption, current, consumedCaption);
      normalizedCaption = current;
      captionText = text; captionVersion++;
      // Captions can arrive before playback; keep them pending until audio is
      // active instead of silently advancing through cards nobody has seen.
      advance();
    },
    audio(state: { inputActive: boolean; outputActive: boolean }) {
      if (!active) return;
      // Input level includes room noise and speaker echo. Recognized visitor
      // speech cancels through onGreetingInterrupted, not this volume meter.
      speaking = state.outputActive;
      if (speaking) {
        clearTimeout(quiet); quiet = undefined;
        heard = true;
        advance();
        // A generic hello is not evidence that any selected topic was spoken.
        if (cue >= 0 && (!shown || cue !== displayedCue)) { shown = true; display(cue); }
      } else if (heard) {
        if (cue === points.length - 1) finish();
        else if (!quiet) quiet = setTimeout(finish, 1500);
      }
    },
    finish, cancel,
  };
}
