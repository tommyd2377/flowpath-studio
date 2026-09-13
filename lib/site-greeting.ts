import type { SiteContent } from './site-model';
import { z } from 'zod';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { retrieveKnowledge } from '@thevoice/platform-ui/knowledge';
import { AppError } from './errors';
import { knowledgeValueText } from './knowledge-display';

export const greetingPointSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['source', 'entity', 'fact']), id: z.string().min(1).max(100) }).strict(),
  z.object({ kind: z.literal('custom'), text: z.string().trim().min(1).max(180) }).strict(),
]);
export type GreetingPoint = z.infer<typeof greetingPointSchema>;
export function greetingPointText(point: GreetingPoint, content: Pick<SiteContent, 'name' | 'description' | 'hours' | 'contact' | 'sections'>, catalog?: KnowledgeCatalog | null): string | null {
  if (point.kind === 'custom') return point.text;
  if (point.kind === 'entity') return catalog?.entities.find(entity => entity.id === point.id)?.name ?? null;
  if (point.kind === 'fact') {
    const fact = catalog?.facts?.find(fact => fact.id === point.id);
    if (!catalog || !fact) return null;
    const result = retrieveKnowledge(catalog, { revisionId: catalog.id, factIds: [point.id], expansion: 0 });
    const value = result.values.find(value => value.entityId === fact.entityId && value.field === fact.field);
    return value ? `${fact.definition?.label ?? fact.field}: ${knowledgeValueText(value, result.facts)}` : null;
  }
  return point.id === 'overview' ? content.description || null : point.id === 'hours' ? content.hours || null : point.id === 'contact' ? content.contact || null
    : content.sections.find(section => `section:${section.id}` === point.id)?.body ?? null;
}
export function validateGreeting(content: SiteContent, catalog?: KnowledgeCatalog | null) {
  for (const point of content.greetingPoints ?? []) if (point) {
    const text = greetingPointText(point, content, catalog);
    if (!text) throw new AppError('A spoken greeting point is no longer available. Update Voice welcome before publishing.', 400);
    if (text.length > 300) throw new AppError('A spoken greeting point is too long. Choose a shorter point or write a concise publisher-approved point.', 400);
  }
}
export function pruneGreeting(content: SiteContent, catalog?: KnowledgeCatalog | null): SiteContent {
  if (!content.greetingPoints) return content;
  return { ...content, greetingPoints: content.greetingPoints.map(point => point && greetingPointText(point, content, catalog) ? point : null) };
}
export function pruneGreetingSources(content: SiteContent): SiteContent {
  return content.greetingPoints ? { ...content, greetingPoints: content.greetingPoints.map(point => point?.kind === 'source' && !greetingPointText(point, content) ? null : point) } : content;
}

export const WELCOME_MESSAGE_MAX_LENGTH = 500;

export function defaultWelcomeMessage(name: string) {
  return `Hi, welcome to ${name}. I'm the site's AI assistant. What would you like to know?`;
}

export function getWelcomeMessage(content: Pick<SiteContent, 'name' | 'welcomeMessage'> & Partial<SiteContent>, catalog?: KnowledgeCatalog | null) {
  if (content.greetingPoints?.some(Boolean)) {
    const complete = { description: '', hours: '', contact: '', sections: [], ...content };
    const points = content.greetingPoints.flatMap(point => point ? greetingPointText(point, complete, catalog) ?? [] : []);
    if (points.length) return `Welcome to ${content.name}. I'm the site's AI assistant. ${points.map(text => /[.!?]$/.test(text) ? text : `${text}.`).join(' ')} What would you like to explore?`;
  }
  return content.welcomeMessage?.trim() || defaultWelcomeMessage(content.name);
}
