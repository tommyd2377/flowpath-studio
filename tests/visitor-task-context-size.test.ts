import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { websiteTaskFixture } from '../fixtures/visitor-tasks';
import { taskRecordContext, serializeTaskRecordContext } from '../lib/visitor-task-record-context';
import { catalogMetadataSchema } from '../lib/catalog-repository';
import { createVisitorTaskBridge } from '../lib/visitor-task-bridge';
import { visitorTaskContext } from '../lib/visitor-task-context';
import { acknowledgeTaskDisplay } from '../lib/visitor-capabilities';
import { runVisitorTask } from '../lib/visitor-task-runner';
import { demoExploreResult } from '../lib/explore-model';
import type { CarouselContext } from '@thevoice/platform-ui/carousel';
import type { InformationSurfaceContext } from '@thevoice/platform-ui/surface';

function largeMenu() {
  const space = websiteTaskFixture('products', 24);
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

for (const withHistory of [false, true]) test(`a confirmed ${withHistory ? 'dense 24-record page with eight research findings' : '24-record page'} completes the follow-up model round under the unchanged instruction ceiling`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-context-size-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const { newSite } = await import('../lib/site-store');
    const { POST: collectionRoute } = await import('../app/api/sites/[siteId]/collections/route');
    const { POST: siteRoute } = await import('../app/api/sites/[siteId]/route');
    const site = await newSite({ uid: 'local-demo', mode: 'demo', email: null, displayName: null }, { name: 'Large reviewed menu', slug: 'large-reviewed-menu', kind: 'general' });
    const space = largeMenu(); space.publication.siteId = site.id;
    if (withHistory) for (const record of space.records) record.name = `${record.name} — seasonal handmade variants`;
    const request = (input: unknown) => new Request('http://127.0.0.1:3225/api', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3225' }, body: JSON.stringify(input) });
    const collection = async (input: unknown) => { const response = await collectionRoute(request(input), { params: Promise.resolve({ siteId: site.id }) }); const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body; };
    let { review } = await collection({ action: 'begin', siteRevision: site.revision, metadata: catalogMetadataSchema.strip().parse(space) });
    ({ review } = await collection({ action: 'append', reviewId: review.id, revision: review.revision, chunk: { records: space.records, memberships: space.memberships, relationships: space.relationships } }));
    ({ review } = await collection({ action: 'finish', reviewId: review.id, revision: review.revision }));
    const applied = await collection({ action: 'apply', siteRevision: site.revision, reviewId: review.id, revision: review.revision });
    const published = await siteRoute(request({ action: 'publish', revision: applied.site.revision }), { params: Promise.resolve({ siteId: site.id }) });
    assert.equal(published.status, 200);
    const bridge = await createVisitorTaskBridge(site.slug), context = await visitorTaskContext(site.slug);
    let round = 0, carousel: CarouselContext | undefined, surface: InformationSurfaceContext | undefined;
    const result = await runVisitorTask({ channel: 'chat', model: 'offline-context-test', apiKey: 'synthetic', signal: new AbortController().signal,
      tools: [bridge.tool], context: { request: 'Show the offerings and their listed prices.' }, beforeModel: () => bridge.beforeModel(), instructions: () => bridge.instructions(carousel, surface),
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)), instructions = body.instructions as string;
        const data = JSON.parse(instructions.split('\n').findLast(line => line.startsWith('{'))!);
        // The runner adds its shared policy; measure the bridge itself separately.
        const bridgeInstructions = await bridge.instructions(carousel, surface);
        assert.ok(Buffer.byteLength(bridgeInstructions) <= 48_000);
        if (++round === 1) return Response.json({ status: 'completed', output: [{ type: 'function_call', call_id: 'show-menu', name: 'visitor_task', arguments: JSON.stringify({ capabilityId: 'query.patch', input: { queryId: data.query.queryId, baseRevision: data.query.revision, operations: [{ op: 'setSearch', text: 'Offering' }] } }) }] });
        assert.equal(data.activeRecords.length, 24);
        assert.deepEqual(data.displayedPage.records.map((record: { id: string }) => record.id), space.records.map(record => record.id));
        assert.equal(data.surfaceRecords.length, 0, 'the same visible records are not serialized twice');
        assert.ok(data.activeRecords.some((record: { omittedAssertions: number }) => record.omittedAssertions > 0));
        if (withHistory) {
          assert.ok(!data.researchMemory || data.researchMemory.unlisted > 0, 'dense foreground can omit history directory entries');
          assert.match(instructions, /research.history lists the retained IDs/);
        }
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
          for (let i = 0; i < 8; i++) await bridge.rememberResearch({ ...demoExploreResult(`Earlier policy ${i} ${'詳細な条件。'.repeat(50)}`, 'web'), id: `retained-${i}` }, new AbortController().signal);
        }
      }),
    });
    assert.equal(round, 2); assert.match(result.text, /published offerings/);
    const lookup = await bridge.execute(JSON.stringify({ capabilityId: 'records.lookup', input: { recordIds: [space.records[23].id] } }), new AbortController().signal, async () => assert.fail('Retrieval must not change the visible page.'));
    assert.deepEqual((lookup.data.result as typeof space.records)[0].assertions, space.records[23].assertions, 'omitted details remain fully retrievable');
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});
