import type { CanonicalRecord } from '@thevoice/platform-ui/collection-space';

export type TaskRecordContext = Pick<CanonicalRecord, 'id' | 'name'> & {
  summary?: string; blocks: CanonicalRecord['blocks']; assertions: CanonicalRecord['assertions'];
  omittedAssertions: number; omittedBlocks: number; summaryOmitted: boolean;
};

/** Identity is always retained; optional evidence is admitted under the byte budget. */
export function taskRecordContext(record: CanonicalRecord): TaskRecordContext {
  return { id: record.id, name: record.name, blocks: [], assertions: [], omittedAssertions: record.assertions.length, omittedBlocks: record.blocks.length, summaryOmitted: Boolean(record.summary) };
}

type ContextObject = Record<string, unknown>;
const object = (value: unknown): ContextObject | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as ContextObject : undefined;
const objects = (value: unknown): ContextObject[] => Array.isArray(value) ? value.flatMap(item => { const parsed = object(item); return parsed ? [parsed] : []; }) : [];
function project(value: ContextObject, keys: string[]) { return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]])); }

/** Reduce descriptive duplicates before admitting evidence. Query semantics and
 * acknowledged identities/order are never shortened to make the prompt fit. */
function compactTaskContext(data: object, maxBytes: number): object {
  const projected: ContextObject = { ...data }, omitted: string[] = [];
  projected.contextProjection = { omitted, retrieve: 'Retrieve omissions: schema.describe, records.lookup, research.recall/history. Confirmed IDs/order unchanged.' };
  const fits = () => Buffer.byteLength(JSON.stringify(projected)) <= maxBytes;
  const scope = object(projected.scope);
  if (scope) {
    const collectionKeys = ['id', 'name'];
    projected.scope = { ...scope,
      ...(object(scope.collection) ? { collection: project(object(scope.collection)!, collectionKeys) } : {}),
      children: objects(scope.children).map(child => project(child, collectionKeys)),
      fields: objects(scope.fields).map(field => project(field, ['id', 'label', 'type', 'recordTypes', 'cardinality', 'unit', 'currency', 'basis', 'timeZone', 'operations', 'filter', 'sort', 'facet'])),
    };
    omitted.push('scope descriptions/layout and field aliases/values/coverage');
    if (fits()) return projected;
  }
  const results = object(projected.results);
  if (results) {
    projected.results = { ...results, records: objects(results.records).map(record => project(record, ['id', 'name'])) };
    omitted.push('results.records summaries');
    if (fits()) return projected;
  }
  // A bounded recall directory avoids an extra history round; larger findings
  // remain optional. Preserve its exact identity/date/scope while prose shrinks.
  for (const key of ['researchMemory', 'priorCards']) if (projected[key] && (key !== 'researchMemory' || Buffer.byteLength(JSON.stringify(projected[key])) > 512)) {
    delete projected[key]; omitted.push(key);
    if (fits()) return projected;
  }
  const research = object(projected.displayedResearch);
  if (research) {
    projected.displayedResearch = { id: research.id, detailsOmitted: true };
    omitted.push('displayedResearch details; research.recall retains the complete evidence');
    if (fits()) return projected;
  }
  // The full confirmed directory stays authoritative. Other active identities get
  // a separate directory, so evidence omission never makes a record disappear.
  const displayed = objects(object(projected.displayedPage)?.records);
  for (const key of ['activeRecords', 'surfaceRecords']) {
    const records = objects(projected[key]);
    if (records.length <= 6) continue;
    projected[key] = records.slice(0, 6);
    const directory = records.slice(6).filter(record => !displayed.some(entry => entry.id === record.id && entry.name === record.name)).map(record => project(record, ['id', 'name']));
    if (directory.length) projected[`${key}Directory`] = directory;
    omitted.push(`${key}: ${records.length - 6} details omitted; IDs/names in displayedPage or ${key}Directory`);
    if (fits()) return projected;
  }
  const scene = object(projected.scene);
  if (scene && Array.isArray(scene.recordIds)) {
    projected.scene = { ...scene, records: objects(scene.records).filter(record => !displayed.some(entry => entry.id === record.id && entry.name === record.name)) };
    omitted.push('scene names duplicate displayedPage; recordIds unchanged');
    if (fits()) return projected;
  }
  const activeCard = object(projected.activeCard), referenceIds = activeCard?.referenceIds;
  if (activeCard && Array.isArray(referenceIds) && referenceIds.length && referenceIds.length === displayed.length && referenceIds.every((id, i) => id === displayed[i].id)) {
    const compactCard = { ...activeCard }; delete compactCard.referenceIds;
    projected.activeCard = { ...compactCard, referenceIdsFrom: 'displayedPage.records' };
    omitted.push('activeCard.referenceIds repeat displayedPage.records IDs in exact order');
    if (fits()) return projected;
  }
  const estimate = object(projected.estimate);
  if (estimate && (objects(estimate.priceOptions).length || objects(estimate.taxResearch).length)) {
    projected.estimate = { ...estimate, priceOptions: [], taxResearch: [],
      omittedPriceOptions: Number(estimate.omittedPriceOptions ?? 0) + objects(estimate.priceOptions).length,
      omittedTaxResearch: [...new Set([...(Array.isArray(estimate.omittedTaxResearch) ? estimate.omittedTaxResearch : []), ...objects(estimate.taxResearch).map(entry => entry.resultId)])] };
    omitted.push('estimate price options/research excerpts omitted; records.lookup and research.recall retain exact evidence');
    if (fits()) return projected;
  }
  if (estimate && objects(estimate.lines).length) {
    projected.estimate = { ...project(estimate, ['revision', 'currency']), lines: objects(estimate.lines).map(line => project(line, ['recordId', 'fieldId', 'quantity'])), detailsOmitted: true };
    omitted.push('estimate names/prices/tax details omitted; use estimate.read before stating totals or tax assumptions');
    if (fits()) return projected;
  }
  // Handles repeat the same visitor/publication envelope. Factor only exact
  // duplicates; keep each handle's ID, type, authority, dates and dependencies.
  const evidence = objects(projected.evidence);
  if (evidence.length > 1) {
    const shared = ['sessionId', 'publication', 'generation'].filter(key => evidence[0][key] !== undefined && evidence.every(handle => JSON.stringify(handle[key]) === JSON.stringify(evidence[0][key])));
    if (shared.length) {
      projected.evidenceScope = project(evidence[0], shared);
      projected.evidence = evidence.map(handle => Object.fromEntries(Object.entries(handle).filter(([key]) => !shared.includes(key))));
      omitted.push('evidence entries inherit evidenceScope; per-handle authority, expiry and dependencies are unchanged');
      if (fits()) return projected;
    }
  }
  // Imported references and labels are longer than synthetic fixture IDs. When
  // authority alone fills the budget, omit labels rather than any reference or
  // query constraint. Lookup restores the complete names before an answer.
  if (results) {
    projected.results = { ...object(projected.results), records: objects(results.records).map(record => project(record, ['id'])) };
    omitted.push('results.records names; use records.lookup');
    if (fits()) return projected;
  }
  if (activeCard?.title) {
    const card = { ...object(projected.activeCard) }; delete card.title; projected.activeCard = card;
    omitted.push('activeCard title');
    if (fits()) return projected;
  }
  const compactScope = object(projected.scope);
  if (compactScope) {
    projected.scope = { ...compactScope,
      ...(object(compactScope.collection) ? { collection: project(object(compactScope.collection)!, ['id']) } : {}),
      children: objects(compactScope.children).map(child => project(child, ['id'])),
      fields: objects(compactScope.fields).map(field => Object.fromEntries(Object.entries(field).filter(([key]) => key !== 'label'))),
    };
    omitted.push('scope names/labels; use schema.describe; typed metadata and exact childScopes unchanged');
    if (fits()) return projected;
  }
  if (displayed.length) {
    projected.displayedPage = { ...object(projected.displayedPage), records: displayed.map(record => Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'name'))) };
    omitted.push('displayedPage names; use records.lookup; every confirmed ID/code/order is unchanged');
    if (fits()) return projected;
  }
  // A growing chain can need more handle authority than the initial prompt.
  // Schema descriptors are retrievable; omit them whole instead of shortening
  // query criteria, basket references, citation authority or confirmed results.
  const finalScope = object(projected.scope), fields = objects(finalScope?.fields);
  if (finalScope && fields.length) {
    projected.scope = { ...finalScope, fields: [], omittedFields: Number(finalScope.omittedFields ?? 0) + fields.length };
    omitted.push('scope.fields omitted in full; schema.describe retrieves exact typed descriptors before new field operations');
  }
  return projected;
}

/** Never truncate a fact's conditions, dates, polarity, or competing assertions.
 * A whole field group either fits or remains available through records.lookup. */
export function serializeTaskRecordContext(data: object, records: { source: CanonicalRecord; target: TaskRecordContext }[], maxBytes: number): string {
  const context = Buffer.byteLength(JSON.stringify(data)) <= maxBytes ? data : compactTaskContext(data, maxBytes);
  const fits = () => Buffer.byteLength(JSON.stringify(context)) <= maxBytes;
  if (!fits()) throw new Error('Task context exceeds its configured ceiling.');
  const candidates = records.slice(0, 6).map(record => ({ ...record, groups: [...Map.groupBy(record.source.assertions, fact => fact.fieldId).values()] }));
  // Round-robin gives each visible record evidence before filling one record.
  const rounds = Math.max(0, ...candidates.map(record => record.groups.length));
  for (let round = 0; round < rounds; round++) for (const { target, groups } of candidates) {
    const group = groups[round]; if (!group) continue;
    target.assertions.push(...group); target.omittedAssertions -= group.length;
    if (!fits()) { target.assertions.splice(-group.length); target.omittedAssertions += group.length; }
  }
  for (const { source, target } of candidates) {
    target.summary = source.summary; target.summaryOmitted = false;
    if (!fits()) { delete target.summary; target.summaryOmitted = Boolean(source.summary); }
    for (const block of source.blocks.slice(0, 2)) {
      target.blocks.push(block); target.omittedBlocks--;
      if (!fits()) { target.blocks.pop(); target.omittedBlocks++; }
    }
  }
  return JSON.stringify(context);
}
