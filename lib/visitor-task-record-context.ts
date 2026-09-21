import type { CanonicalRecord } from '@thevoice/platform-ui/collection-space';

export type TaskRecordContext = Pick<CanonicalRecord, 'id' | 'name'> & {
  summary?: string; blocks: CanonicalRecord['blocks']; assertions: CanonicalRecord['assertions'];
  omittedAssertions: number; omittedBlocks: number; summaryOmitted: boolean;
};

/** Identity is always retained; optional evidence is admitted under the byte budget. */
export function taskRecordContext(record: CanonicalRecord): TaskRecordContext {
  return { id: record.id, name: record.name, blocks: [], assertions: [], omittedAssertions: record.assertions.length, omittedBlocks: record.blocks.length, summaryOmitted: Boolean(record.summary) };
}

/** Never truncate a fact's conditions, dates, polarity, or competing assertions.
 * A whole field group either fits or remains available through records.lookup. */
export function serializeTaskRecordContext(data: object, records: { source: CanonicalRecord; target: TaskRecordContext }[], maxBytes: number): string {
  const fits = () => Buffer.byteLength(JSON.stringify(data)) <= maxBytes;
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
  return JSON.stringify(data);
}
