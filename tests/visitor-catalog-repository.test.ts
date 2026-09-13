import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogRepository, catalogMetadataSchema } from '../lib/catalog-repository';
import { cloudTaskDocuments, localTaskDocuments, type TaskDocuments } from '../lib/task-persistence';
import { taskFixture, fixtureQuery } from '../fixtures/visitor-tasks';
import { evaluateQuery } from '../lib/catalog-query';

test('chunked 10,000-record import, paged correction, immutable publication, and bounded index agree with independent oracle', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-large-'));
  try {
    let readCount = 0, readBytes = 0, maxWrite = 0;
    const track = (base: TaskDocuments): TaskDocuments => ({ read: async key => { const data = await base.read(key); readCount++; readBytes += Buffer.byteLength(JSON.stringify(data)); return data; }, create: async (key, data) => { maxWrite = Math.max(maxWrite, Buffer.byteLength(JSON.stringify(data))); return base.create(key, data); }, compareAndSwap: (key, revision, data) => base.compareAndSwap(key, revision, data) });
    const publications = track(localTaskDocuments(join(directory, 'public'))), repository = new CatalogRepository(publications, localTaskDocuments(join(directory, 'review')));
    const space = taskFixture(undefined, 10_000); space.publication.siteId = randomUUID();
    space.records[9999].blocks = [{ id: 'long-detail', kind: 'paragraph', text: 'A reviewed detail retained outside the compact index.' }];
    let review = await repository.begin(space.publication.siteId, 1, catalogMetadataSchema.strip().parse(space));
    for (let offset = 0; offset < space.records.length; offset += 100) {
      const records = space.records.slice(offset, offset + 100), ids = new Set(records.map(record => record.id));
      review = await repository.append(review.siteId, review.id, review.revision, { records, memberships: space.memberships.filter(member => ids.has(member.recordId)), relationships: offset === 0 ? space.relationships : [] });
    }
    review = await repository.finish(review.siteId, review.id, review.revision);
    const page = await repository.reviewPage(review.siteId, review.id, 9984);
    assert.equal(page.records.length, 16); assert.equal(page.records.at(-1)!.blocks[0].text, space.records[9999].blocks[0].text);
    review = await repository.edit(review.siteId, review.id, review.revision, { membership: { collectionId: 'cross', recordId: 'record-09999', included: true } });
    await repository.verify(review.siteId, review.manifestId!);
    readCount = 0; readBytes = 0; const start = performance.now();
    const index = await repository.index(review.siteId, review.manifestId!); const coldMs = performance.now() - start;
    assert.equal(index.records.size, 10000); assert.equal(index.records.get('record-09999')!.blocks.length, 0);
    assert.ok(maxWrite < 650000); assert.ok(index.bytes < 128 * 1024 * 1024);
    const timings: number[] = [];
    for (let i = 0; i < 120; i++) {
      const threshold = (i * 83) % 9999, even = i % 2 === 0, scope = i % 3;
      const query = fixtureQuery(index.space, { kind: 'all', id: 'criteria', children: [
        { kind: 'field', id: 'minimum', fieldId: 'reading-minutes', op: 'gte', value: { type: 'number', value: threshold, unit: 'units' } },
        { kind: 'field', id: 'flag', fieldId: 'flag', op: 'eq', value: { type: 'boolean', value: even } },
      ] });
      if (scope) query.scope = { collectionId: 'topic', traversal: scope === 1 ? 'direct' : 'descendants', path: ['root', 'topic'] };
      const began = performance.now(); const actual = evaluateQuery(index, query).ordered; timings.push(performance.now() - began);
      const expected = Array.from({ length: 10000 }, (_, value) => value).filter(value => value !== 2 && value >= threshold && (value % 2 === 0) === even && (scope !== 1 || value % 2 === 0)).map(value => `record-${String(value).padStart(5, '0')}`);
      assert.deepEqual(actual, expected);
    }
    timings.sort((a, b) => a - b);
    t.diagnostic(JSON.stringify({ records: 10000, queries: timings.length, p95Ms: timings[Math.ceil(timings.length * .95) - 1], coldMs, readCount, readBytes, compiledBytes: index.bytes, rssBytes: process.memoryUsage().rss, maxDocumentBytes: maxWrite }));
    await assert.rejects(() => repository.manifest(randomUUID(), review.manifestId!), /another site/);
    const manifest = await repository.manifest(review.siteId, review.manifestId!);
    const corrupt: TaskDocuments = { ...publications, read: async key => key === manifest.chunks.find(chunk => chunk.kind === 'index')!.id ? [] : publications.read(key) };
    await assert.rejects(() => new CatalogRepository(corrupt).index(review.siteId, manifest.id), /checksum/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('injected cloud transport persists bounded chunks and rejects stale review CAS without cloud access', async () => {
  const data = new Map<string, unknown>();
  const transport = cloudTaskDocuments({ get: async key => structuredClone(data.get(key) ?? null), create: async (key, value) => { assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 650000); if (data.has(key)) throw new Error('exists'); data.set(key, structuredClone(value)); }, cas: async (key, revision, value) => { if ((data.get(key) as { revision: number }).revision !== revision) throw new Error('conflict'); data.set(key, structuredClone(value)); } });
  const repository = new CatalogRepository(transport, transport), space = taskFixture(); space.publication.siteId = randomUUID();
  const initial = await repository.begin(space.publication.siteId, 1, catalogMetadataSchema.strip().parse(space));
  const review = await repository.append(initial.siteId, initial.id, 0, { records: space.records, memberships: space.memberships, relationships: space.relationships });
  await assert.rejects(() => repository.append(initial.siteId, initial.id, 0, { records: [], memberships: [], relationships: [] }), /changed/);
  const finished = await repository.finish(review.siteId, review.id, review.revision);
  assert.equal((await repository.index(review.siteId, finished.manifestId!)).records.size, 8);
  assert.equal((await repository.latest(review.siteId))!.review.id, finished.id);
  const corrected = await repository.edit(review.siteId, review.id, finished.revision, { patch: { id: 'record-00001', name: 'Publisher correction' }, membership: { recordId: 'record-00000', collectionId: 'cross', included: false }, metadata: { ...finished.metadata, fields: finished.metadata.fields.map((field, index) => index === 0 ? { ...field, aliases: ['reviewed synonym'] } : field) } });
  let again = await repository.begin(review.siteId, 2, catalogMetadataSchema.strip().parse(space), corrected.id);
  again = await repository.append(review.siteId, again.id, again.revision, { records: space.records.map(record => record.id === 'record-00001' ? { ...record, name: 'Changed source name', summary: 'Fresh source detail' } : record), memberships: space.memberships, relationships: space.relationships });
  again = await repository.finish(review.siteId, again.id, again.revision); const updated = await repository.index(review.siteId, again.manifestId!);
  assert.equal(updated.records.get('record-00001')!.name, 'Publisher correction'); assert.equal(updated.records.get('record-00001')!.summary, 'Fresh source detail'); assert.equal(updated.direct.get('cross')!.has('record-00000'), false); assert.deepEqual(updated.space.fields[0].aliases, ['reviewed synonym']);
  const claimed = await repository.claimApply(review.siteId, again.id, again.revision);
  await assert.rejects(() => repository.edit(review.siteId, again.id, claimed.revision, { metadata: again.metadata }), /changed/);
  await repository.markApplied(review.siteId, again.id, claimed.revision);
});
