import test from 'node:test';
import assert from 'node:assert/strict';
import { taskFixture, websiteTaskFixture } from '../fixtures/visitor-tasks';
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
