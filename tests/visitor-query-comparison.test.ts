import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publisherVocabularies, taskFixture, websiteTaskFixture } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { VisitorTaskStore, confirmVisitorView } from '../lib/visitor-task-store';
import { localTaskDocuments } from '../lib/task-persistence';
import { acknowledgeTaskDisplay, buildVisitorTaskView, CapabilityInputError, executeVisitorCapability } from '../lib/visitor-capabilities';
import { resolveEvidence } from '../lib/visitor-evidence-store';
import { catalogMetadataSchema } from '../lib/catalog-repository';
import { visitorTaskContext } from '../lib/visitor-task-context';
import { createVisitorTaskBridge } from '../lib/visitor-task-bridge';
import { runVisitorTask } from '../lib/visitor-task-runner';
import type { VisitorTaskView } from '@thevoice/platform-ui/task-view';
import { comparisonDisplayOnlyRequest } from '../lib/visitor-command-intent';

async function isolated(space: ReturnType<typeof taskFixture>) {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-query-comparison-'));
  const index = compileQueryIndex(space), store = new VisitorTaskStore(localTaskDocuments(directory));
  let session = await store.create(space.publication);
  buildVisitorTaskView({ index, session, signal: new AbortController().signal });
  confirmVisitorView(session); session = await store.save(session, session.revision);
  const read = () => store.read(session.id, space.publication);
  return { index, store, session, read, close: () => rm(directory, { recursive: true, force: true }),
    execute: async (capabilityId: string, input: unknown, overrides: Partial<Parameters<typeof executeVisitorCapability>[0]> = {}) => executeVisitorCapability({
      index, store, sessionId: session.id, signal: new AbortController().signal, assertCurrent: async () => {}, ...overrides,
      call: { capabilityId, input, operationId: randomUUID(), expectedRevision: (await read()).revision },
    }),
  };
}
const patch = (session: Awaited<ReturnType<VisitorTaskStore['read']>>, operations: unknown[]) => ({ queryId: session.queries[0].current.queryId, baseRevision: session.queries[0].current.revision, operations });
async function acknowledge(store: VisitorTaskStore, view: VisitorTaskView) {
  return acknowledgeTaskDisplay(store, view.sessionId, view.query.publication, { operationId: view.operationId!, queryId: view.query.queryId, queryRevision: view.query.revision,
    resultSetId: view.result.resultSetId, sceneRevision: 1, recordIds: (view.comparison?.rows ?? view.records).map(record => record.id) });
}

test('query.compare composes exact filtering/order and comparison in one receipt across publisher vocabularies', async () => {
  for (const vocabulary of publisherVocabularies) {
    const fixture = await isolated(taskFixture(vocabulary));
    try {
      const compared = await fixture.execute('query.compare', patch(fixture.session, [
        { op: 'addConstraint', parentId: 'criteria', expression: { kind: 'field', id: 'documented', fieldId: 'flag', op: 'eq', value: { type: 'boolean', value: false } } },
        { op: 'setSort', order: [{ fieldId: vocabulary.field, direction: 'desc' }] },
      ]));
      assert.equal(compared.outputType, 'comparison');
      assert.equal(compared.view.focus, 'comparison');
      assert.deepEqual(compared.view.comparison!.rows.map(row => row.id), ['record-00007', 'record-00005', 'record-00003', 'record-00001']);
      const pending = await fixture.read();
      assert.equal(pending.revision, fixture.session.revision + 1, 'Pure composed query commits once');
      assert.equal(pending.presentation, null, 'A computed comparison is not confirmed screen state');
      assert.equal(pending.tasks[0].status, 'awaitingDisplay');
      assert.equal(pending.receipts.filter(receipt => receipt.kind === 'display').length, 0);
      const confirmed = await acknowledge(fixture.store, compared.view);
      assert.equal(confirmed.presentation!.type, 'comparison');
      assert.equal(confirmed.surfaceHistory.length, 1, 'One composed request makes one confirmed answer checkpoint');
      assert.deepEqual(resolveEvidence(confirmed, compared.handleId, 'comparison'), compared.data);
      assert.equal(confirmed.tasks[0].budget.capabilityCalls, 1);
      const changed = await fixture.execute('query.patch', patch(confirmed, [{ op: 'setSearch', text: 'missing' }]));
      assert.equal(changed.outputType, 'query');
      assert.throws(() => resolveEvidence({ ...confirmed, queries: [{ ...confirmed.queries[0], current: changed.view.query }] }, compared.handleId, 'comparison'), /stale/);
    } finally { await fixture.close(); }
  }
});

test('zero, single, too-large and uncomparable result sets reject before any query mutation', async () => {
  for (const count of [0, 1, 7]) {
    const fixture = await isolated(taskFixture());
    try {
      const before = await fixture.read();
      const operations = [{ op: 'addConstraint', parentId: 'criteria', expression: { kind: 'field', id: 'bounded', fieldId: 'reading-minutes', op: 'lt', value: { type: 'number', value: count === 7 ? 8 : count, unit: 'units' } } }];
      await assert.rejects(fixture.execute('query.compare', patch(before, operations)), error => error instanceof CapabilityInputError && error.issues[0].code === 'comparison_size' && error.issues[0].message.includes(`contains ${count} records`));
      assert.deepEqual(await fixture.read(), before, 'Failure retains exact query, order, scene, operations and capability budget');
    } finally { await fixture.close(); }
  }
  const space = taskFixture(undefined, 2); space.fields = []; space.records.forEach(record => { record.assertions = []; });
  const fixture = await isolated(space);
  try {
    const before = await fixture.read();
    await assert.rejects(fixture.execute('query.compare', patch(before, [{ op: 'setSearch', text: '' }])), error => error instanceof CapabilityInputError && error.issues[0].code === 'comparison_fields');
    assert.deepEqual(await fixture.read(), before);
  } finally { await fixture.close(); }
});

test('a typed query handle compares the full matching result without a records lookup and never trusts a wrong/stale handle', async () => {
  const fixture = await isolated(taskFixture());
  try {
    const query = await fixture.execute('query.patch', patch(fixture.session, [{ op: 'addConstraint', parentId: 'criteria', expression: { kind: 'field', id: 'selected', fieldId: 'flag', op: 'eq', value: { type: 'boolean', value: false } } }]));
    const comparison = await fixture.execute('selection.compare', { queryHandleId: query.handleId });
    assert.deepEqual(comparison.view.comparison!.rows.map(row => row.id), ['record-00001', 'record-00003', 'record-00005', 'record-00007']);
    const saved = await fixture.read();
    assert.deepEqual(saved.operations.map(operation => (operation.result as { outputType: string }).outputType), ['query', 'comparison']);
    assert.ok(saved.evidence.find(value => value.handle.id === comparison.handleId)!.handle.dependencies.some(dependency => dependency.id === query.view.query.queryId && dependency.revision === query.view.query.revision));
    await assert.rejects(fixture.execute('selection.compare', { queryHandleId: comparison.handleId }), error => error instanceof CapabilityInputError && error.issues[0].code === 'evidence_type_mismatch');
    await assert.rejects(fixture.execute('selection.compare', { queryHandleId: query.handleId, records: [] }), error => error instanceof CapabilityInputError && error.issues[0].code === 'ambiguous_comparison_source');
    assert.deepEqual(await fixture.read(), saved);
    await fixture.execute('query.patch', patch(saved, [{ op: 'setSearch', text: 'missing' }]));
    const changed = await fixture.read();
    await assert.rejects(fixture.execute('selection.compare', { queryHandleId: query.handleId }), /stale/);
    assert.deepEqual(await fixture.read(), changed);
  } finally { await fixture.close(); }
});

test('current query identity compares across turns without reviving old handles, stale revisions or remembered queries', async () => {
  for (const vocabulary of publisherVocabularies) {
    const fixture = await isolated(taskFixture(vocabulary));
    try {
      const found = await fixture.execute('query.patch', patch(fixture.session, [{ op: 'addConstraint', parentId: 'criteria', expression: { kind: 'field', id: 'selected', fieldId: 'flag', op: 'eq', value: { type: 'boolean', value: false } } }]));
      await acknowledge(fixture.store, found.view);
      const nextTurn = await fixture.read(); nextTurn.generation++; await fixture.store.save(nextTurn, nextTurn.revision);
      const input = { queryId: found.view.query.queryId, baseRevision: found.view.query.revision };
      await assert.rejects(fixture.execute('selection.compare', { queryHandleId: found.handleId }), /stale/);
      const before = await fixture.read();
      for (const invalid of [{ queryId: input.queryId }, { baseRevision: input.baseRevision }, { ...input, records: [] }, { ...input, queryHandleId: found.handleId }]) {
        await assert.rejects(fixture.execute('selection.compare', invalid), error => error instanceof CapabilityInputError);
        assert.deepEqual(await fixture.read(), before);
      }
      const compared = await fixture.execute('selection.compare', input);
      assert.deepEqual(compared.view.comparison!.rows.map(row => row.id), ['record-00001', 'record-00003', 'record-00005', 'record-00007']);
      assert.equal((await fixture.read()).tasks.at(-1)!.status, 'awaitingDisplay');
      const confirmed = await acknowledge(fixture.store, compared.view);
      assert.ok(confirmed.evidence.find(value => value.handle.id === compared.handleId)!.handle.dependencies.some(dependency => dependency.id === input.queryId && dependency.revision === input.baseRevision));
      const edited = await fixture.execute('query.patch', { ...input, operations: [{ op: 'setSort', order: [{ fieldId: vocabulary.field, direction: 'desc' }] }] });
      const afterEdit = await fixture.read();
      await assert.rejects(fixture.execute('selection.compare', input), /Query changed/);
      assert.deepEqual(await fixture.read(), afterEdit);
      const refreshed = await fixture.execute('selection.compare', { queryId: edited.view.query.queryId, baseRevision: edited.view.query.revision });
      assert.deepEqual(refreshed.view.comparison!.rows.map(row => row.id), ['record-00007', 'record-00005', 'record-00003', 'record-00001']);
      await fixture.execute('query.create', {});
      const anotherQuery = await fixture.read();
      await assert.rejects(fixture.execute('selection.compare', { queryId: edited.view.query.queryId, baseRevision: edited.view.query.revision }), error => error instanceof CapabilityInputError && error.issues[0].code === 'inactive_query');
      assert.deepEqual(await fixture.read(), anotherQuery, 'An exact but remembered inactive query is not the current result');
    } finally { await fixture.close(); }
  }
});

test('current-query comparisons reject zero, one or seven exact matches before reserving a capability', async () => {
  for (const count of [0, 1, 7]) {
    const fixture = await isolated(taskFixture());
    try {
      const found = await fixture.execute('query.patch', patch(fixture.session, [{ op: 'addConstraint', parentId: 'criteria', expression: { kind: 'field', id: 'bounded', fieldId: 'reading-minutes', op: 'lt', value: { type: 'number', value: count === 7 ? 8 : count, unit: 'units' } } }]));
      assert.equal(found.view.result.count.value, count);
      await acknowledge(fixture.store, found.view);
      const before = await fixture.read();
      await assert.rejects(fixture.execute('selection.compare', { queryId: found.view.query.queryId, baseRevision: found.view.query.revision }), error => error instanceof CapabilityInputError && error.issues[0].code === 'comparison_size' && error.issues[0].message.includes(`contains ${count} records`));
      assert.deepEqual(await fixture.read(), before, 'All matches are validated before mutation; no silent first-page subset');
    } finally { await fixture.close(); }
  }
});

test('compare-only completion eligibility keeps requested explanation and dependent work', () => {
  for (const text of ['Compare these two options by price.', 'Please compare their duration and hourly prices.', 'Could you please compare these items?', 'Now compare the matching equipment by weight and price.']) assert.equal(comparisonDisplayOnlyRequest(text), true, text);
  for (const text of ['Compare these and explain their differences.', 'Compare these and calculate the difference.', 'Compare these and recommend the best.', 'Compare these and research the tax.', 'Compare these and summarize the tradeoffs.', 'Compare these; then show pictures.', 'Compare these, then tell me why one is safer.', 'Compare the prices and give me a total.', 'Which of these is better?', 'Show these items.', 'Compare Blue Velvet and Red Velvet cake slices with their prices and published photos.', 'Compare remote and studio design sessions with their durations and portfolio pictures.', 'Compare these courses with prices and a chart.', 'Compare these places with a map.']) assert.equal(comparisonDisplayOnlyRequest(text), false, text);
});

test('comparison preview, publication changes and cancellation cannot commit an obsolete composed query', async () => {
  for (const failure of ['aborted', 'manual', 'publication'] as const) {
    const fixture = await isolated(taskFixture(undefined, 4));
    try {
      const before = await fixture.read(), controller = new AbortController(); let checks = 0;
      if (failure === 'aborted') controller.abort();
      await assert.rejects(fixture.execute('query.compare', patch(before, [{ op: 'setSearch', text: '' }]), { signal: controller.signal, assertCurrent: async () => {
        if (++checks !== 2) return;
        if (failure === 'publication') throw new Error('Publication changed.');
        const current = await fixture.read(); current.generation++; await fixture.store.save(current, current.revision);
      } }));
      const after = await fixture.read();
      assert.deepEqual(after.queries, before.queries);
      assert.equal(after.operations.length, 0);
      assert.equal(after.presentation, before.presentation);
      if (failure === 'manual') assert.equal(after.generation, before.generation + 1);
      else assert.deepEqual(after, before);
    } finally { await fixture.close(); }
  }
});

async function publishFixture(space: ReturnType<typeof taskFixture>) {
  const { newSite } = await import('../lib/site-store');
  const { POST: collections } = await import('../app/api/sites/[siteId]/collections/route');
  const { POST: publish } = await import('../app/api/sites/[siteId]/route');
  const site = await newSite({ uid: 'local-demo', mode: 'demo', email: null, displayName: null }, { name: 'Comparison fixture', slug: 'comparison-fixture', kind: 'general' });
  space.publication.siteId = site.id;
  const request = (body: unknown) => new Request('http://127.0.0.1:3225/api', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3225' }, body: JSON.stringify(body) });
  const apply = async (body: unknown) => { const response = await collections(request(body), { params: Promise.resolve({ siteId: site.id }) }); const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value; };
  let { review } = await apply({ action: 'begin', siteRevision: site.revision, metadata: catalogMetadataSchema.strip().parse(space) });
  ({ review } = await apply({ action: 'append', reviewId: review.id, revision: review.revision, chunk: { records: space.records, memberships: space.memberships, relationships: space.relationships } }));
  ({ review } = await apply({ action: 'finish', reviewId: review.id, revision: review.revision }));
  const applied = await apply({ action: 'apply', siteRevision: site.revision, reviewId: review.id, revision: review.revision });
  assert.equal((await publish(request({ action: 'publish', revision: applied.site.revision }), { params: Promise.resolve({ siteId: site.id }) })).status, 200);
  return { slug: site.slug, ...await visitorTaskContext(site.slug) };
}

test('one model-selected query.compare displays the exact comparison before synthesis and preserves compound follow-up work', async () => {
  for (const kind of ['products', 'services'] as const) for (const channel of ['chat', 'voice'] as const) {
    const directory = await mkdtemp(join(tmpdir(), 'visitor-comparison-model-')), previous = process.env;
    process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
    try {
      const fixture = await publishFixture(websiteTaskFixture(kind)), signal = new AbortController().signal;
      const bridge = await createVisitorTaskBridge(fixture.slug, undefined, undefined, { request: `Compare ${kind} under $24 and explain their differences.` });
      let rounds = 0, displays = 0;
      const result = await runVisitorTask({ channel, model: 'offline-test-model', apiKey: 'synthetic', signal, latestRequest: `Compare ${kind} under $24 and explain their differences.`, context: {}, tools: [bridge.tool],
        beforeModel: () => bridge.beforeModel(), instructions: () => bridge.instructions(), fetch: async () => {
          if (rounds++ === 0) return Response.json({ status: 'completed', output: [{ type: 'function_call', call_id: 'compare', name: 'visitor_task', arguments: JSON.stringify({ capabilityId: 'query.compare', completion: 'display_only', input: { operations: [
            { op: 'addConstraint', parentId: 'criteria', expression: { kind: 'field', id: 'budget', fieldId: 'price', op: 'lt', value: { type: 'money', value: 24, currency: 'USD' } } },
            { op: 'setSort', order: [{ fieldId: 'price', direction: 'desc' }] },
          ] } }) }] });
          assert.equal(displays, 1, 'The first provider tool round already displayed the complete comparison');
          return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'The comparison shows the published price and measurement differences.' }] }] });
        }, execute: (_name, args, signal) => bridge.execute(args, signal, async view => {
          displays++; assert.deepEqual(view.comparison!.rows.map(row => row.id), ['record-00003', 'record-00002', 'record-00001']);
          assert.ok(view.comparison!.rows.every(row => row.values.find(value => value.fieldId === 'price')?.text.endsWith(kind === 'products' ? '/ item' : '/ session')));
          await acknowledge(fixture.store, view);
        }),
      });
      assert.equal(rounds, 2, 'Only interpretation plus requested synthesis, no ID-copying model rounds');
      assert.equal(displays, 1); assert.match(result.text, /differences/);
      const saved = await fixture.store.read(bridge.sessionId, fixture.publication);
      assert.equal(saved.operations.length, 1); assert.equal(saved.presentation!.type, 'comparison');
      const next = await createVisitorTaskBridge(fixture.slug, bridge.sessionId);
      await next.instructions();
      await assert.rejects(next.execute(JSON.stringify({ capabilityId: 'query.compare', input: { operations: [{ op: 'setSearch', text: '' }] } }), signal, async () => {}), /did not confirm the exact task result/);
    } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
  }
});

test('chat and voice compare current results in one model round with both published price variants and exact display acknowledgment', async () => {
  for (const kind of ['products', 'services'] as const) for (const channel of ['chat', 'voice'] as const) {
    const directory = await mkdtemp(join(tmpdir(), 'visitor-current-comparison-model-')), previous = process.env;
    process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
    try {
      const space = websiteTaskFixture(kind, 8), price = space.fields.find(field => field.id === 'price')!;
      const variant = kind === 'products' ? 'pack' : 'workshop';
      space.fields.push({ ...price, id: 'variant-price', label: `${variant} price`, basis: variant });
      space.records.forEach((record, i) => record.assertions.push({ id: `variant-${i}`, fieldId: 'variant-price', value: { type: 'money', value: 100 + i, currency: 'USD', basis: variant }, polarity: 'affirmed', conditions: [], authority: 'publisher' }));
      const fixture = await publishFixture(space), signal = new AbortController().signal;
      const initial = await createVisitorTaskBridge(fixture.slug);
      await initial.instructions();
      const found = await initial.execute(JSON.stringify({ capabilityId: 'query.patch', input: { operations: [{ op: 'addConstraint', parentId: 'criteria', expression: { kind: 'field', id: 'budget', fieldId: 'price', op: 'lt', value: { type: 'money', value: 23, currency: 'USD' } } }] } }), signal, view => acknowledge(fixture.store, view));
      let previousSession = initial.sessionId;
      for (const scenario of [
        { capabilityId: 'selection.compare', request: `Compare these two ${kind} by their regular and ${variant} prices.`, hint: true, rounds: 1 },
        { capabilityId: 'query.compare', request: `Compare these two ${kind} by their regular and ${variant} prices.`, hint: true, rounds: 1 },
        { capabilityId: 'selection.compare', request: `Compare these two ${kind} by their regular and ${variant} prices.`, hint: false, rounds: 2 },
        { capabilityId: 'selection.compare', request: `Compare these two ${kind} and explain their price differences.`, hint: true, rounds: 2 },
        { capabilityId: 'selection.compare', request: `Compare these two ${kind} and calculate the combined total.`, hint: true, rounds: 2 },
      ]) {
        const bridge = await createVisitorTaskBridge(fixture.slug, previousSession, undefined, { request: scenario.request });
        const session = await fixture.store.read(bridge.sessionId, fixture.publication), current = session.queries[0].current;
        assert.throws(() => resolveEvidence(session, found.data.handleId!, 'query'), /stale/);
        let rounds = 0, displays = 0;
        const result = await runVisitorTask({ channel, model: 'offline-test-model', apiKey: 'synthetic', signal, latestRequest: scenario.request, context: {}, tools: [bridge.tool],
          beforeModel: () => bridge.beforeModel(), instructions: () => bridge.instructions(), fetch: async () => Response.json({ status: 'completed', output: rounds++ === 0
            ? [{ type: 'function_call', call_id: 'compare-current', name: 'visitor_task', arguments: JSON.stringify({ capabilityId: scenario.capabilityId, ...(scenario.hint ? { completion: 'display_only' } : {}), input: scenario.capabilityId === 'query.compare' ? { operations: [{ op: 'setSearch', text: '' }] } : { queryId: current.queryId, baseRevision: current.revision } }) }]
            : [{ type: 'message', content: [{ type: 'output_text', text: 'The remaining requested explanation or calculation.' }] }] }),
          execute: (_name, args, signal) => bridge.execute(args, signal, async view => {
            displays++; assert.deepEqual(view.comparison!.rows.map(row => row.id), ['record-00001', 'record-00002']);
            for (const [i, row] of view.comparison!.rows.entries()) {
              assert.equal(row.values.find(value => value.fieldId === 'price')?.text, `${21 + i} USD / ${kind === 'products' ? 'item' : 'session'}`);
              assert.equal(row.values.find(value => value.fieldId === 'variant-price')?.text, `${101 + i} USD / ${variant}`);
            }
            await acknowledge(fixture.store, view);
          }),
        });
        assert.equal(rounds, scenario.rounds, scenario.request); assert.equal(displays, 1);
        assert.equal(result.text, scenario.rounds === 1 ? 'Comparing 2 matching items.' : 'The remaining requested explanation or calculation.');
        const saved = await fixture.store.read(bridge.sessionId, fixture.publication);
        assert.equal(saved.tasks.at(-1)!.budget.capabilityCalls, 1, 'No records.lookup is needed for the current exact query');
        await bridge.finish(); previousSession = bridge.sessionId;
      }
      const unacknowledged = await createVisitorTaskBridge(fixture.slug, previousSession, undefined, { request: `Compare these two ${kind}.` });
      await unacknowledged.instructions();
      const query = (await fixture.store.read(previousSession, fixture.publication)).queries[0].current;
      await assert.rejects(unacknowledged.execute(JSON.stringify({ capabilityId: 'selection.compare', completion: 'display_only', input: { queryId: query.queryId, baseRevision: query.revision } }), signal, async () => {}), /did not confirm the exact task result/);
    } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
  }
});

test('named comparisons finish in one model round only after the complete exact ordered display with no dependent work', async () => {
  for (const kind of ['products', 'services'] as const) for (const channel of ['chat', 'voice'] as const) {
    const directory = await mkdtemp(join(tmpdir(), 'visitor-named-comparison-model-')), previous = process.env;
    process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
    try {
      const space = websiteTaskFixture(kind, 8), fixture = await publishFixture(space), signal = new AbortController().signal;
      const recordIds = ['record-00007', 'record-00001'];
      const request = `Compare ${space.records[7].name} and ${space.records[1].name} by their published prices`;
      let previousSession: string | undefined;
      const scenarios: { request: string; hint: boolean; rounds: number; display?: 'partial-rows' | 'wrong-order' | 'partial-query' | 'unknown-count' }[] = [
        { request, hint: true, rounds: 1 },
        { request, hint: false, rounds: 2 },
        { request: `${request} and explain the differences.`, hint: true, rounds: 2 },
        { request: `${request} and calculate their combined cost.`, hint: true, rounds: 2 },
        { request: `${request} and show photos of both.`, hint: true, rounds: 2 },
        { request: `${request} and published photos.`, hint: true, rounds: 2 },
        { request: `${request}. Which is the better choice?`, hint: true, rounds: 2 },
        { request, hint: true, rounds: 2, display: 'partial-rows' },
        { request, hint: true, rounds: 2, display: 'wrong-order' },
        { request, hint: true, rounds: 2, display: 'partial-query' },
        { request, hint: true, rounds: 2, display: 'unknown-count' },
      ];
      for (const scenario of scenarios) {
        const bridge = await createVisitorTaskBridge(fixture.slug, previousSession, undefined, { request: scenario.request });
        let rounds = 0, displays = 0;
        const result = await runVisitorTask({ channel, model: 'offline-test-model', apiKey: 'synthetic', signal, latestRequest: scenario.request, context: {}, tools: [bridge.tool],
          beforeModel: () => bridge.beforeModel(), instructions: () => bridge.instructions(), fetch: async () => Response.json({ status: 'completed', output: rounds++ === 0
            ? [{ type: 'function_call', call_id: 'compare-named', name: 'visitor_task', arguments: JSON.stringify({ capabilityId: 'selection.compare', ...(scenario.hint ? { completion: 'display_only' } : {}), input: { recordIds } }) }]
            : [{ type: 'message', content: [{ type: 'output_text', text: 'The remaining requested work still needs a response.' }] }] }),
          execute: (_name, args, signal) => bridge.execute(args, signal, async view => {
            displays++;
            assert.ok(view.result.count.value > 6, 'Named comparison completion is independent of a larger current result');
            assert.deepEqual(view.comparison!.rows.map(row => row.id), recordIds, 'Requested names keep their explicit order, not catalog order');
            assert.deepEqual(view.comparison!.rows.map(row => row.values.find(value => value.fieldId === 'price')?.text), [27, 21].map(value => `${value} USD / ${kind === 'products' ? 'item' : 'session'}`));
            // Exercise the post-display eligibility boundary against incomplete
            // or mismatched display data without weakening server ACK checks.
            if (scenario.display === 'partial-rows') view.comparison!.rows.pop();
            if (scenario.display === 'wrong-order') view.comparison!.rows.reverse();
            if (scenario.display === 'partial-query') view.result.coverage = 'partial';
            if (scenario.display === 'unknown-count') view.result.count.kind = 'unknown';
            await acknowledge(fixture.store, view);
          }),
        });
        assert.equal(rounds, scenario.rounds, `${kind}/${channel}/${scenario.display ?? scenario.request}`);
        assert.equal(displays, 1);
        assert.equal(result.text, scenario.rounds === 1 ? 'Comparing 2 items.' : 'The remaining requested work still needs a response.');
        const saved = await fixture.store.read(bridge.sessionId, fixture.publication);
        assert.equal(saved.tasks.at(-1)!.budget.capabilityCalls, 1, 'A known named comparison needs no lookup or selection operation');
        await bridge.finish(); previousSession = bridge.sessionId;
      }
      for (const guard of ['unacknowledged', 'interrupted'] as const) {
        const bridge = await createVisitorTaskBridge(fixture.slug, previousSession, undefined, { request });
        await bridge.instructions();
        await assert.rejects(bridge.execute(JSON.stringify({ capabilityId: 'selection.compare', completion: 'display_only', input: { recordIds } }), signal, async view => {
          if (guard === 'unacknowledged') return;
          await acknowledge(fixture.store, view);
          const current = await fixture.store.read(bridge.sessionId, fixture.publication);
          current.generation++; await fixture.store.save(current, current.revision);
        }), guard === 'unacknowledged' ? /did not confirm the exact task result/ : /Manual interaction cancelled/);
        previousSession = bridge.sessionId;
      }
    } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
  }
});
