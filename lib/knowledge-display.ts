import type { FactSelection } from '@thevoice/platform-ui/knowledge';
import type { CatalogFact } from '@thevoice/platform-ui/contracts';

/** Approved qualifications travel with the value, not just a vague warning. */
export function knowledgeValueText(value: FactSelection, facts: (CatalogFact & { display: string })[]) {
  if (!['qualified', 'conflict'].includes(value.status)) return value.display;
  const assertions = facts.filter(fact => value.factIds.includes(fact.id)).map(fact => `${fact.polarity === 'denied' ? 'Not asserted: ' : ''}${fact.display}${fact.qualifiers?.length ? ` — ${fact.qualifiers.map(item => `${item.predicate.replaceAll('-', ' ')}: ${item.value}`).join('; ')}` : ''}`);
  return `${value.display}${assertions.length ? `. ${assertions.join('. ')}` : ''}`;
}
