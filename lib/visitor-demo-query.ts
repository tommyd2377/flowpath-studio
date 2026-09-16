import 'server-only';
import { websiteQueryCommand } from './visitor-query-command';
import type { CapabilityContext } from './visitor-capabilities';

/** Conservative offline preview. Connected interpretation uses the same typed capabilities. */
export function demoWebsiteQuery(text: string, context: CapabilityContext): { capabilityId: string; input: unknown } {
  const value = text.toLocaleLowerCase().replace(/[.!?]+$/, '').trim();
  const clarify = (question: string) => ({ capabilityId: 'task.clarify', input: { question, options: [] } });
  if (/^(?:go )?back(?: to (?:those |the )?results)?$/.test(value)) return { capabilityId: 'view.back', input: { target: value.includes('results') ? 'results' : 'previous' } };
  if (/^(?:show(?: me)? everything(?: again)?|clear (?:all )?filters|remove (?:all )?filters)$/.test(value)) return { capabilityId: 'view.reset', input: {} };
  if (/^open\b/.test(value)) {
    const ordinal = value.match(/\b(first|second|third|fourth|fifth|\d+)(?: one| result)?\b/);
    if (ordinal) {
      const scene = context.session.viewport;
      const index = ['first', 'second', 'third', 'fourth', 'fifth'].indexOf(ordinal[1]);
      const id = scene?.recordIds[(index >= 0 ? index + 1 : Number(ordinal[1])) - 1];
      return id ? { capabilityId: 'record.detail', input: { recordId: id } } : clarify('Which item? Use its name or bring the results into view.');
    }
    const name = value.replace(/^open (?:the )?/, '');
    const matches = context.index.space.records.filter(record => record.name.toLocaleLowerCase() === name);
    return matches.length === 1 ? { capabilityId: 'record.detail', input: { recordId: matches[0].id } } : clarify('Which published item would you like to open?');
  }
  return websiteQueryCommand(text, context) ?? clarify('Name a collection, search term or published attribute to change the website.');
}
