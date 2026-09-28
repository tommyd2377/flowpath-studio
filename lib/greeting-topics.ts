import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { SiteContent } from './site-model';
import { greetingPointTopic, type GreetingPoint, type GreetingTopic } from './site-greeting';
import type { GreetingRecordTopic } from './greeting-records';

type EditorialTopic = { id: string; title: string; kind: string; body?: string };
const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/^type[-_]/, '').replace(/[_-]+/g, ' ').trim();
const narrative = /^(?:article|story|guide|topic|section|page|webpage|information|practical|organization|organisation|business|company|practice|studio|person|profile|biography|team|place|location|contact|hours)$/;
const administrative = /\b(?:privacy|cookies?|terms (?:of|and)|legal notice|accessibility statement|sitemap|refund policy)\b/;

function theme(topic: EditorialTopic) {
  const title = normalized(topic.title), kind = normalized(topic.kind);
  if (/\b(?:story|history|about|background|who we are|who i am)\b/.test(title)) return 'story';
  if (/\b(?:mission|values|community|purpose)\b/.test(title)) return 'values';
  if (/\b(?:visit|location|hours|contact|find us|directions|getting here)\b/.test(title) || /^(?:place|location|contact|hours|practical)$/.test(kind)) return 'visit';
  if (/\b(?:menu|offerings?|services|products|what we do|what i do|what we offer|what i offer)\b/.test(title)) return 'offerings';
  if (/\b(?:approach|process|how it works|working (?:with|together)|choosing|getting started|booking|ordering)\b/.test(title)) return 'approach';
  if (/\b(?:portfolio|projects|selected work|our work|my work)\b/.test(title)) return 'work';
  if (/\b(?:founder|team|people|biography|meet)\b/.test(title) || /^(?:person|profile|biography|team)$/.test(kind)) return 'people';
  if (/\b(?:events|programs|classes|workshops)\b/.test(title)) return 'programs';
  if (/^(?:organization|organisation|business|company|practice|studio)$/.test(kind)) return 'overview';
  return 'other';
}

/** Select introduction-scale editorial material, never individual products, services or fact fields.
 * This is a bounded view of the publisher's existing semantic topics, not an AI-authored summary.
 */
export function selectGreetingEditorialTopics<T extends EditorialTopic>(candidates: T[]): T[] {
  const eligible = candidates.filter(topic => narrative.test(normalized(topic.kind)) && topic.body?.trim() && !administrative.test(normalized(topic.title)));
  const priority = ['story', 'offerings', 'visit', 'approach', 'values', 'work', 'people', 'programs', 'overview', 'other'];
  const selected: T[] = [];
  for (const group of priority) {
    const matches = eligible.filter(topic => theme(topic) === group).sort((a, b) => {
      // Prefer substantive prose over a title-only description or a terse contact record.
      const substance = (topic: T) => Math.min(topic.body!.trim().split(/\s+/u).length, 120);
      return substance(b) - substance(a) || a.id.localeCompare(b.id);
    });
    selected.push(...matches.slice(0, group === 'other' ? 2 : 1));
    if (selected.length >= 6) return selected.slice(0, 6);
  }
  return selected;
}

function topicLabel(topic: EditorialTopic) {
  const title = topic.title.trim();
  if (/^about me$/i.test(title)) return 'My story';
  if (/^about(?:\s+(?:us|me|the\b.*|our\b.*|.+))?$/i.test(title)) return 'Our story';
  if (/^(?:organization|organisation|business|company|practice|studio|person|profile|biography|team)$/.test(normalized(topic.kind))) return `Meet ${title}`;
  if (/^(?:home|overview|welcome)$/i.test(title)) return 'Meet the business';
  return title;
}

export type GreetingTopicChoice = { label: string; point: GreetingPoint; topic?: GreetingTopic };

/** A small shortlist for an opening conversation; stored selections remain independently resolvable. */
export function greetingTopicChoices(content: Pick<SiteContent, 'name' | 'description' | 'hours' | 'contact' | 'sections'>, catalog?: KnowledgeCatalog | null, records: GreetingRecordTopic[] = []): GreetingTopicChoice[] {
  const candidates: (EditorialTopic & { point: GreetingPoint })[] = [
    ...content.sections.map(section => ({ id: `section:${section.id}`, title: section.title, kind: 'section', body: section.body, point: { kind: 'source' as const, id: `section:${section.id}` } })),
    ...(catalog?.entities.map(entity => ({ id: entity.id, title: entity.name, kind: entity.kind,
      body: entity.blocks?.filter(block => block.kind === 'paragraph').map(block => block.text).join('\n\n') || entity.summary,
      point: { kind: 'entity' as const, id: entity.id } })) ?? []),
    ...records.map(record => ({ ...record, kind: record.kind ?? '', point: { kind: 'record' as const, id: record.id } })),
  ];
  const editorial = selectGreetingEditorialTopics(candidates);
  const choices = editorial.map(candidate => ({ label: topicLabel(candidate), point: candidate.point }));
  if (content.description && !editorial.some(topic => ['story', 'overview'].includes(theme(topic)))) choices.unshift({ label: `Meet ${content.name}`, point: { kind: 'source', id: 'overview' } });
  if (content.hours && !editorial.some(topic => /\b(?:hours|visit)\b/i.test(topic.title))) choices.push({ label: 'Opening hours', point: { kind: 'source', id: 'hours' } });
  if (content.contact && !editorial.some(topic => theme(topic) === 'visit')) choices.push({ label: 'Getting in touch', point: { kind: 'source', id: 'contact' } });
  return choices.slice(0, 8).map(choice => ({ ...choice, topic: greetingPointTopic(choice.point, content, catalog, records) ?? undefined }));
}
