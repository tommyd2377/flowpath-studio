import type { CanonicalRecord, RecordAssertion } from '@thevoice/platform-ui/collection-space';
import type { FieldDescriptor, TypedValue } from '@thevoice/platform-ui/query';
import { assertionActive } from '@thevoice/platform-ui/knowledge';
import { greetingDescription, GREETING_POINT_CONTEXT_LIMIT } from './site-greeting';

export type GreetingRecordTopic = { id: string; title: string; body: string; kind?: string };

const valueText = (value: TypedValue | null) => value
  ? `${value.currency ? `${value.currency} ` : ''}${Array.isArray(value.value) ? value.value.join(', ') : typeof value.value === 'object' ? JSON.stringify(value.value) : String(value.value)}${value.unit ? ` ${value.unit}` : ''}${value.basis ? ` / ${value.basis}` : ''}`
  : 'Unknown';

/** Keep competing assertions, dates and qualifications together, as on published item details. */
function fieldText(assertions: RecordAssertion[], asOf: string) {
  const active = assertions.filter(assertion => assertionActive(assertion, asOf));
  const selected = active.length ? active : assertions;
  const plain = active.filter(assertion => !assertion.conditions.length && assertion.polarity === 'affirmed' && assertion.value !== null);
  const values = new Set(plain.map(assertion => JSON.stringify(assertion.value)));
  const conflicting = values.size > 1 || active.some(assertion => assertion.polarity === 'denied' && !assertion.conditions.length && values.has(JSON.stringify(assertion.value)));
  const state = !active.length ? 'Unknown at this time. ' : conflicting ? 'Conflicting approved assertions. ' : active.some(assertion => assertion.conditions.length || assertion.polarity === 'denied') ? 'Conditions apply. ' : '';
  return state + selected.map(assertion => `${assertion.polarity === 'denied' ? 'Not asserted: ' : ''}${valueText(assertion.value)}${assertion.conditions.length ? ` — ${assertion.conditions.join('; ')}` : ''}${assertion.validFrom ? ` · from ${assertion.validFrom}` : ''}${assertion.validTo ? ` · until ${assertion.validTo}` : ''}`).join('. ');
}

/** A complete description plus up to two complete field groups; never clip a condition to fit. */
export function greetingRecordTopic(record: CanonicalRecord, fields: FieldDescriptor[], asOf = new Date().toISOString()): GreetingRecordTopic {
  const description = greetingDescription(record.summary, record.blocks);
  const parts = description ? [description] : [];
  let added = 0, overlongField = '';
  for (const field of fields) {
    const assertions = record.assertions.filter(assertion => assertion.fieldId === field.id);
    if (!assertions.length) continue;
    const text = `${field.label}: ${fieldText(assertions, asOf)}`;
    if ([record.name, ...parts, text].join('. ').length <= GREETING_POINT_CONTEXT_LIMIT) { parts.push(text); added++; }
    else if (!overlongField) overlongField = text;
    if (added === 2) break;
  }
  // An overlong source paragraph remains whole so the greeting validator can ask
  // for a shorter approved topic instead of silently dropping its final caveat.
  return { id: record.id, title: record.name, body: parts.join('\n\n') || overlongField || 'No further description has been published.', kind: record.type };
}
