import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonicalRecordSchema, membershipSchema, recordRelationshipSchema, publicationSpaceSchema, validatePublicationSpace, type PublicationSpace } from '@thevoice/platform-ui/collection-space';
import { queryHash, compileQueryIndex, indexPublishedTerms, publishedReadingTerms, QUERY_INDEX_LIMITS, type CompiledQueryIndex } from './catalog-query-index';
import { taskDocuments, type TaskDocuments } from './task-persistence';

export const catalogMetadataSchema = publicationSpaceSchema.omit({ records: true, memberships: true, relationships: true, publication: true });
export const catalogImportChunkSchema = z.object({ records: z.array(canonicalRecordSchema).max(100), memberships: z.array(membershipSchema).max(400), relationships: z.array(recordRelationshipSchema).max(400) }).strict();
const chunkRefSchema = z.object({ id: z.string().length(64), hash: z.string().length(64), bytes: z.number().int().min(1).max(600_000), count: z.number().int().nonnegative(), kind: z.enum(['records', 'memberships', 'relationships', 'index', 'reading']), firstId: z.string().optional(), lastId: z.string().optional() }).strict();
const manifestSchema = z.object({ version: z.literal(2), id: z.string().uuid(), siteId: z.string().uuid(), reviewId: z.string().uuid().optional(), revision: z.number().int(), metadata: catalogMetadataSchema,
  chunks: z.array(chunkRefSchema).max(1024), recordCount: z.number().int().max(10_000), contentHash: z.string().length(64), indexHash: z.string().length(64) }).strict();
export type CatalogManifest = z.infer<typeof manifestSchema>;
const reviewSchema = z.object({ version: z.literal(2), id: z.string().uuid(), siteId: z.string().uuid(), revision: z.number().int(), baseSiteRevision: z.number().int(), status: z.enum(['importing', 'review', 'applying', 'applied']),
  baselineMetadataHash: z.string().length(64).optional(), recordCorrections: z.record(z.string(), z.string().length(64)).default({}),
  metadata: catalogMetadataSchema, imports: z.array(z.string().length(64)).max(200), recordCount: z.number().int().min(0).max(10_000), manifestId: z.string().uuid().optional(),
  removedMemberships: z.array(membershipSchema).max(1000), addedMemberships: z.array(membershipSchema).max(1000),
}).strict();
export type CatalogReview = z.infer<typeof reviewSchema>;
// Four independent immutable reads at a time, preserving manifest order.
async function readChunks<T, R>(values: T[], read: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, values.length) }, async () => {
    while (next < values.length) { const position = next++; results[position] = await read(values[position]); }
  }));
  return results;
}
export class CatalogRepository {
  private manifests = new Map<string, CatalogManifest>();
  private chunks = new Map<string, { data: unknown[]; bytes: number }>();
  private chunkBytes = 0;
  constructor(private readonly publications: TaskDocuments = taskDocuments('catalogPublications'), private readonly reviews: TaskDocuments = taskDocuments('catalogReviews'), private readonly cacheReads = false) {}
  async begin(siteId: string, baseSiteRevision: number, metadata: unknown, previousReviewId?: string) {
    const incoming = catalogMetadataSchema.parse(metadata), baselineMetadataHash = queryHash(incoming); await this.immutable(this.reviews, baselineMetadataHash, incoming);
    const previous = previousReviewId ? await this.review(siteId, previousReviewId) : null;
    if (previous) {
      const baseline = previous.baselineMetadataHash ? catalogMetadataSchema.parse(await this.reviews.read(previous.baselineMetadataHash)) : previous.metadata;
      const corrected = structuredClone(incoming);
      for (const key of ['name', 'rootId', 'edges', 'relationshipTypes', 'links'] as const) if (queryHash(previous.metadata[key]) !== queryHash(baseline[key])) Object.assign(corrected, { [key]: previous.metadata[key] });
      for (const key of ['fields', 'collections'] as const) {
        const updated = incoming[key].map(value => { const old = previous.metadata[key].find(old => old.id === value.id), original = baseline[key].find(old => old.id === value.id); return old && queryHash(old) !== queryHash(original) ? old : value; });
        for (const old of previous.metadata[key]) if (!incoming[key].some(value => value.id === old.id) && queryHash(old) !== queryHash(baseline[key].find(value => value.id === old.id))) updated.push(old);
        Object.assign(corrected, { [key]: updated });
      }
      metadata = corrected;
    }
    const review = reviewSchema.parse({ version: 2, id: randomUUID(), siteId, revision: 0, baseSiteRevision, status: 'importing', baselineMetadataHash, recordCorrections: previous?.recordCorrections ?? {}, metadata, imports: [], recordCount: 0, removedMemberships: previous?.removedMemberships ?? [], addedMemberships: previous?.addedMemberships ?? [] });
    await this.reviews.create(review.id, review);
    const key = `latest-${siteId}`, pointer = await this.reviews.read(key) as { revision: number } | null;
    if (pointer) await this.reviews.compareAndSwap(key, pointer.revision, { revision: pointer.revision + 1, reviewId: review.id });
    else await this.reviews.create(key, { revision: 0, reviewId: review.id });
    return review;
  }
  async latest(siteId: string) { z.string().uuid().parse(siteId); const pointer = await this.reviews.read(`latest-${siteId}`) as { reviewId: string } | null; return pointer ? this.reviewPage(siteId, pointer.reviewId) : null; }
  async review(siteId: string, id: string) { const review = reviewSchema.parse(await this.reviews.read(id)); if (review.siteId !== siteId) throw new Error('Private review belongs to another site.'); return review; }
  async append(siteId: string, id: string, revision: number, input: unknown) {
    const review = await this.review(siteId, id), chunk = catalogImportChunkSchema.parse(input);
    if (review.revision !== revision || review.status !== 'importing') throw new Error('Import changed or review already started.');
    const hash = queryHash(chunk); if (review.imports.includes(hash)) return review;
    if (review.recordCount + chunk.records.length > 10_000 || review.imports.length >= 200) throw new Error('Import exceeds the 10,000-record/200-chunk limit.');
    await this.immutable(this.reviews, hash, chunk);
    const next = reviewSchema.parse({ ...review, revision: revision + 1, imports: [...review.imports, hash], recordCount: review.recordCount + chunk.records.length });
    await this.reviews.compareAndSwap(id, revision, next); return next;
  }
  private async assembled(review: CatalogReview): Promise<PublicationSpace> {
    const records = new Map<string, PublicationSpace['records'][number]>(), memberships = new Map<string, PublicationSpace['memberships'][number]>(), relationships = new Map<string, PublicationSpace['relationships'][number]>();
    let bytes = 0;
    for (const id of review.imports) {
      const raw = await this.reviews.read(id); bytes += Buffer.byteLength(JSON.stringify(raw));
      if (bytes > QUERY_INDEX_LIMITS.readBytes || queryHash(raw) !== id) throw new Error('Import checksum or I/O ceiling failed.');
      const chunk = catalogImportChunkSchema.parse(raw);
      for (const record of chunk.records) { if (records.has(record.id) && queryHash(records.get(record.id)) !== queryHash(record)) throw new Error('Conflicting canonical record across chunks. Review identity.'); records.set(record.id, record); }
      for (const member of chunk.memberships) memberships.set(queryHash(member), member);
      for (const relation of chunk.relationships) { if (relationships.has(relation.id) && queryHash(relationships.get(relation.id)) !== queryHash(relation)) throw new Error('Conflicting relationship identity.'); relationships.set(relation.id, relation); }
    }
    for (const member of review.removedMemberships) memberships.delete(queryHash(member));
    for (const member of review.addedMemberships) if (records.has(member.recordId)) memberships.set(queryHash(member), member);
    for (const [id, hash] of Object.entries(review.recordCorrections)) {
      const incoming = records.get(id); if (!incoming) continue;
      const raw = await this.reviews.read(hash); if (queryHash(raw) !== hash) throw new Error('Record correction checksum failed.');
      const correction = z.object({ before: canonicalRecordSchema, after: canonicalRecordSchema }).strict().parse(raw);
      for (const key of ['name', 'summary', 'type', 'aliases', 'blocks'] as const) if (queryHash(correction.before[key]) !== queryHash(correction.after[key])) Object.assign(incoming, { [key]: correction.after[key] });
      incoming.assertions = incoming.assertions.filter(fact => !correction.before.assertions.some(old => old.id === fact.id) || correction.after.assertions.some(edited => edited.id === fact.id));
      for (const fact of correction.after.assertions) if (queryHash(fact) !== queryHash(correction.before.assertions.find(old => old.id === fact.id))) { const position = incoming.assertions.findIndex(old => old.id === fact.id); if (position < 0) incoming.assertions.push(fact); else incoming.assertions[position] = fact; }
    }
    return validatePublicationSpace({ ...review.metadata, publication: { siteId: review.siteId, revisionId: review.id, indexRevision: review.id }, records: [...records.values()], memberships: [...memberships.values()], relationships: [...relationships.values()] });
  }
  async finish(siteId: string, id: string, revision: number) {
    const review = await this.review(siteId, id); if (review.revision !== revision || !['importing', 'review'].includes(review.status)) throw new Error('Review changed.');
    const space = await this.assembled(review), manifest = await this.stage(siteId, space);
    const next = reviewSchema.parse({ ...review, revision: revision + 1, status: 'review', manifestId: manifest.id, recordCount: space.records.length });
    await this.reviews.compareAndSwap(id, revision, next); return next;
  }
  async edit(siteId: string, id: string, revision: number, input: { patch?: { id: string; name?: string; summary?: string; assertion?: { id: string; value: unknown } }; record?: unknown; metadata?: unknown; membership?: { recordId: string; collectionId: string; included: boolean } }) {
    const review = await this.review(siteId, id); if (review.revision !== revision || review.status !== 'review') throw new Error('Review changed.');
    if (input.patch) {
      const record = (await this.assembled(review)).records.find(record => record.id === input.patch!.id); if (!record) throw new Error('Record is not in this review.');
      if (input.patch.name !== undefined) record.name = input.patch.name; if (input.patch.summary !== undefined) record.summary = input.patch.summary;
      if (input.patch.assertion) { const fact = record.assertions.find(fact => fact.id === input.patch!.assertion!.id); if (!fact) throw new Error('Unknown record assertion.'); fact.value = input.patch.assertion.value as typeof fact.value; }
      input.record = canonicalRecordSchema.parse(record);
    }
    if (input.record) {
      const after = canonicalRecordSchema.parse(input.record), current = (await this.assembled(review)).records.find(record => record.id === after.id);
      if (!current) throw new Error('Record is not in this review.');
      const previous = review.recordCorrections[after.id] ? await this.reviews.read(review.recordCorrections[after.id]) as { before: unknown } : null;
      const correction = { before: previous ? canonicalRecordSchema.parse(previous.before) : current, after }, hash = queryHash(correction);
      if (!review.recordCorrections[after.id] && Object.keys(review.recordCorrections).length >= 1000) throw new Error('Record correction capacity reached.');
      await this.immutable(this.reviews, hash, correction); review.recordCorrections[after.id] = hash;
    }
    if (input.metadata) review.metadata = catalogMetadataSchema.parse(input.metadata);
    if (input.membership) {
      const { included, ...member } = input.membership;
      review.removedMemberships = review.removedMemberships.filter(value => queryHash(value) !== queryHash(member)); review.addedMemberships = review.addedMemberships.filter(value => queryHash(value) !== queryHash(member));
      (included ? review.addedMemberships : review.removedMemberships).push(member);
    }
    const manifest = await this.stage(siteId, await this.assembled(review));
    const next = reviewSchema.parse({ ...review, revision: revision + 1, manifestId: manifest.id }); await this.reviews.compareAndSwap(id, revision, next); return next;
  }
  async reviewPage(siteId: string, id: string, offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) throw new Error('Invalid review offset.');
    const review = await this.review(siteId, id);
    if (!review.manifestId) return { review, records: [], memberships: [], nextOffset: null };
    const manifest = await this.manifest(siteId, review.manifestId), spaceIndex = await this.index(siteId, manifest.id), ids = [...spaceIndex.records.keys()].slice(offset, offset + 24), records = await this.records(manifest, ids);
    let used = Buffer.byteLength(JSON.stringify(review)); const preview: typeof records = [];
    for (const record of records) {
      const bounded = { ...record, assertions: record.assertions.slice(0, 32), blocks: record.blocks.slice(0, 4) };
      const bytes = Buffer.byteLength(JSON.stringify(bounded)); if (preview.length && used + bytes > 600_000) break; if (used + bytes > 600_000) throw new Error('Review metadata and record exceed the preview ceiling. Narrow the import metadata.'); used += bytes; preview.push(bounded);
    }
    return { review, records: preview, truncatedRecords: preview.filter(record => { const original = records.find(value => value.id === record.id)!; return record.assertions.length < original.assertions.length || record.blocks.length < original.blocks.length; }).map(record => record.id), memberships: spaceIndex.space.memberships.filter(member => ids.includes(member.recordId)), nextOffset: offset + preview.length < manifest.recordCount ? offset + preview.length : null };
  }
  async claimApply(siteId: string, id: string, revision: number) {
    const review = await this.review(siteId, id); if (review.revision !== revision || review.status !== 'review') throw new Error('Review changed.');
    const next = { ...review, revision: revision + 1, status: 'applying' as const }; await this.reviews.compareAndSwap(id, revision, next); return next;
  }
  async markApplied(siteId: string, id: string, revision: number) { const review = await this.review(siteId, id); if (review.revision !== revision || review.status !== 'applying') throw new Error('Review changed.'); const next = { ...review, status: 'applied' as const, revision: revision + 1 }; await this.reviews.compareAndSwap(id, revision, next); return next; }
  private async immutable(store: TaskDocuments, id: string, value: unknown) {
    const text = JSON.stringify(value); if (Buffer.byteLength(text) > 600_000) throw new Error('Chunk exceeds 600 KB. Split the import.');
    try { await store.create(id, value); } catch (error) { if (queryHash(await store.read(id)) !== queryHash(value)) throw error; }
  }
  async stage(siteId: string, input: PublicationSpace): Promise<CatalogManifest> {
    const id = randomUUID();
    const space = validatePublicationSpace({ ...input, publication: { ...input.publication, revisionId: id, indexRevision: id }, records: [...input.records].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }); if (space.publication.siteId !== siteId) throw new Error('Wrong publication site.');
    const chunks: CatalogManifest['chunks'] = [];
    const stage = async (kind: CatalogManifest['chunks'][number]['kind'], items: unknown[], size: number) => {
      for (let offset = 0; offset < items.length;) {
        let data = items.slice(offset, offset + size);
        while (Buffer.byteLength(JSON.stringify(data)) > 600_000 && data.length > 1) data = data.slice(0, Math.ceil(data.length / 2));
        const hash = queryHash(data), bytes = Buffer.byteLength(JSON.stringify(data));
        await this.immutable(this.publications, hash, data); chunks.push({ kind, id: hash, hash, bytes, count: data.length, ...(kind === 'records' ? { firstId: (data[0] as { id: string }).id, lastId: (data.at(-1) as { id: string }).id } : {}) });
        offset += data.length;
      }
    };
    await stage('records', space.records, 24); await stage('memberships', space.memberships, 500); await stage('relationships', space.relationships, 200);
    const indexed = space.records.map(record => ({ ...record, blocks: [], summary: record.summary.slice(0, 320) }));
    await stage('index', indexed, 100);
    await stage('reading', space.records.map(publishedReadingTerms), 100);
    const metadata = catalogMetadataSchema.strip().parse(space), compiled = compileQueryIndex({ ...space, records: indexed });
    const manifest = manifestSchema.parse({ version: 2, id, siteId, ...(z.string().uuid().safeParse(input.publication.revisionId).success ? { reviewId: input.publication.revisionId } : {}), revision: 0, metadata, chunks, recordCount: space.records.length, contentHash: queryHash(space), indexHash: compiled.hash });
    await this.publications.create(id, manifest);
    // Verify complete staged data before exposing a reference to the site mutation.
    await this.verify(siteId, id); return manifest;
  }
  async manifest(siteId: string, id: string) {
    const key = `${siteId}:${id}`;
    const cached = this.cacheReads ? this.manifests.get(key) : undefined;
    if (cached) return cached;
    const manifest = manifestSchema.parse(await this.publications.read(id));
    if (manifest.siteId !== siteId) throw new Error('Publication belongs to another site.');
    if (this.cacheReads) { if (this.manifests.size >= 16) this.manifests.delete(this.manifests.keys().next().value!); this.manifests.set(key, manifest); }
    return manifest;
  }
  private async chunk(manifest: CatalogManifest, id: string) {
    const reference = manifest.chunks.find(chunk => chunk.id === id); if (!reference) throw new Error('Unreferenced publication chunk.');
    const key = `${manifest.siteId}:${manifest.id}:${id}`, cached = this.cacheReads ? this.chunks.get(key) : undefined;
    if (cached) return cached.data;
    const data = await this.publications.read(id);
    if (!Array.isArray(data) || data.length !== reference.count || queryHash(data) !== reference.hash || Buffer.byteLength(JSON.stringify(data)) !== reference.bytes) throw new Error('Publication checksum failed.');
    if (this.cacheReads) {
      while (this.chunks.size && (this.chunkBytes + reference.bytes > 8 * 1024 * 1024 || this.chunks.size >= 64)) {
        const first = this.chunks.keys().next().value!; this.chunkBytes -= this.chunks.get(first)!.bytes; this.chunks.delete(first);
      }
      if (!this.chunks.has(key)) { this.chunks.set(key, { data, bytes: reference.bytes }); this.chunkBytes += reference.bytes; }
    }
    return data;
  }
  async index(siteId: string, id: string): Promise<CompiledQueryIndex> {
    const manifest = await this.manifest(siteId, id), selected = manifest.chunks.filter(chunk => ['index', 'memberships', 'relationships'].includes(chunk.kind));
    if (selected.reduce((sum, chunk) => sum + chunk.bytes, 0) > QUERY_INDEX_LIMITS.readBytes) throw new Error('Publication index exceeds I/O ceiling.');
    const records: unknown[] = [], memberships: unknown[] = [], relationships: unknown[] = [];
    const loaded = await readChunks(selected, reference => this.chunk(manifest, reference.id));
    selected.forEach((reference, i) => (reference.kind === 'index' ? records : reference.kind === 'memberships' ? memberships : relationships).push(...loaded[i]));
    const index = compileQueryIndex({ ...manifest.metadata, publication: { siteId, revisionId: manifest.id, indexRevision: manifest.id }, records, memberships, relationships });
    if (index.hash !== manifest.indexHash || records.length !== manifest.recordCount) throw new Error('Publication index is incomplete or mismatched.');
    return index;
  }
  async indexReading(siteId: string, id: string, index: CompiledQueryIndex) {
    const manifest = await this.manifest(siteId, id);
    if (index.space.publication.siteId !== siteId || index.space.publication.indexRevision !== id) throw new Error('Reading index belongs to another publication.');
    if (manifest.chunks.reduce((total, chunk) => total + chunk.bytes, 0) > QUERY_INDEX_LIMITS.readBytes) throw new Error('Publication exceeds I/O ceiling.');
    let count = 0;
    const derived = manifest.chunks.filter(chunk => chunk.kind === 'reading');
    const selected = derived.length ? derived : manifest.chunks.filter(chunk => chunk.kind === 'records');
    const seen = new Set<string>();
    // Process bounded batches rather than retaining a second whole catalog.
    for (let offset = 0; offset < selected.length; offset += 4) {
      const data = await readChunks(selected.slice(offset, offset + 4), chunk => this.chunk(manifest, chunk.id));
      for (const chunk of data) {
        const terms = derived.length ? z.array(z.object({ id: z.string(), terms: z.array(z.string()) }).strict()).parse(chunk) : z.array(canonicalRecordSchema).parse(chunk).map(publishedReadingTerms);
        for (const record of terms) { if (seen.has(record.id)) throw new Error('Duplicate reading record.'); seen.add(record.id); }
        indexPublishedTerms(index, terms); count += terms.length;
      }
    }
    if (count !== manifest.recordCount) throw new Error('Published reading index is incomplete.');
  }
  async verify(siteId: string, id: string) {
    const manifest = await this.manifest(siteId, id), index = await this.index(siteId, id);
    if (manifest.chunks.reduce((total, chunk) => total + chunk.bytes, 0) > QUERY_INDEX_LIMITS.readBytes) throw new Error('Publication exceeds I/O ceiling.');
    const records: PublicationSpace['records'] = [];
    for (const chunk of manifest.chunks.filter(chunk => chunk.kind === 'records')) records.push(...z.array(canonicalRecordSchema).parse(await this.chunk(manifest, chunk.id)));
    const space = validatePublicationSpace({ ...index.space, records });
    const reading = manifest.chunks.filter(chunk => chunk.kind === 'reading');
    if (reading.length) {
      const terms = (await readChunks(reading, chunk => this.chunk(manifest, chunk.id))).flat();
      if (queryHash(terms) !== queryHash(records.map(publishedReadingTerms))) throw new Error('Publication reading derivative is incomplete or mismatched.');
    }
    if (records.length !== manifest.recordCount || queryHash(space) !== manifest.contentHash) throw new Error('Publication content is incomplete or mismatched.');
    return manifest;
  }
  async records(manifest: CatalogManifest, ids: string[]) {
    if (ids.length > 48) throw new Error('Excessive record references.');
    const references = ids.map(id => manifest.chunks.find(chunk => chunk.kind === 'records' && chunk.firstId! <= id && chunk.lastId! >= id));
    if (references.some(ref => !ref)) throw new Error('Unavailable record reference.');
    const records = new Map<string, PublicationSpace['records'][number]>();
    const loaded = await readChunks([...new Set(references.map(ref => ref!.id))], chunkId => this.chunk(manifest, chunkId));
    for (const chunk of loaded) for (const record of z.array(canonicalRecordSchema).parse(chunk)) records.set(record.id, record);
    return ids.map(id => { const record = records.get(id); if (!record) throw new Error('Unavailable record reference.'); return record; });
  }
}
