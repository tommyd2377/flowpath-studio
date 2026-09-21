import test from 'node:test';
import assert from 'node:assert/strict';
import { taskFixture, websiteTaskFixture, publisherVocabularies } from '../fixtures/visitor-tasks';
import { expressionNodes } from '@thevoice/platform-ui/query';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { evaluateQuery } from '../lib/catalog-query';
import { buildVisitorTaskView, visitorCapabilities } from '../lib/visitor-capabilities';
import { websiteQueryCommand } from '../lib/visitor-query-command';
import { VisitorTaskStore } from '../lib/visitor-task-store';
import { localTaskDocuments } from '../lib/task-persistence';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function setup(space = taskFixture()) {
  const path = await mkdtemp(join(tmpdir(), 'website-command-'));
  const index = compileQueryIndex(space), store = new VisitorTaskStore(localTaskDocuments(path));
  const session = await store.create(space.publication), context = { index, session, signal: new AbortController().signal };
  buildVisitorTaskView(context);
  return { context, close: () => rm(path, { recursive: true, force: true }), ask: async (text: string) => {
    const command = websiteQueryCommand(text, context); assert.ok(command, text);
    await visitorCapabilities.get(command.capabilityId)!.execute(context, command.input);
    return buildVisitorTaskView(context);
  } };
}

test('browsing a named collection prefers structured offerings over an identically named article', async () => {
  for (const kind of ['products', 'services'] as const) {
    const space = websiteTaskFixture(kind), name = kind === 'products' ? 'Dessert menu' : 'Consulting services';
    space.collections.find(collection => collection.id === space.rootId)!.name = name;
    space.records[0] = { ...space.records[0], name };
    const { context, ask, close } = await setup(space);
    try {
      const view = await ask(`Show me ${name}`);
      assert.equal(view.detail, undefined); assert.equal(view.result.count.value, 40);
      assert.deepEqual(websiteQueryCommand(`Open ${name}`, context), { capabilityId: 'record.detail', input: { recordId: space.records[0].id } });
    } finally { await close(); }
  }
});

test('chat commands cover nested scopes, typed bounds, booleans, lists, unknowns and undo without a form', async () => {
  const { context, ask, close } = await setup(taskFixture(undefined, 10000));
  try {
    assert.equal((await ask('Show me topic')).result.count.value, 10000);
    assert.equal((await ask('Only this collection')).result.count.value, 5000);
    assert.equal((await ask('Include subcollections')).result.count.value, 10000);
    assert.equal((await ask('Only reading minutes at least 9998')).result.count.value, 2);
    let view = await ask('Only reading minutes at least 9999'); assert.equal(view.records[0].id, 'record-09999');
    assert.equal((await ask('Undo')).result.count.value, 2);
    await ask('Remove reading minutes');
    assert.equal((await ask('Only documented flag is false')).result.count.value, 5000);
    await ask('Remove documented flag');
    assert.equal((await ask('Only authors includes all of alpha, beta')).result.count.value, 5000);
    await ask('Remove authors');
    view = await ask('Only reading minutes unknown'); assert.deepEqual(view.records.map(record => record.id), ['record-00002']);
    await ask('Remove reading minutes'); view = await ask('Sort reading minutes descending'); assert.equal(view.records[0].id, 'record-09999');
    assert.equal(new Set(view.records.map(record => record.id)).size, 24);
    assert.equal(websiteQueryCommand('How was this organization founded?', context), null, 'ordinary questions retain retrieval');
    assert.equal(websiteQueryCommand('Is documented flag true?', context), null, 'an ordinary attribute question does not change the screen');
  } finally { await close(); }
});

test('text alternatives broaden the same view without dropping typed price bounds', async () => {
  const space = websiteTaskFixture('products');
  // Exercise publications whose names carry the search terms without a flavor attribute.
  space.fields = space.fields.filter(field => field.id !== 'flavor');
  for (const record of space.records) record.assertions = record.assertions.filter(assertion => assertion.fieldId !== 'flavor');
  const { context, ask, close } = await setup(space);
  try {
    for (const text of ['Show me all cakes', 'Find all the cakes', 'Show me all of your cakes']) {
      const view = await ask(text);
      assert.equal(view.result.count.value, 40, text);
      assert.equal(view.query.searchText, 'cake', 'a quantity word is not a published keyword');
    }
    assert.equal((await ask('Show me chocolate cakes')).result.count.value, 14);
    assert.equal((await ask('Only those under $40')).result.count.value, 6);
    assert.equal((await ask('Include vanilla too')).result.count.value, 13);
    assert.equal((await ask('Remove the price limit')).result.count.value, 27);
    assert.equal((await ask('Show me lemon or chocolate')).result.count.value, 27);
    assert.equal((await ask('Clear search')).result.count.value, 40);
    assert.equal((await ask('Show me vanilla')).result.count.value, 13);
    assert.equal((await ask('Show me lemon')).result.count.value, 13, 'replacing the final search does not lose its parent');
    await ask('Only those under $40');
    assert.equal((await ask('Show me vanilla instead, at any price')).result.count.value, 13);
    await ask('Only those under $40');
    assert.deepEqual(websiteQueryCommand('Open Chocolate cake 0', context), { capabilityId: 'record.detail', input: { recordId: 'record-00000' } });
  } finally { await close(); }
});

test('price commands disambiguate published bases and never make an unknown price match', async () => {
  const space = websiteTaskFixture('services');
  space.fields.push({ ...space.fields.at(-1)!, id: 'legacy-price', label: 'Legacy price', aliases: [], coverage: { known: 0, total: 40 } });
  const { ask, close } = await setup(space);
  try {
    const view = await ask('Only those under $40'); assert.equal(view.result.count.value, 19); assert.equal(view.result.exclusions.unknown, 1);
    assert.equal((await ask('Show me larger duration')).query.order[0].direction, 'desc');
    assert.equal((await ask('Remove the price limit')).result.count.value, 40);
    assert.equal((await ask('Only legacy price unknown')).result.count.value, 40);
  } finally { await close(); }
});

test('all members of a named collection clear old offering constraints across publisher types', async () => {
  for (const kind of ['products', 'services'] as const) {
    const space = websiteTaskFixture(kind);
    space.collections.push({ id: 'photos', name: 'Portfolio studies', introduction: '', kind: 'explicit', view: 'gallery' });
    space.edges.push({ parentId: space.rootId, childId: 'photos' });
    for (let i = 0; i < 3; i++) {
      space.records.push({ id: `photo-${i}`, type: 'published-photo', name: `Study ${i}`, summary: '', aliases: [], blocks: [], assertions: [] });
      space.memberships.push({ collectionId: 'photos', recordId: `photo-${i}` });
    }
    const { ask, close } = await setup(space);
    try {
      for (const request of ['Show me all the photos', 'Show me all Portfolio studies']) {
        await ask(kind === 'products' ? 'Show me chocolate' : 'Show me remote');
        await ask('Only those under $40');
        await ask('Sort price descending');
        const view = await ask(request);
        assert.deepEqual(view.records.map(record => record.id).sort(), ['photo-0', 'photo-1', 'photo-2']);
        assert.deepEqual(view.query.order, []);
        assert.equal(expressionNodes(view.query.where).some(node => 'fieldId' in node), false);
      }
    } finally { await close(); }
  }
});

test('qualified collection labels use reviewed membership instead of incidental prose matches', async () => {
  for (const [label, display] of [['Cakes', 'menu'], ['Reports', 'list'], ['Consultations', 'catalog'], ['Photographs', 'gallery']]) {
    const space = taskFixture();
    space.collections[1].name = `Standard / ${label}`;
    space.collections[2].name = `Custom / ${label}`;
    space.collections[3].name = 'Other offerings';
    space.edges = space.collections.slice(1).map(collection => ({ parentId: 'root', childId: collection.id }));
    space.memberships = [{ collectionId: space.collections[1].id, recordId: 'record-00000' }, { collectionId: 'child', recordId: 'record-00001' }, { collectionId: 'cross', recordId: 'record-00003' }];
    space.records[3].summary = `An unrelated offering. Our general policy also mentions ${label}.`;
    const { ask, close } = await setup(space);
    try {
      for (const request of [`Show me all ${label}`, `Show me the ${label} ${display}`, `Show me the ${display} of ${label} again`]) {
        const view = await ask(request);
        assert.deepEqual(view.records.map(record => record.id).sort(), ['record-00000', 'record-00001'], request);
        assert.equal(view.query.scope.traversal, 'explicitUnion');
        assert.equal(view.query.searchText, '');
      }
      await ask('Only reading minutes at least 1');
      const filtered = await ask(`Show me the ${label} ${display}`);
      assert.deepEqual(filtered.records.map(record => record.id), ['record-00001'], 'Presentation wording must retain a requested typed filter');
    } finally { await close(); }
  }
});

test('presentation words do not erase exact names or meaningful search qualifiers', async t => {
  const space = taskFixture();
  space.collections[1].name = 'Reports';
  space.collections[2].name = 'Reports menu';
  space.records[0].name = 'Report catalog';
  const { ask, context, close } = await setup(space); t.after(close);
  assert.deepEqual(websiteQueryCommand('Show me the report catalog', context), { capabilityId: 'record.detail', input: { recordId: space.records[0].id } });
  assert.equal((await ask('Show me the Reports menu')).query.scope.collectionId, space.collections[2].id);
  assert.equal((await ask('Show me Reports winter catalog')).query.searchText, 'winter catalog');
  const before = structuredClone(context.session);
  assert.equal(websiteQueryCommand('Show me the report list and explain their findings', context), null);
  assert.deepEqual(context.session, before);
});

test('compound presentation requests and external searches defer without changing any publisher query', async () => {
  for (const vocabulary of publisherVocabularies) {
    const { context, ask, close } = await setup(taskFixture(vocabulary));
    try {
      const before = structuredClone(context.session);
      for (const text of [
        `Show ${vocabulary.type}s with their listed ${vocabulary.field}`,
        `Show ${vocabulary.type}s with ${vocabulary.field}`,
        `Show ${vocabulary.type}s and tell me their ${vocabulary.field}`,
        `Find ${vocabulary.type}s; show the published details`,
        'Search for images of a place and show me the image results.',
        'Search for images of a place', 'Find pictures on the web',
        'Find photos of a building', 'Search for a map on the internet',
      ]) assert.equal(websiteQueryCommand(text, context), null, `${vocabulary.name}: ${text}`);
      assert.deepEqual(context.session, before, 'deferred prose must leave current filters intact');
      assert.equal((await ask('Show all')).result.count.value, 8);
      assert.equal((await ask(`Only ${vocabulary.field} at least 6`)).result.count.value, 2);
    } finally { await close(); }
  }
});

test('extra calculation, explanation and research tasks bypass shortcuts across products and services', async () => {
  for (const kind of ['products', 'services'] as const) {
    const { context, ask, close } = await setup(websiteTaskFixture(kind));
    const item = kind === 'products' ? 'chocolate cakes' : 'remote design sessions';
    try {
      const before = structuredClone(context.session);
      for (const text of [
        `Show ${item} and calculate three plus a hypothetical 12% allowance`,
        `Show ${item} and also compute their total`,
        `Show ${item}, please estimate the cost for three`,
        `Show ${item} plus explain the difference`,
        `Find ${item} and can you research the background`,
        `Show ${item} while looking up the background and enrich the result`,
        `Show ${item} as well as look up examples`,
        `Only those under $40 and calculate the total`,
        `Sort price descending and summarize the choices`,
      ]) assert.equal(websiteQueryCommand(text, context), null, `${kind}: ${text}`);
      assert.deepEqual(context.session, before, 'The full request reaches the model before any query mutation');
      const alternatives = kind === 'products' ? 'chocolate and vanilla' : 'remote and studio';
      assert.equal((await ask(`Show ${alternatives}`)).result.count.value, 27, 'A conjunction of filter values remains supported');
      const limited = await ask('Only those under $40');
      assert.equal(limited.result.count.value, 13, 'Ordinary refinements keep the alternative filter and its price bound');
    } finally { await close(); }
  }
});

test('simple shortcut searches and typed model replacements share searchText without hidden duplicate predicates', async () => {
  const space = taskFixture();
  space.records[0].name = 'Cobalt journal'; space.records[1].name = 'Amber journal'; space.records[3].name = 'Amber report';
  const { context, ask, close } = await setup(space);
  try {
    let view = await ask('Find cobalt');
    assert.equal(view.query.searchText, 'cobalt');
    assert.equal(expressionNodes(view.query.where).some(node => node.kind === 'search'), false);
    await ask('Only reading minutes at least 1');
    view = buildVisitorTaskView(context);
    await visitorCapabilities.get('query.patch')!.execute(context, { queryId: view.query.queryId, baseRevision: view.query.revision, operations: [{ op: 'setSearch', text: 'amber' }] });
    view = buildVisitorTaskView(context);
    assert.deepEqual(view.records.map(record => record.id), ['record-00001', 'record-00003']);
    assert.ok(expressionNodes(view.query.where).some(node => node.kind === 'field' && node.fieldId === 'reading-minutes'), 'a text replacement keeps hard numeric criteria');
    view = await ask('Include cobalt too');
    assert.equal(view.query.searchText, '');
    assert.ok(expressionNodes(view.query.where).some(node => node.kind === 'any'));
    assert.deepEqual(view.records.map(record => record.id), ['record-00001', 'record-00003'], 'broadening does not relax the numeric bound');
  } finally { await close(); }
});

test('reading detail keeps headings with paragraphs and suppresses unrelated missing attributes', async () => {
  const space = taskFixture(); space.records[0].summary = 'The published biography.';
  space.records[1].blocks = Array.from({ length: 14 }, (_, i) => ({ id: `block-${i}`, kind: i === 11 ? 'heading' as const : 'paragraph' as const, text: `Published block ${i}` }));
  const { context, close } = await setup(space);
  try {
    const detail = await visitorCapabilities.get('record.detail')!.execute(context, { recordId: 'record-00001' }) as { record: typeof space.records[number]; nextBlockOffset: number };
    assert.equal(detail.record.blocks.at(-1)!.kind, 'paragraph'); assert.equal(detail.nextBlockOffset, 11);
    const missing = await visitorCapabilities.get('record.detail')!.execute(context, { recordId: 'record-00002' }) as { values: { text: string }[] };
    assert.equal(missing.values.some(value => value.text === 'unknown'), false);
    assert.equal(evaluateQuery(context.index, context.session.queries[0].current).ordered.length, 8);
  } finally { await close(); }
});
