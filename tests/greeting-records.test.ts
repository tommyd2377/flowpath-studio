import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { taskFixture } from '../fixtures/visitor-tasks';
import { greetingRecordTopic } from '../lib/greeting-records';
import { loadGreetingRecords } from '../lib/greeting-record-store';
import { CatalogRepository, type CatalogManifest } from '../lib/catalog-repository';
import { cloudTaskDocuments } from '../lib/task-persistence';

test('record introductions retain competing values, conditions, denials and validity dates', () => {
  const space = taskFixture(), record = space.records[0], field = space.fields[0];
  record.assertions = [
    { ...record.assertions[0], value: { type: 'number', value: 15, unit: 'units' } },
    { ...record.assertions[0], id: 'different', value: { type: 'number', value: 20, unit: 'units' }, validFrom: '2026-01-01', validTo: '2026-12-31' },
    { ...record.assertions[0], id: 'qualified', value: { type: 'number', value: 10, unit: 'units' }, conditions: ['Only for groups of at least six', 'Requires advance confirmation'] },
    { ...record.assertions[0], id: 'denied', polarity: 'denied', value: { type: 'number', value: 5, unit: 'units' } },
  ];
  const topic = greetingRecordTopic(record, [field], '2026-09-28');
  assert.equal(topic.id, record.id); assert.equal(topic.title, record.name);
  assert.equal(topic.kind, record.type, 'Selected runtime topics retain their published semantic kind.');
  assert.match(topic.body, /Conflicting approved assertions.*15 units.*20 units.*from 2026-01-01.*until 2026-12-31.*Only for groups of at least six; Requires advance confirmation.*Not asserted: 5 units/s);
  assert.match(greetingRecordTopic({ ...record, assertions: [record.assertions[1]] }, [field], '2027-01-01').body, /Unknown at this time.*until 2026-12-31/s);
});

test('record introductions use complete source text and never trim the final qualification to fit', () => {
  const space = taskFixture(), record = space.records[0];
  const paragraph = 'Approved description. '.repeat(95) + 'Only by prior arrangement.';
  const long = greetingRecordTopic({ ...record, summary: '', blocks: [{ id: 'description', kind: 'paragraph', text: paragraph }] }, space.fields);
  assert.equal(long.body, paragraph);
  assert.ok([long.title, long.body].join('. ').length > 1800, 'The caller can reject an overlong topic rather than publishing clipped conditions.');
  const bounded = greetingRecordTopic({ ...record, summary: 'Complete source description. '.repeat(50), assertions: [{ ...record.assertions[0], conditions: ['Subject to approval. '.repeat(40)] }] }, [space.fields[0]]);
  assert.equal(bounded.body, 'Complete source description. '.repeat(50).trim(), 'A field is omitted as a whole when its qualifications cannot fit.');
  assert.ok([bounded.title, bounded.body].join('. ').length <= 1800);
  const onlyLongField = greetingRecordTopic({ ...record, summary: '', assertions: [{ ...record.assertions[0], conditions: ['Subject to approval. '.repeat(100)] }] }, [space.fields[0]]);
  assert.match(onlyLongField.body, /Subject to approval/);
  assert.ok(onlyLongField.body.length > 1800, 'An existing overlong field is not misrepresented as missing information.');
});

test('selected record loading is bounded, preserves ordering and rejects cross-site authority', async context => {
  const data = new Map<string, unknown>();
  const store = cloudTaskDocuments({ get: async key => structuredClone(data.get(key) ?? null), create: async (key, value) => { if (data.has(key)) throw new Error('exists'); data.set(key, structuredClone(value)); }, cas: async () => { throw new Error('No mutations in this check.'); } });
  const repository = new CatalogRepository(store, store), space = taskFixture(); space.publication.siteId = randomUUID();
  space.records[1].summary = 'Full description. '.repeat(50) + 'Complete final qualification.';
  const manifest = await repository.stage(space.publication.siteId, space), read = repository.records.bind(repository);
  const calls: string[][] = [];
  context.mock.method(repository, 'records', async (revision: CatalogManifest, ids: string[]) => { calls.push(ids); return read(revision, ids); });
  context.mock.method(repository, 'index', async () => { throw new Error('Greeting startup must not hydrate the full index.'); });
  const content = { catalogPublicationId: manifest.id, greetingPoints: [{ kind: 'record' as const, id: 'record-00001' }, { kind: 'record' as const, id: 'missing' }, { kind: 'record' as const, id: 'record-00000' }] };
  const result = await loadGreetingRecords(space.publication.siteId, content, repository);
  assert.deepEqual(result.map(record => record.id), ['record-00001', 'record-00000']);
  assert.match(result[0].body, /Complete final qualification/);
  assert.equal(calls.length, 3); assert.ok(calls.every(ids => ids.length === 1));
  await assert.rejects(() => loadGreetingRecords(randomUUID(), content, repository), /another site/);
  context.mock.method(repository, 'records', async () => { throw new Error('Publication checksum failed.'); });
  await assert.rejects(() => loadGreetingRecords(space.publication.siteId, content, repository), /checksum/);
});

test('private introduction picker offers business topics instead of a large item catalog and preserves saved selections', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'greeting-record-picker-')), environment = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  const network = context.mock.method(globalThis, 'fetch', async () => { throw new Error('No network in this offline test.'); });
  try {
    const { withDatabase, initialSite } = await import('../lib/local-store');
    const { GET } = await import('../app/api/sites/[siteId]/greeting/route');
    const site = initialSite('general', 'Synthetic publisher', 'synthetic-greeting');
    const space = taskFixture({ name: 'Independent furnishings workshop', type: 'product', branch: 'products', field: 'size', tag: 'color' }, 300);
    space.publication.siteId = site.id;
    space.records[0].name = 'About Cherry cabinet';
    space.records[299].name = 'Previously selected individual cabinet';
    space.records[299].summary = 'Complete approved detail. '.repeat(30) + 'Final important qualification.';
    const businessTopics = [
      { id: 'about-business', name: 'About our business', summary: 'We are an independent workshop helping people furnish welcoming homes. Our team combines practical advice with careful craftsmanship.' },
      { id: 'our-story', name: 'Our story', summary: 'Our family started the workshop in 1988 with a shared love of making useful things. Three generations now work together in the neighborhood.' },
      { id: 'services-overview', name: 'Our services', summary: 'We offer furniture design, repairs, and consultations, guiding projects from the first sketches through final delivery.' },
      { id: 'plan-visit', name: 'Plan your visit', summary: 'Visit our accessible showroom on Tuesday through Saturday. Our team can help you explore materials and discuss a project during your appointment.' },
    ].map(topic => ({ ...topic, type: 'information', aliases: [], assertions: [], blocks: [{ id: `${topic.id}-body`, kind: 'paragraph' as const, text: `${topic.summary} This is the complete approved introduction beyond the compact index.` }] }));
    space.records.push(...businessTopics);
    space.memberships.push(...businessTopics.map(topic => ({ collectionId: 'products', recordId: topic.id })));
    const repository = new CatalogRepository(), manifest = await repository.stage(site.id, space);
    site.draft.catalogPublicationId = manifest.id;
    site.draft.greetingPoints = [{ kind: 'record', id: space.records[299].id }, null, null];
    const previous = await repository.stage(site.id, { ...space, records: space.records.map(record => ({ ...record, name: `Old ${record.name}` })) });
    site.published = { ...site.draft, catalogPublicationId: previous.id };
    await withDatabase(db => { db.sites = [site]; });
    const origin = 'http://127.0.0.1:3220';
    const read = (params: Record<string, string> = {}, headers?: HeadersInit) => GET(new Request(`${origin}/api/sites/${site.id}/greeting?${new URLSearchParams({ revisionId: manifest.id, ...params })}`, { headers }), { params: Promise.resolve({ siteId: site.id }) });
    const response = await read(), first = await response.json();
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(first.topics.length, 3, 'Related About and Story records share one opening theme.');
    const topicIds = new Set(first.topics.map((topic: { id: string }) => topic.id));
    assert.ok(topicIds.has('services-overview') && topicIds.has('plan-visit'));
    assert.ok(topicIds.has('about-business') || topicIds.has('our-story'));
    assert.ok(first.topics.every((topic: { id: string }) => businessTopics.some(record => record.id === topic.id)), 'No individual product becomes an introduction topic.');
    assert.ok(first.topics.every((topic: { kind: string; body: string }) => topic.kind === 'information' && topic.body.includes('complete approved introduction')));
    assert.equal(first.total, undefined); assert.equal(first.nextOffset, undefined);
    assert.match(first.selected[0].body, /Final important qualification/);
    assert.equal(first.selected[0].title, 'Previously selected individual cabinet');
    assert.deepEqual((await (await read({ selected: '' })).json()).selected, []);
    const blockIndex = context.mock.method(CatalogRepository.prototype, 'index', async () => { throw new Error('Selected preview must not hydrate the index.'); });
    const preview = await (await read({ selected: space.records[299].id, selectedOnly: 'true' })).json();
    assert.equal(preview.selected[0].title, 'Previously selected individual cabinet'); assert.equal(preview.topics, undefined);
    blockIndex.mock.restore();
    assert.equal((await read({ revisionId: previous.id })).status, 409, 'Published or historic catalogs do not grant draft picker access.');
    assert.equal((await read({ revisionId: randomUUID() })).status, 409);
    assert.equal((await read({ revisionId: '' })).status, 400);
    assert.equal((await read({ selected: 'a,b,c,d' })).status, 400);
    assert.equal((await read({ q: 'cabinet' })).status, 400, 'Introduction setup does not expose a raw catalog search.');
    assert.equal((await read({ offset: '48' })).status, 400, 'Introduction setup does not page through item records.');
    assert.equal((await read({}, { origin: 'https://foreign.example' })).status, 403);
    assert.equal(network.mock.callCount(), 0);
  } finally { process.env = environment; network.mock.restore(); await rm(directory, { recursive: true, force: true }); }
});
