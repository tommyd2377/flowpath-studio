import test from 'node:test';
import assert from 'node:assert/strict';
import { taskFixture, websiteTaskFixture, publisherVocabularies, recordedMenuFixture } from '../fixtures/visitor-tasks';
import { expressionNodes } from '@thevoice/platform-ui/query';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { evaluateQuery, publishedOfferingScope } from '../lib/catalog-query';
import { buildVisitorTaskView, visitorCapabilities } from '../lib/visitor-capabilities';
import { websiteQueryCommand } from '../lib/visitor-query-command';
import { websiteCommandCandidate, websiteCommandCanMatch } from '../lib/visitor-command-intent';
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
    assert.equal(websiteCommandCanMatch(text), true, `The browser must allow this published command: ${text}`);
    const command = websiteQueryCommand(text, context); assert.ok(command, text);
    await visitorCapabilities.get(command.capabilityId)!.execute(context, command.input);
    return buildVisitorTaskView(context);
  } };
}

test('syntax reachability skips impossible probes without consulting a partial browser field list', async t => {
  const { context, close } = await setup(); t.after(close);
  for (const request of [
    'Keep those quantities, but make both items whole pies instead.',
    'Keep those quantities, but make both services full-day sessions instead.',
    'Use three of the second item instead',
    'Leave the quantities unchanged',
  ]) {
    assert.equal(websiteCommandCandidate(request), true, 'These formerly needed an unsuccessful server probe');
    assert.equal(websiteCommandCanMatch(request), false, request);
    assert.equal(websiteQueryCommand(request, context), null, request);
  }
  for (const [request, capabilityId] of [
    ['Keep reading minutes at least 2', 'query.patch'],
    ['Keep documented flag is false', 'query.patch'],
    ['Reading minutes largest first', 'query.patch'],
    ['Reading minutes not published', 'query.patch'],
    ['At any price', 'task.clarify'],
    ['No price limit', 'task.clarify'],
    ['Restore my estimate', 'estimate.show'],
    ['Bring back my estimate', 'estimate.show'],
    ['Go back to those results', 'view.back'],
    ['Exclude subcollections', 'query.patch'],
    ['Reset the sorting', 'query.patch'],
  ]) {
    assert.equal(websiteCommandCanMatch(request), true, request);
    assert.equal(websiteQueryCommand(request, context)?.capabilityId, capabilityId, request);
  }
  for (const request of [
    'Open an unfamiliar thing',
    'Please narrow this to vegan slices priced below eight dollars, ordered with the priciest first.',
    'Publication-specific field includes any of red, blue',
  ]) assert.equal(websiteCommandCanMatch(request), true, 'Potential publication-driven matches must reach the server');
});

test('estimate recall opens current server state but qualified edits keep assistant interpretation', async t => {
  const { context, close } = await setup(); t.after(close);
  for (const text of ['Bring back my estimate', 'Show my current estimate again', 'Open the saved basket']) {
    assert.deepEqual(websiteQueryCommand(text, context), { capabilityId: 'estimate.show', input: {} });
  }
  for (const text of ['Bring back my estimate including tax', 'Show my estimate and change the quantities', 'Make the estimate three instead']) {
    assert.equal(websiteQueryCommand(text, context), null);
  }
});

test('unscoped show requests for information leave catalog ownership and state with the assistant across domains', async () => {
  for (const vocabulary of publisherVocabularies) {
    const space = taskFixture(vocabulary);
    space.records[0].summary = 'Contact information: telephone 000-000-0000. Opening hours and delivery policies are documented here.';
    space.records[0].blocks = [{ id: 'instructions', kind: 'paragraph', text: 'Scheduling instructions: consult the published service details.' }];
    const { context, ask, close } = await setup(space);
    try {
      await ask(`Only ${vocabulary.field} at least 4`);
      const before = structuredClone(context.session);
      for (const request of ['Show contact information', 'Please show your opening hours.', 'Show me delivery policies', 'Show scheduling instructions']) {
        assert.equal(websiteCommandCanMatch(request), true, 'This still reaches publication-aware routing');
        assert.equal(websiteQueryCommand(request, context), null, request);
        assert.deepEqual(context.session, before, 'Model handoff cannot replace the existing query, constraints or display');
      }
      for (const request of ['Search for contact information', 'Find contact information']) {
        assert.equal(websiteQueryCommand(request, context)?.capabilityId, 'query.patch', 'An explicit search keeps its catalog meaning even when the words are only in reading text');
      }
    } finally { await close(); }
  }
});

test('exact information-themed catalog identities still resolve as records, aliases and collections', async () => {
  for (const vocabulary of [publisherVocabularies[1], publisherVocabularies[6]]) for (const identity of ['record', 'alias', 'collection']) {
    const space = taskFixture(vocabulary);
    if (identity === 'record') space.records[0].name = 'Contact Information';
    else if (identity === 'alias') space.records[0].aliases = ['Contact Information'];
    else space.collections[1].name = 'Contact Information';
    const { context, ask, close } = await setup(space);
    try {
      if (identity === 'collection') assert.equal((await ask('Show Contact Information')).query.scope.collectionId, space.collections[1].id);
      else assert.deepEqual(websiteQueryCommand('Show Contact Information', context), { capabilityId: 'record.detail', input: { recordId: space.records[0].id } });
    } finally { await close(); }
  }
});

test('partial published names and alternatives stay fast while explicit and typed empty queries remain valid', async t => {
  const space = taskFixture();
  space.records[0].name = 'Amber Portfolio Project'; space.records[1].name = 'Cobalt Portfolio Project'; space.records[3].aliases = ['Amber Showcase'];
  const { context, ask, close } = await setup(space); t.after(close);
  assert.equal((await ask('Show amber')).result.count.value, 2);
  assert.equal((await ask('Show amber or cobalt')).result.count.value, 3);
  assert.equal((await ask('Include an unpublished term too')).result.count.value, 3, 'An explicit inclusion preserves the current search');
  for (const request of ['Search for an unpublished term', 'Find an unpublished term']) assert.equal((await ask(request)).result.count.value, 0);
  await ask('Clear search');
  assert.equal((await ask('Only reading minutes at least 999')).result.count.value, 0, 'A valid empty filter must not be weakened');
  assert.equal(websiteQueryCommand('Show amber', context)?.capabilityId, 'query.patch', 'Ownership comes from published names, not whether the current filters produce matches');
});

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

test('recorded menu requests browse every offering category instead of the menu reference article', async t => {
  const { context, ask, close } = await setup(recordedMenuFixture()); t.after(close);
  for (const request of ['Can you bring up the menu', 'Please show me the menu.', 'Open up your menu', 'Browse the menu again', 'Show me the complete menu', 'Show your entire menu']) {
    const view = await ask(request);
    assert.equal(view.result.count.value, 7, request);
    assert.equal(view.records.some(record => record.id === 'menu-article'), false);
    assert.equal(view.records.some(record => record.name === 'Vanilla Cupcake'), true);
  }
  const velvet = await ask('Show me velvet');
  assert.equal(velvet.result.count.value, 6);
  assert.equal(velvet.records.some(record => record.id === 'menu-article'), false);
  assert.equal(websiteQueryCommand('Bring up the menu and tell me what is good', context), null, 'compound requests keep their remaining work');
});

test('opening an item tolerates spoken punctuation and leaves partial ambiguity to dialogue resolution', async t => {
  const { context, close } = await setup(recordedMenuFixture()); t.after(close);
  for (const text of ['Open up the red-and-blue velvet', 'Open the Red and Blue Velvet', 'Could you please open up Red & Blue Velvet?']) {
    assert.deepEqual(websiteQueryCommand(text, context), { capabilityId: 'record.detail', input: { recordId: 'cake-0' } }, text);
  }
  for (const text of ['Open up the red and blue', 'Open a picture of it', 'Open the first one']) assert.equal(websiteQueryCommand(text, context), null, text);
  assert.deepEqual(websiteQueryCommand('Open Our Dessert Menu', context), { capabilityId: 'record.detail', input: { recordId: 'menu-article' } });
});

test('menu scope requires complete unmixed reviewed offering membership', () => {
  const space = recordedMenuFixture();
  space.memberships.push({ collectionId: 'cakes', recordId: 'menu-article' });
  assert.equal(publishedOfferingScope(compileQueryIndex(space)), null, 'do not call an incomplete or mixed collection the full menu');
  assert.equal(publishedOfferingScope(compileQueryIndex(taskFixture())), null, 'a prose-only publication stays with its reader');
});

test('a named menu excludes separate services without omitting its offering categories', async t => {
  const space = recordedMenuFixture();
  for (const collection of space.collections) if (['cakes', 'cupcakes'].includes(collection.id)) collection.name = `Our menu / ${collection.name}`;
  space.records.push({ id: 'separate-service', type: 'type-service', name: 'Event consultation', summary: '', aliases: [], assertions: [], blocks: [] });
  space.collections.push({ id: 'services-guide', name: 'Services and planning', introduction: '', kind: 'explicit', view: 'list' });
  space.edges.push({ parentId: space.rootId, childId: 'services-guide' });
  space.memberships.push({ collectionId: 'services-guide', recordId: 'separate-service' }, { collectionId: 'services-guide', recordId: 'menu-article' });
  const { ask, context, close } = await setup(space); t.after(close);
  assert.equal(publishedOfferingScope(context.index), null, 'The whole offering catalog is still mixed');
  const view = await ask('Show me the complete menu');
  assert.equal(view.result.count.value, 7);
  assert.equal(view.records.some(record => record.id === 'separate-service'), false);
  assert.equal(view.records.some(record => record.id === 'menu-article'), false);
});

test('a full menu resets earlier criteria while an ordinary menu request preserves them', async t => {
  const { ask, close } = await setup(websiteTaskFixture('products')); t.after(close);
  await ask('Only those under $40');
  assert.equal((await ask('Show me the menu')).result.count.value, 19);
  assert.equal((await ask('Show me the full menu')).result.count.value, 40);
  await ask('Only those under $40');
  assert.equal((await ask('Show me the complete menu')).result.count.value, 40);
});

test('comparisons with leading conversational words do not become a price sort', async () => {
  for (const kind of ['products', 'services'] as const) {
    const { context, close } = await setup(websiteTaskFixture(kind));
    try {
      for (const request of ['Okay, can you do a comparison, so the cheapest', 'Please compare the cheapest options', 'Sort by price and compare the first two', 'Most expensive versus cheapest']) {
        assert.equal(websiteQueryCommand(request, context), null, request);
      }
      assert.equal(websiteQueryCommand('Sort price cheapest first', context)?.capabilityId, 'query.patch');
    } finally { await close(); }
  }
});

test('item removal and compound basket edits reach the assistant without changing filters', async () => {
  for (const kind of ['products', 'services'] as const) {
    const { context, ask, close } = await setup(websiteTaskFixture(kind));
    try {
      await ask('Only those under $40');
      const before = structuredClone(context.session);
      for (const request of [
        'Remove the cheese and make it just one Sweet Chili Oxtail pie.',
        'Remove the cheese', 'Clear my estimate', 'Remove the studio session',
        'Remove the price limit and make it one item',
        'Show all cakes and change the quantity to three',
        'Show all services and remove the second item from my estimate',
      ]) assert.equal(websiteQueryCommand(request, context), null, `${kind}: ${request}`);
      assert.deepEqual(context.session, before, 'The assistant receives the entire edit before any query mutation');
      assert.equal((await ask('Remove the price limit')).result.count.value, 40);
      assert.equal(websiteQueryCommand('Remove the unknown filter', context)?.capabilityId, 'task.clarify');
    } finally { await close(); }
  }
});

test('compound category, limit and sort requests reach the model intact across publisher domains', async () => {
  for (const kind of ['products', 'services'] as const) {
    const { context, close } = await setup(websiteTaskFixture(kind));
    try {
      const before = structuredClone(context.session);
      for (const request of [
        'Show only vegan options under seven dollars per slice, cheapest first.',
        'Show vegan choices priced below eight dollars a slice, highest price first.',
        'Show vegan choices priced below eight dollars a slice',
        'Show consultations below forty dollars an hour',
        'Find studios with sessions before nine in the morning',
        'Show remote consultations under $40, cheapest first',
        'Sort the blue products by price descending',
        'Show studio services, largest duration first',
        'Show cheapest options under $40',
        'Sort price descending under $40',
      ]) assert.equal(websiteQueryCommand(request, context), null, request);
      assert.deepEqual(context.session, before, 'The shortcut must not apply a partial request');
      assert.equal(websiteQueryCommand('Sort price descending', context)?.capabilityId, 'query.patch');
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

test('currency markers cannot become another currency or a numeric unit', async () => {
  const space = websiteTaskFixture('services');
  space.fields.find(field => field.id === 'price')!.currency = 'EUR';
  for (const record of space.records) for (const assertion of record.assertions) {
    if (assertion.value?.type === 'money') assertion.value.currency = 'EUR';
  }
  const { context, ask, close } = await setup(space);
  try {
    await ask('Show me remote');
    for (const field of ['price', 'duration']) for (const amount of ['$40', '40 USD', '40 dollars', '40 dollar']) {
      const request = `Only ${field} under ${amount}`;
      const before = structuredClone(context.session.queries);
      assert.equal(websiteQueryCommand(request, context)?.capabilityId, 'task.clarify', request);
      await ask(request);
      assert.deepEqual(context.session.queries, before, 'A mismatched currency leaves the previous query intact');
    }
  } finally { await close(); }
});

test('implicit amounts keep published units and matching USD markers keep the price basis', async () => {
  for (const currency of ['EUR', 'USD']) {
    const space = websiteTaskFixture('services');
    space.fields.find(field => field.id === 'price')!.currency = currency;
    for (const record of space.records) for (const assertion of record.assertions) {
      if (assertion.value?.type === 'money') assertion.value.currency = currency;
    }
    const { ask, close } = await setup(space);
    try {
      for (const amount of currency === 'USD' ? ['40', '$40', '40 USD', '40 dollars', '40 dollar'] : ['40']) {
        const view = await ask(`Only price under ${amount}`);
        assert.equal(view.result.count.value, 19);
        assert.equal(view.result.exclusions.unknown, 1);
        const predicate = expressionNodes(view.query.where).find(node => node.kind === 'field' && node.fieldId === 'price');
        assert.ok(predicate?.kind === 'field');
        assert.deepEqual(predicate.value, { type: 'money', value: 40, currency, basis: 'session' });
      }
      await ask('Remove the price limit');
      const view = await ask('Only duration under 14');
      assert.equal(view.result.count.value, 4);
      const predicate = expressionNodes(view.query.where).find(node => node.kind === 'field' && node.fieldId === 'duration');
      assert.ok(predicate?.kind === 'field');
      assert.deepEqual(predicate.value, { type: 'number', value: 14, unit: 'minutes' });
    } finally { await close(); }
  }
});

test('decorated money labels support exact published bases without confusing projections with filters', async () => {
  for (const [kind, basis, otherBasis, request] of [
    ['products', 'Slice', 'Pie', 'Show me the pizza menu with slice and whole pie prices.'],
    ['services', 'Hourly', 'Project', 'Show me the consulting catalog with hourly and project rates.'],
  ] as const) {
    const space = websiteTaskFixture(kind, 7), price = space.fields.find(field => field.id === 'price')!;
    price.label = `Listed ${basis} price (USD)`; price.aliases = []; price.basis = basis;
    space.fields.push({ ...price, id: 'other-price', label: `Listed ${otherBasis} price (USD)`, basis: otherBasis });
    for (const [i, record] of space.records.entries()) {
      const assertion = record.assertions.find(assertion => assertion.fieldId === 'price')!;
      if (assertion.value) assertion.value = { type: 'money', value: i + 4, currency: 'USD', basis };
      record.assertions.push({ ...assertion, id: `other-price-${i}`, fieldId: 'other-price', value: { type: 'money', value: 20 + i, currency: 'USD', basis: otherBasis } });
    }
    const { context, ask, close } = await setup(space);
    try {
      const before = structuredClone(context.session);
      assert.equal(websiteQueryCommand(request, context), null, 'Display wording keeps the whole request for semantic projection');
      assert.equal(websiteQueryCommand(`Show me seasonal offerings with a ${basis} price under $8`, context), null, 'Do not discard a new subject while applying its bound');
      assert.equal(websiteQueryCommand(`Only those with red labels and a ${basis} price under $8`, context), null, 'Do not discard another qualification before the bound');
      assert.deepEqual(context.session, before);
      await ask(kind === 'products' ? 'Show me vanilla' : 'Show me studio');
      const view = await ask(`Only show those with a ${basis.toLowerCase()} price under $8.`);
      assert.deepEqual(view.records.map(record => record.id), ['record-00001'], 'Keep the existing category filter and exclude unknown/out-of-range prices');
      assert.ok(expressionNodes(view.query.where).some(node => node.kind === 'field' && node.fieldId === 'price' && node.op === 'lt'));
      assert.equal(websiteQueryCommand('Only those with a price under $8', context)?.capabilityId, 'task.clarify', 'An unspecified basis remains ambiguous');
      context.index.space.fields.find(field => field.id === 'other-price')!.basis = basis;
      assert.equal(websiteQueryCommand(`Only ${basis} price under $8`, context)?.capabilityId, 'task.clarify', 'Multiple published fields with the same basis remain ambiguous');
    } finally { await close(); }
  }
});

test('qualified menu and photo requests defer intact while exact identities and collection browsing remain available', async t => {
  const space = recordedMenuFixture();
  space.records[0].name = 'Desserts with prices';
  space.records[1].name = 'Photos of the four seasonal flavors';
  const { context, ask, close } = await setup(space); t.after(close);
  const before = structuredClone(context.session);
  for (const text of ['Show me the pizza menu', 'Show me the seasonal catalog', 'Show me photos of the four oxtail pizza flavors.', 'Show me photos of the chocolate flavors', 'Show me the winter gallery']) {
    assert.equal(websiteQueryCommand(text, context), null, text);
    assert.deepEqual(context.session, before, 'Semantic requests must not install partial keyword filters');
  }
  assert.deepEqual(websiteQueryCommand('Show me Desserts with prices', context), { capabilityId: 'record.detail', input: { recordId: 'menu-article' } });
  assert.deepEqual(websiteQueryCommand('Show me Photos of the four seasonal flavors', context), { capabilityId: 'record.detail', input: { recordId: 'cake-0' } });
  assert.equal((await ask('Show me the cakes menu')).result.count.value, 6, 'A resolved category still uses all reviewed memberships');
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
    space.collections.push({ id: 'album', name: 'Selected studies', introduction: '', kind: 'explicit', view: 'gallery' });
    space.edges.push({ parentId: 'photos', childId: 'album' });
    space.memberships.push({ collectionId: 'album', recordId: 'photo-0' });
    const { ask, close } = await setup(space);
    try {
      const initial = await ask('Show me your photos');
      assert.equal(initial.result.count.value, 3, 'A parent photo library includes its nested album without an invalid union');
      assert.equal(initial.query.scope.collectionId, 'photos');
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
  space.records[1].name = 'Winter catalog';
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
      const alternatives = kind === 'products' ? 'chocolate or vanilla' : 'remote or studio';
      assert.equal((await ask(`Show ${alternatives}`)).result.count.value, 27, 'Explicit alternatives of filter values remain supported');
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
