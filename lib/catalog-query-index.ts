import 'server-only';
import { evaluateQuery } from './catalog-query';
import { createHash } from 'node:crypto';
import { validatePublicationSpace, type PublicationSpace, type CanonicalRecord, type RecordAssertion } from '@thevoice/platform-ui/collection-space';

export const QUERY_INDEX_LIMITS = { records: 10_160, indexBytes: 128 * 1024 * 1024, cacheBytes: 256 * 1024 * 1024, readBytes: 128 * 1024 * 1024, chunks: 1024 } as const;
export function canonicalJson(input: unknown): string {
  if (input === undefined) return 'null';
  if (Array.isArray(input)) return `[${input.map(canonicalJson).join(',')}]`;
  if (input && typeof input === 'object') return `{${Object.entries(input).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${canonicalJson(value)}`).join(',')}}`;
  return JSON.stringify(input);
}
export const queryHash = (input: unknown) => createHash('sha256').update(canonicalJson(input)).digest('hex');
export type CompiledQueryIndex = {
  space: PublicationSpace; hash: string; bytes: number; records: Map<string, CanonicalRecord>; ordinals: Map<string, number>;
  direct: Map<string, Set<string>>; descendants: Map<string, Set<string>>;
  assertions: Map<string, Map<string, RecordAssertion[]>>;
  outgoing: Map<string, PublicationSpace['relationships']>; incoming: Map<string, PublicationSpace['relationships']>;
  tokens: Map<string, Set<string>>;
};
const words = (text: string) => [...new Set(text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
/** Add full public reading text without retaining article bodies in compact record cards. */
export const publishedReadingTerms = (record: CanonicalRecord) => ({ id: record.id, terms: words([record.name, ...record.aliases, record.summary, ...record.blocks.map(block => block.text)].join(' ')) });
export function indexPublishedTerms(index: CompiledQueryIndex, records: { id: string; terms: string[] }[]) {
  for (const record of records) {
    const id = index.records.get(record.id)?.id;
    if (!id) throw new Error('Reading content is outside the publication index.');
    for (const token of record.terms) {
      const posting = index.tokens.get(token);
      if (posting?.has(id)) continue;
      index.bytes += 96 + id.length * 2 + (posting ? 0 : 96 + token.length * 2);
      if (index.bytes > QUERY_INDEX_LIMITS.indexBytes) throw new Error('Published reading exceeds the query index memory ceiling.');
      const entries = posting ?? new Set<string>(); entries.add(id); index.tokens.set(token, entries);
    }
  }
}
export function indexPublishedReading(index: CompiledQueryIndex, records: CanonicalRecord[]) {
  indexPublishedTerms(index, records.map(publishedReadingTerms));
}
/** Immutable derivative of one already-authorized publication. Authorization is never cached. */
export function compileQueryIndex(input: unknown): CompiledQueryIndex {
  const space = validatePublicationSpace(input), serialized = JSON.stringify(space);
  const bytes = Buffer.byteLength(serialized) * 3;
  if (bytes > QUERY_INDEX_LIMITS.indexBytes) throw new Error('Publication exceeds the compiled index memory ceiling.');
  const index: CompiledQueryIndex = { space, hash: queryHash(space), bytes, records: new Map(), ordinals: new Map(), direct: new Map(), descendants: new Map(), assertions: new Map(), outgoing: new Map(), incoming: new Map(), tokens: new Map() };
  for (const [ordinal, record] of space.records.entries()) {
    index.records.set(record.id, record); index.ordinals.set(record.id, ordinal);
    const fields = new Map<string, RecordAssertion[]>();
    for (const fact of record.assertions) fields.set(fact.fieldId, [...fields.get(fact.fieldId) ?? [], fact]);
    index.assertions.set(record.id, fields);
    for (const token of words([record.name, ...record.aliases, record.summary, ...record.blocks.map(block => block.text)].join(' '))) { const posting = index.tokens.get(token) ?? new Set(); posting.add(record.id); index.tokens.set(token, posting); }
  }
  for (const collection of space.collections) index.direct.set(collection.id, new Set());
  for (const membership of space.memberships) index.direct.get(membership.collectionId)!.add(membership.recordId);
  const children = new Map<string, string[]>();
  for (const edge of space.edges) children.set(edge.parentId, [...children.get(edge.parentId) ?? [], edge.childId]);
  function descendants(id: string): Set<string> {
    const cached = index.descendants.get(id); if (cached) return cached;
    const result = new Set([id]); for (const child of children.get(id) ?? []) for (const member of descendants(child)) result.add(member);
    index.descendants.set(id, result); return result;
  }
  for (const collection of space.collections) descendants(collection.id);
  for (const relation of space.relationships) {
    index.outgoing.set(relation.fromId, [...index.outgoing.get(relation.fromId) ?? [], relation]);
    index.incoming.set(relation.toId, [...index.incoming.get(relation.toId) ?? [], relation]);
  }
  const materialized = new Set<string>();
  function materialize(id: string) {
    if (materialized.has(id)) return;
    const definition = space.collections.find(collection => collection.id === id)?.derived;
    if (definition) {
      for (const root of [definition.scope.collectionId, ...definition.scope.include ?? []]) for (const upstream of definition.scope.traversal === 'direct' ? [root] : index.descendants.get(root)!) materialize(upstream);
      const result = evaluateQuery(index, { version: 2, publication: space.publication, queryId: 'derived-query', revision: 0, scope: definition.scope, where: definition.where, preferences: [], order: [], asOf: definition.asOf, timeZone: 'UTC' }, { alternatives: false });
      index.direct.set(id, new Set(result.ordered));
    }
    materialized.add(id);
  }
  for (const collection of space.collections) materialize(collection.id);
  return index;
}
export class QueryIndexCache {
  private entries = new Map<string, CompiledQueryIndex>();
  private bytes = 0;
  private pending = new Map<string, Promise<CompiledQueryIndex>>();
  constructor(private readonly maxBytes: number = QUERY_INDEX_LIMITS.cacheBytes) {}
  get(key: string) { const value = this.entries.get(key); if (value) { this.entries.delete(key); this.entries.set(key, value); } return value; }
  set(key: string, value: CompiledQueryIndex) {
    if (value.bytes > this.maxBytes) throw new Error('Index exceeds cache budget.');
    const old = this.entries.get(key); if (old) { this.bytes -= old.bytes; this.entries.delete(key); }
    while (this.bytes + value.bytes > this.maxBytes) { const key = this.entries.keys().next().value!; this.bytes -= this.entries.get(key)!.bytes; this.entries.delete(key); }
    this.entries.set(key, value); this.bytes += value.bytes;
  }
  async prepare(key: string, build: () => Promise<CompiledQueryIndex>) {
    const cached = this.get(key); if (cached) return cached;
    const pending = this.pending.get(key); if (pending) return pending;
    if (this.pending.size >= 8) throw new Error('Publication preparation capacity reached.');
    const work = Promise.resolve().then(build).then(index => { this.set(key, index); return index; }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, work); return work;
  }
  get sizeBytes() { return this.bytes; }
}
