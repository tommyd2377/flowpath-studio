import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureQuery, websiteTaskFixture } from '../fixtures/visitor-tasks';
import { taskRecordContext, serializeTaskRecordContext } from '../lib/visitor-task-record-context';
import { catalogMetadataSchema } from '../lib/catalog-repository';
import { createVisitorTaskBridge } from '../lib/visitor-task-bridge';
import { visitorTaskContext } from '../lib/visitor-task-context';
import { acknowledgeTaskDisplay } from '../lib/visitor-capabilities';
import { runVisitorTask } from '../lib/visitor-task-runner';
import { demoExploreResult } from '../lib/explore-model';
import type { CarouselContext } from '@thevoice/platform-ui/carousel';
import type { InformationSurfaceContext } from '@thevoice/platform-ui/surface';

function largeMenu(count = 24) {
  const space = websiteTaskFixture('products', count);
  for (const [i, record] of space.records.entries()) {
    record.name = `Offering ${String(i).padStart(2, '0')}`;
    record.summary = 'Published multilingual information — café, 日本語. '.repeat(30).slice(0, 1600);
    record.blocks = [{ id: `details-${i}`, kind: 'paragraph', text: 'Reviewed ingredients and preparation details. '.repeat(100) }];
    const price = record.assertions.find(fact => fact.fieldId === 'price')!;
    price.value = { type: 'money', value: i + 20, currency: 'USD', basis: 'item' };
    price.conditions = ['Starting price; minimum two items; additional decoration charges apply.'];
    record.assertions.push({ ...structuredClone(price), id: `second-price-${i}`, value: { ...price.value, value: i + 25 }, conditions: ['Alternative published size; quote required.'] });
  }
  return space;
}

test('record projection bounds UTF-8 bytes and preserves whole competing qualified fields', () => {
  const space = largeMenu(), before = structuredClone(space), sources = space.records;
  const records = sources.map(taskRecordContext), data = { records, query: { id: 'unchanged-query' } };
  const json = serializeTaskRecordContext(data, sources.map((source, i) => ({ source, target: records[i] })), 8_000);
  assert.ok(Buffer.byteLength(json) <= 8_000);
  assert.deepEqual(records.map(record => [record.id, record.name]), sources.map(record => [record.id, record.name]));
  assert.ok(records.some(record => record.omittedAssertions > 0));
  assert.ok(records.some(record => record.assertions.some(fact => fact.fieldId === 'price')));
  for (const record of records) {
    const source = sources.find(source => source.id === record.id)!;
    for (const fieldId of new Set(record.assertions.map(fact => fact.fieldId))) assert.deepEqual(record.assertions.filter(fact => fact.fieldId === fieldId), source.assertions.filter(fact => fact.fieldId === fieldId));
    assert.equal(record.omittedAssertions, source.assertions.length - record.assertions.length);
    assert.equal(record.omittedBlocks, source.blocks.length - record.blocks.length);
    if (record.summary !== undefined) assert.equal(record.summary, source.summary);
  }
  assert.deepEqual(space, before);
});

test('broad catalog context compacts descriptions explicitly while retaining query semantics and complete confirmed identity', () => {
  const space = largeMenu(100), sources = space.records.slice(0, 24), before = structuredClone(space);
  const records = sources.map(taskRecordContext);
  const query = fixtureQuery(space, { kind: 'field', id: 'price-ceiling', fieldId: 'price', op: 'lt', value: { type: 'money', value: 80, currency: 'USD', basis: 'item' } });
  const children = Array.from({ length: 12 }, (_, i) => ({ id: `category-${i}`, name: `Published category ${i}`, introduction: 'Detailed category guidance. '.repeat(50), kind: 'explicit', view: 'grid' }));
  const data = { query, activeRecords: records, surfaceRecords: [],
    scope: { collection: space.collections[0], fields: space.fields, children, childScopes: children.map(child => ({ collectionId: child.id, path: ['root', child.id], traversal: 'descendants' })), omittedFields: 0, omittedChildren: 0 },
    displayedPage: { resultSetId: 'confirmed-results', records: sources.map((record, i) => ({ id: record.id, code: String(i + 1), name: record.name })) },
    scene: { recordIds: sources.slice(0, 10).map(record => record.id), records: sources.slice(0, 10).map(record => ({ id: record.id, name: record.name })) },
    results: { count: 100, omitted: 94, records: sources.slice(0, 6).map(record => ({ id: record.id, name: record.name, summary: record.summary })) },
  };
  const json = serializeTaskRecordContext(data, sources.map((source, i) => ({ source, target: records[i] })), 10_000), result = JSON.parse(json);
  assert.ok(Buffer.byteLength(json) <= 10_000);
  assert.deepEqual(result.query, query);
  assert.deepEqual(result.displayedPage, data.displayedPage);
  assert.deepEqual(result.scene.recordIds, data.scene.recordIds);
  assert.deepEqual(result.scope.childScopes, data.scope.childScopes);
  assert.deepEqual(result.scope.children, children.map(({ id, name }) => ({ id, name })), 'Collection identities remain exact while optional rendering metadata is omitted');
  assert.equal(result.scope.collection.id, space.collections[0].id);
  assert.equal(result.scope.collection.name, space.collections[0].name);
  assert.deepEqual(result.scope.fields.map((field: { id: string }) => field.id), space.fields.map(field => field.id));
  const price = result.scope.fields.find((field: { id: string }) => field.id === 'price');
  assert.equal(price.currency, 'USD'); assert.equal(price.basis, 'item');
  assert.deepEqual(price.recordTypes, space.fields.find(field => field.id === 'price')!.recordTypes);
  assert.deepEqual(price.operations, space.fields.find(field => field.id === 'price')!.operations);
  assert.ok(result.contextProjection.omitted.length > 0);
  assert.match(result.contextProjection.omitted.join(' '), /scope descriptions\/layout/);
  assert.match(result.contextProjection.retrieve, /records.lookup/);
  assert.deepEqual(space, before);
  assert.throws(() => serializeTaskRecordContext({ query: { unsupportedOversizedCriteria: 'x'.repeat(20_000) } }, [], 10_000), /configured ceiling/, 'hard query semantics must never be silently truncated');
});

test('dense estimate context keeps exact current revision and ordered line references while explicitly deferring financial details', () => {
  const space = largeMenu(12), query = fixtureQuery(space), records = space.records.map(record => ({ id: record.id, name: record.name, code: record.id }));
  const lines = space.records.map((record, i) => ({ recordId: record.id, fieldId: 'price', quantity: i + 1, name: record.name, unitPrice: 20, unit: null, per: 'item', lineTotal: `${20 * (i + 1)}.00` }));
  const estimate = { revision: 9, currency: 'USD', lines, formattedSubtotal: 'USD 1560.00', tax: { status: 'incomplete', mode: 'researched', classification: 'Unresolved classification. '.repeat(500) } };
  const displayedPage = { resultSetId: 'confirmed-page', records }, scene = { recordIds: records.map(record => record.id) };
  const data = { query, estimate, displayedPage, scene }, original = structuredClone(data);
  const json = serializeTaskRecordContext(data, [], 4_000), compact = JSON.parse(json);
  assert.ok(Buffer.byteLength(json) <= 4_000);
  assert.deepEqual(compact.query, query);
  assert.deepEqual(compact.displayedPage, displayedPage);
  assert.deepEqual(compact.scene.recordIds, scene.recordIds);
  assert.equal(compact.estimate.revision, 9);
  assert.equal(compact.estimate.currency, 'USD');
  assert.deepEqual(compact.estimate.lines, lines.map(({ recordId, fieldId, quantity }) => ({ recordId, fieldId, quantity })));
  assert.equal(compact.estimate.detailsOmitted, true);
  assert.equal(compact.estimate.tax, undefined);
  assert.match(compact.contextProjection.omitted.join(' '), /estimate.read before stating totals or tax assumptions/);
  assert.deepEqual(data, original, 'Prompt projection does not mutate the current basket');
});

test('duplicate card references use the exact confirmed directory without changing identities or order', () => {
  const records = Array.from({ length: 48 }, (_, i) => ({ id: `published-record-${String(i).padStart(3, '0')}`, name: `Published record ${i}`, code: String(i + 1) }));
  const activeCard = { id: 'results', title: 'Published offerings', referenceIds: records.map(record => record.id) };
  const data = { activeCard, displayedPage: { resultSetId: 'confirmed', records }, query: { id: 'unchanged' } }, original = structuredClone(data);
  const limit = Buffer.byteLength(JSON.stringify(data)) - 100;
  const compact = JSON.parse(serializeTaskRecordContext(data, [], limit));
  assert.deepEqual(compact.displayedPage, data.displayedPage);
  assert.deepEqual(compact.query, data.query);
  assert.equal(compact.activeCard.referenceIdsFrom, 'displayedPage.records');
  assert.deepEqual({ ...compact.activeCard, referenceIdsFrom: undefined, referenceIds: compact.displayedPage.records.map((record: { id: string }) => record.id) }, { ...activeCard, referenceIdsFrom: undefined });
  assert.match(compact.contextProjection.omitted.join(' '), /exact order/);
  assert.deepEqual(data, original);
});

test('researched estimates with imported-length references retain authority after catalog display under substantial context pressure', () => {
  // Mirrors the recorded shape: 73 catalog records, 12 child scopes, eight
  // fields, a confirmed 24-record page, research handles, and a separate basket.
  // All content/IDs below are synthetic; no private recording is a test fixture.
  const space = largeMenu(73);
  const publication = { siteId: '11111111-1111-4111-8111-111111111111', revisionId: 'a'.repeat(64), indexRevision: '22222222-2222-4222-8222-222222222222' };
  space.publication = publication; space.rootId = 'publication-root';
  const fieldId = 'attributes.source_price_0123456789abcdef01234567_usd';
  space.records.forEach((record, i) => { record.id = `item-${String(i).padStart(31, '0')}`; record.name = `Published prepared item ${i} · seasonal portion`; });
  const fields = Array.from({ length: 8 }, (_, i) => ({ id: i === 0 ? fieldId : `attributes.published_attribute_${String(i).padStart(24, '0')}`, label: `Published characteristic ${i} with qualifications`, type: i ? 'text' : 'money', recordTypes: ['offering'], cardinality: 'one', unit: i ? undefined : 'portion', currency: i ? undefined : 'USD', basis: i ? undefined : 'item', operations: i ? ['eq', 'contains'] : ['lt', 'lte', 'gt', 'gte'], filter: true, sort: true, facet: false, aliases: ['Reviewed imported label'], coverage: { known: 60, total: 73 } }));
  const children = Array.from({ length: 12 }, (_, i) => ({ id: `group-${String(i).padStart(24, '0')}`, name: `Published offering category ${i}`, introduction: 'Reviewed category guidance. '.repeat(15), kind: 'explicit', view: 'grid' }));
  const childScopes = children.map(child => ({ collectionId: child.id, path: [space.rootId, child.id], traversal: 'descendants' }));
  const query = { ...fixtureQuery(space), publication, scope: { collectionId: space.rootId, path: [space.rootId], traversal: 'descendants' }, where: { kind: 'all', id: 'criteria', children: [{ kind: 'not', id: 'exclude-price', child: { kind: 'field', id: 'price-limit', fieldId, op: 'lt', value: { type: 'money', value: 5, currency: 'USD', basis: 'item' } } }] } };
  for (const handleCount of [2, 4, 8]) {
    const lineCount = 2, limit = handleCount === 2 ? 10_719 : 9_850;
    const sources = space.records.slice(0, 2), activeRecords = sources.map(taskRecordContext);
    const estimate = { revision: 11, currency: 'USD', formattedSubtotal: 'USD 28.50', tax: null, lines: space.records.slice(0, lineCount).map((record, i) => ({ recordId: record.id, fieldId, quantity: i + 1, name: record.name, unitPrice: 12.5, unit: 'portion', per: 'item', lineTotal: '25.00' })) };
    const evidence = Array.from({ length: handleCount }, (_, i) => ({ id: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`, type: i % 2 ? 'estimate' : 'research', sessionId: '44444444-4444-4444-8444-444444444444', publication, generation: 8, observedAt: '2026-09-24T14:00:00.000Z', expiresAt: '2026-09-24T14:30:00.000Z', authority: i % 2 ? 'calculated' : 'external', dependencies: [{ id: query.queryId, revision: query.revision }] }));
    const displayedPage = { resultSetId: '55555555-5555-4555-8555-555555555555', records: space.records.slice(0, 24).map((record, i) => ({ id: record.id, name: record.name, code: String(i + 1) })) };
    const scene = { operationId: '66666666-6666-4666-8666-666666666666', resultSetId: displayedPage.resultSetId, recordIds: sources.map(record => record.id), records: sources.map(record => ({ id: record.id, name: record.name })), queryId: query.queryId, queryRevision: query.revision, generation: 8, sceneRevision: 3 };
    const researchMemory = { authority: 'historical-external', available: [], omitted: [{ id: 'retained-public-research', kind: 'web', query: 'Applicable tax rate and prepared food pickup qualifications', fetchedAt: '2026-09-24T14:00:00.000Z', queryTruncated: false, recallable: true, reason: 'context-budget' }], unlisted: 0 };
    const data = { estimate, rootScope: query.scope, query, activeRecords, surfaceRecords: [], activeCard: { id: 'estimate:session', kind: 'artifact', title: 'Published estimate with two selected variants', referenceIds: sources.map(record => record.id) },
      scope: { collection: { id: space.rootId, name: 'Complete published catalog', introduction: 'Business context. '.repeat(40) }, scope: query.scope, children, childScopes, fields, omittedChildren: 0, omittedFields: 12 },
      results: { count: 73, omitted: 67, records: space.records.slice(0, 6).map(({ id, name, summary }) => ({ id, name, summary })) }, displayedPage, scene, evidence,
      researchMemory };
    const json = serializeTaskRecordContext(data, sources.map((source, i) => ({ source, target: activeRecords[i] })), limit), compact = JSON.parse(json);
    assert.ok(Buffer.byteLength(json) <= limit);
    assert.deepEqual(compact.query, query);
    assert.deepEqual(compact.rootScope, query.scope);
    assert.deepEqual(compact.researchMemory, researchMemory, 'The small recall directory keeps its exact identity, date, query and historical authority');
    assert.deepEqual(compact.scope.childScopes, childScopes);
    const typedField = (field: Record<string, unknown>) => Object.fromEntries(Object.entries(field).filter(([key, value]) => !['label', 'aliases', 'coverage'].includes(key) && value !== undefined));
    if (compact.scope.fields.length) {
      assert.deepEqual(compact.scope.fields.map(typedField), fields.map(typedField), 'Included typed field meaning and operations are not weakened');
      assert.equal(compact.scope.omittedFields, data.scope.omittedFields);
    } else {
      assert.equal(compact.scope.omittedFields, data.scope.omittedFields + fields.length, 'Whole omitted descriptors remain discoverable through schema.describe');
      assert.match(compact.contextProjection.omitted.join(' '), /scope.fields omitted in full/);
    }
    assert.deepEqual(data.scope.fields, fields, 'Projection never changes the canonical field schema');
    assert.deepEqual(compact.displayedPage.records.map(({ id, code }: { id: string; code: string }) => ({ id, code })), displayedPage.records.map(({ id, code }) => ({ id, code })));
    assert.deepEqual(compact.scene.recordIds, scene.recordIds);
    assert.deepEqual(compact.activeCard.referenceIds, data.activeCard.referenceIds, 'Two basket IDs must not be confused with the 24-record confirmed directory');
    assert.ok(compact.evidenceScope, 'The recorded-shape regression exercises shared handle scope compaction');
    assert.deepEqual(compact.evidence.map((handle: Record<string, unknown>) => ({ ...compact.evidenceScope, ...handle })), evidence, 'Factoring scope cannot change handle authority, expiry or dependency constraints');
    assert.equal(compact.estimate.revision, estimate.revision);
    assert.deepEqual(compact.estimate.lines.map(({ recordId, fieldId, quantity }: { recordId: string; fieldId: string; quantity: number }) => ({ recordId, fieldId, quantity })), estimate.lines.map(({ recordId, fieldId, quantity }) => ({ recordId, fieldId, quantity })));
    if (compact.displayedPage.records.some((record: { name?: string }) => !record.name)) assert.match(compact.contextProjection.omitted.join(' '), /displayedPage names/);
    for (const record of compact.activeRecords) for (const id of new Set<string>(record.assertions.map((fact: { fieldId: string }) => fact.fieldId))) assert.deepEqual(record.assertions.filter((fact: { fieldId: string }) => fact.fieldId === id), sources.find(source => source.id === record.id)!.assertions.filter(fact => fact.fieldId === id));
  }
});

for (const scenario of ['plain', 'history', 'broad'] as const) test(`a confirmed ${scenario === 'history' ? 'dense 24-record page with eight research findings' : scenario === 'broad' ? '24-record page from 100 records and long category descriptions' : '24-record page'} completes the follow-up model round under the unchanged instruction ceiling`, async t => {
  const withHistory = scenario === 'history';
  const directory = await mkdtemp(join(tmpdir(), 'visitor-context-size-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const { newSite } = await import('../lib/site-store');
    const { POST: collectionRoute } = await import('../app/api/sites/[siteId]/collections/route');
    const { POST: siteRoute } = await import('../app/api/sites/[siteId]/route');
    const site = await newSite({ uid: 'local-demo', mode: 'demo', email: null, displayName: null }, { name: 'Large reviewed menu', slug: 'large-reviewed-menu', kind: 'general' });
    const space = largeMenu(scenario === 'broad' ? 100 : 24); space.publication.siteId = site.id;
    if (scenario === 'broad') for (let i = 0; i < 10; i++) {
      space.collections.push({ id: `category-${i}`, name: `Additional published category ${i}`, introduction: 'A detailed introduction and explanation for this published category. '.repeat(20), kind: 'explicit', view: 'grid' });
      space.edges.push({ parentId: space.rootId, childId: `category-${i}` });
    }
    if (withHistory) for (const record of space.records) record.name = `${record.name} — seasonal handmade variants`;
    const request = (input: unknown) => new Request('http://127.0.0.1:3225/api', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3225' }, body: JSON.stringify(input) });
    const collection = async (input: unknown) => { const response = await collectionRoute(request(input), { params: Promise.resolve({ siteId: site.id }) }); const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body; };
    let { review } = await collection({ action: 'begin', siteRevision: site.revision, metadata: catalogMetadataSchema.strip().parse(space) });
    for (let start = 0; start < space.records.length; start += 24) {
      const records = space.records.slice(start, start + 24), ids = new Set(records.map(record => record.id));
      ({ review } = await collection({ action: 'append', reviewId: review.id, revision: review.revision, chunk: { records, memberships: space.memberships.filter(member => ids.has(member.recordId)), relationships: start === 0 ? space.relationships : [] } }));
    }
    ({ review } = await collection({ action: 'finish', reviewId: review.id, revision: review.revision }));
    const applied = await collection({ action: 'apply', siteRevision: site.revision, reviewId: review.id, revision: review.revision });
    const published = await siteRoute(request({ action: 'publish', revision: applied.site.revision }), { params: Promise.resolve({ siteId: site.id }) });
    assert.equal(published.status, 200);
    const bridge = await createVisitorTaskBridge(site.slug, undefined, undefined, { request: 'Show the offerings and their listed prices with the retained pickup tax.' }), context = await visitorTaskContext(site.slug);
    let round = 0, carousel: CarouselContext | undefined, surface: InformationSurfaceContext | undefined;
    const result = await runVisitorTask({ channel: 'chat', model: 'offline-context-test', apiKey: 'synthetic', signal: new AbortController().signal,
      tools: [bridge.tool], context: { request: 'Show the offerings and their listed prices.' }, beforeModel: () => bridge.beforeModel(), instructions: () => bridge.instructions(carousel, surface),
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)), instructions = body.instructions as string;
        assert.match(instructions, /Scope only to published matching categories; sharing a menu\/catalog parent or price field does not make siblings match/);
        assert.match(instructions, /For an unqualified full menu\/catalog, include every offering category/);
        const data = JSON.parse(instructions.split('\n').findLast(line => line.startsWith('{'))!);
        assert.deepEqual(data.rootScope, { collectionId: space.rootId, path: [space.rootId], traversal: 'descendants' });
        // The runner adds its shared policy; measure the bridge itself separately.
        const bridgeInstructions = await bridge.instructions(carousel, surface);
        assert.ok(Buffer.byteLength(bridgeInstructions) <= 48_000);
        if (++round === 1) return Response.json({ status: 'completed', output: [{ type: 'function_call', call_id: 'show-menu', name: 'visitor_task', arguments: JSON.stringify({ capabilityId: 'query.patch', input: { queryId: data.query.queryId, baseRevision: data.query.revision, operations: [...scenario === 'plain' ? [{ op: 'setScope', scope: { collectionId: space.collections[1].id, traversal: 'descendants' } }] : [], { op: 'setSearch', text: 'Offering' }] } }) }] });
        if (scenario === 'plain') assert.notEqual(data.query.scope.collectionId, data.rootScope.collectionId, 'The root remains discoverable from a different current collection');
        assert.ok([6, 24].includes(data.activeRecords.length));
        if (data.activeRecords.length < 24) assert.ok(data.contextProjection.omitted.some((value: string) => value.startsWith('activeRecords:')));
        assert.deepEqual(data.displayedPage.records.map((record: { id: string }) => record.id), space.records.slice(0, 24).map(record => record.id));
        assert.equal(data.surfaceRecords.length, 0, 'the same visible records are not serialized twice');
        assert.ok(data.activeRecords.some((record: { omittedAssertions: number }) => record.omittedAssertions > 0));
        if (withHistory) {
          assert.ok(data.researchMemory?.omitted.some((entry: { id: string }) => entry.id === 'retained-tax'), 'A relevant retained ID remains available for direct recall despite dense foreground context');
          assert.ok(data.researchMemory.unlisted > 0, 'Other history entries may remain outside the minimal directory');
          assert.match(instructions, /research.history lists the retained IDs/);
        } else assert.equal(data.researchMemory, undefined, 'No empty research envelope is emitted without retained findings');
        assert.match(instructions, /Use records.lookup/);
        t.diagnostic(`24-record follow-up instructions: ${Buffer.byteLength(bridgeInstructions)} bytes`);
        return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'The published offerings are displayed. Their listed prices retain the published conditions.' }] }] });
      },
      execute: (_name, args, signal) => bridge.execute(args, signal, async view => {
        assert.equal(view.records.length, 24);
        const references = view.records.map(record => record.id);
        await acknowledgeTaskDisplay(context.store, view.sessionId, context.publication, { operationId: view.operationId!, queryId: view.query.queryId, queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: 1, recordIds: references });
        carousel = { version: 1, open: true, revision: 1, cards: [{ id: 'results', kind: 'information', title: 'Offerings', referenceIds: references }], activeId: 'results', previousId: null, lastNarratedId: null, expanded: false, reading: { scrollTop: 0, blockId: null }, media: null };
        surface = { version: 1, stateId: 'surface', requestId: null, publicationId: 'published', tenantId: site.slug, revision: 1, status: 'committed', layout: 'collection', subject: references, regions: [{ ...carousel.cards[0], kind: 'collection', role: 'primary', visible: true, selectedId: null }], answer: '', pendingRequestId: null, previous: [], reading: { scrollTop: 0, blockId: null } };
        if (withHistory) {
          assert.ok(Buffer.byteLength(await bridge.instructions(carousel, surface)) <= 48_000, 'the same foreground fits before optional history is added');
          for (let i = 0; i < 8; i++) {
            const finding = demoExploreResult(i === 0 ? 'Tax applicability for prepared food pickup and listed prices.' : `Earlier policy ${i} ${'詳細な条件。'.repeat(50)}`, 'web');
            await bridge.rememberResearch({ ...finding, id: i === 0 ? 'retained-tax' : `retained-${i}`, answer: `${finding.answer} ${'Additional source conditions must be preserved. '.repeat(30)}` }, new AbortController().signal);
          }
        }
      }),
    });
    assert.equal(round, 2); assert.match(result.text, /published offerings/);
    const lookup = await bridge.execute(JSON.stringify({ capabilityId: 'records.lookup', input: { recordIds: [space.records[23].id] } }), new AbortController().signal, async () => assert.fail('Retrieval must not change the visible page.'));
    assert.deepEqual((lookup.data.result as typeof space.records)[0].assertions, space.records[23].assertions, 'omitted details remain fully retrievable');
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});
