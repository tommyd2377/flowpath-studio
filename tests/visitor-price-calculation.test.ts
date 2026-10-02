import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { websiteTaskFixture } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { priceTotalInputSchema, totalPublishedPrices } from '../lib/visitor-price-calculation';
import { buildVisitorTaskView, executeVisitorCapability, visitorCapabilities } from '../lib/visitor-capabilities';
import { VisitorTaskStore } from '../lib/visitor-task-store';
import { localTaskDocuments } from '../lib/task-persistence';
import { updatePublishedEstimate } from '../lib/visitor-estimate';

const asOf = '2026-09-24';
function prices(amounts = [12.5, 3.5], currency = 'USD') {
  const space = websiteTaskFixture('products', amounts.length);
  space.relationships = [];
  space.fields.find(field => field.id === 'price')!.currency = currency;
  space.records.forEach((record, i) => { record.assertions.find(assertion => assertion.fieldId === 'price')!.value = { type: 'money', value: amounts[i], currency, basis: 'item' }; });
  return space;
}
const line = (position: number, quantity = 1) => ({ recordId: `record-${String(position).padStart(5, '0')}`, fieldId: 'price', quantity });

test('published-price arithmetic returns exact line totals and subtotal without model-supplied prices', () => {
  const space = prices(), index = compileQueryIndex(space), original = structuredClone(space);
  const result = totalPublishedPrices(index, { lines: [line(0, 2), line(1)] }, asOf);
  assert.equal(result.subtotalMinor, 2850);
  assert.equal(result.subtotal, '28.50');
  assert.equal(result.formattedSubtotal, 'USD 28.50');
  assert.deepEqual(result.lines.map(line => line.lineTotal), ['25.00', '3.50']);
  assert.equal(result.lines[0].per, 'item');
  assert.deepEqual(result.lines[0].assertionIds, ['price-0']);
  assert.match(result.note, /Taxes, fees, availability/);
  assert.deepEqual(space, original);
  assert.equal(priceTotalInputSchema.safeParse({ lines: [{ ...line(0), price: 1 }] }).success, false);
});

test('namespaced service and price IDs remain distinct through calculation and basket edits', () => {
  const space = websiteTaskFixture('services', 2);
  space.relationships = [];
  const price = space.fields.find(field => field.id === 'price')!;
  space.fields = space.fields.filter(field => field !== price).concat([
    { ...price, id: 'rate', label: 'Hourly rate', basis: 'hour' },
    { ...price, id: 'design:rate', label: 'Session price', basis: 'session' },
  ]);
  const references = [
    { recordId: 'service:design', fieldId: 'rate', quantity: 2 },
    { recordId: 'service', fieldId: 'design:rate', quantity: 1 },
  ];
  space.records.forEach((record, position) => {
    const previousId = record.id; record.id = references[position].recordId;
    for (const membership of space.memberships) if (membership.recordId === previousId) membership.recordId = record.id;
    const assertion = record.assertions.find(assertion => assertion.fieldId === 'price')!;
    assertion.fieldId = references[position].fieldId;
    assertion.value = { type: 'money', value: position ? 45 : 125, currency: 'USD', basis: position ? 'session' : 'hour' };
  });
  const index = compileQueryIndex(space);
  const total = totalPublishedPrices(index, { lines: references }, asOf);
  assert.equal(total.formattedSubtotal, 'USD 295.00');
  assert.deepEqual(total.lines.map(({ recordId, fieldId, per, lineTotal }) => [recordId, fieldId, per, lineTotal]), [
    ['service:design', 'rate', 'hour', '250.00'], ['service', 'design:rate', 'session', '45.00'],
  ]);
  const estimate = updatePublishedEstimate(index, undefined, { op: 'set', expectedRevision: 0, lines: references }, asOf);
  const edited = updatePublishedEstimate(index, estimate, { op: 'upsert', expectedRevision: 1, lines: [{ ...references[1], quantity: 2 }] }, asOf);
  assert.equal(edited.formattedSubtotal, 'USD 340.00');
  assert.deepEqual(edited.lines.map(({ quantity }) => quantity), [2, 2]);
  assert.equal(estimate.formattedSubtotal, 'USD 295.00');
  assert.throws(() => totalPublishedPrices(index, { lines: [references[0], references[0]] }, asOf), /Combine quantities/);
});

test('listed subtotals retain source qualifications instead of claiming final payable prices', () => {
  const space = prices();
  space.fields.push({ id: 'source-terms', label: 'Price / size terms', type: 'text', cardinality: 'one', aliases: [], recordTypes: [], operations: [], filter: false, sort: false, facet: false, coverage: { known: 1, total: 2 } });
  space.records[0].assertions.push({ id: 'starting-price-terms', fieldId: 'source-terms', value: { type: 'text', value: 'Starting price; materials cost extra.' }, polarity: 'affirmed', conditions: [], authority: 'publisher' });
  const result = totalPublishedPrices(compileQueryIndex(space), { lines: [line(0, 2)] }, asOf);
  assert.equal(result.basis, 'listed-prices-only');
  assert.deepEqual(result.lines[0].sourceTerms, ['Starting price; materials cost extra.']);
  assert.match(result.note, /retain source price qualifications/);
});

test('decimal multiplication rounds each line half up before summing currency minor units', () => {
  for (const [amounts, quantities, currency, expected] of [
    [[0.1, 0.2], [1, 1], 'USD', '0.30'],
    [[1.005, 1.005], [1, 1], 'USD', '2.02'],
    [[0.333333], [3], 'USD', '1.00'],
    [[12.5], [1], 'JPY', '13'],
    [[1.2345], [1], 'KWD', '1.235'],
  ] as const) {
    const result = totalPublishedPrices(compileQueryIndex(prices([...amounts], currency)), { lines: quantities.map((quantity, i) => line(i, quantity)) }, asOf);
    assert.equal(result.subtotal, expected);
  }
});

test('calculation refuses ungrounded, conditional, stale, conflicting or incompatible inputs', () => {
  for (const modify of [
    (space: ReturnType<typeof prices>) => { space.records[0].assertions.find(value => value.fieldId === 'price')!.value = null; },
    (space: ReturnType<typeof prices>) => { space.records[0].assertions.find(value => value.fieldId === 'price')!.conditions = ['Starting price only']; },
    (space: ReturnType<typeof prices>) => { space.records[0].assertions.find(value => value.fieldId === 'price')!.validTo = '2020-01-01'; },
    (space: ReturnType<typeof prices>) => { const price = space.records[0].assertions.find(value => value.fieldId === 'price')!; space.records[0].assertions.push({ ...price, id: 'contradicting-price', value: { ...price.value!, value: 17 } }); },
  ]) {
    const space = prices(); modify(space);
    assert.throws(() => totalPublishedPrices(compileQueryIndex(space), { lines: [line(0)] }, asOf), /known, current, unconditional/);
  }
  const index = compileQueryIndex(prices());
  for (const input of [{ lines: [] }, { lines: [line(0, 0)] }, { lines: [line(0, 1.5)] }, { lines: [line(0, 1001)] }, { lines: Array.from({ length: 13 }, () => line(0)) }]) assert.throws(() => totalPublishedPrices(index, input, asOf));
  assert.throws(() => totalPublishedPrices(index, { lines: [line(0), line(0)] }, asOf), /Combine quantities/);
  assert.throws(() => totalPublishedPrices(index, { lines: [{ ...line(0), recordId: 'unpublished' }] }, asOf), /known, current/);
  assert.throws(() => totalPublishedPrices(index, { lines: [{ ...line(0), fieldId: 'size' }] }, asOf), /money field/);
  assert.throws(() => totalPublishedPrices(compileQueryIndex(prices([0.0000001])), { lines: [line(0)] }, asOf), /precision bound/);
  const mixed = prices();
  mixed.fields.push({ ...mixed.fields.find(field => field.id === 'price')!, id: 'euro-price', currency: 'EUR' });
  mixed.records[1].assertions.push({ id: 'euro-price', fieldId: 'euro-price', value: { type: 'money', value: 4, currency: 'EUR', basis: 'item' }, polarity: 'affirmed', conditions: [], authority: 'publisher' });
  assert.throws(() => totalPublishedPrices(compileQueryIndex(mixed), { lines: [line(0), { ...line(1), fieldId: 'euro-price' }] }, asOf), /cannot mix currencies/);
});

test('registered calculation is read-only, retains calculated evidence and keeps the displayed view', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-price-total-'));
  try {
    const index = compileQueryIndex(prices()), store = new VisitorTaskStore(localTaskDocuments(directory));
    let session = await store.create(index.space.publication);
    buildVisitorTaskView({ index, session, signal: new AbortController().signal }); session = await store.save(session, session.revision);
    const result = await executeVisitorCapability({ index, store, sessionId: session.id, signal: new AbortController().signal, assertCurrent: async () => {},
      call: { capabilityId: 'prices.total', input: { lines: [line(0, 2), line(1)] }, operationId: randomUUID(), expectedRevision: session.revision } });
    assert.equal(visitorCapabilities.get('prices.total')!.descriptor.effect, 'read');
    assert.equal((result.data as { formattedSubtotal: string }).formattedSubtotal, 'USD 28.50');
    const saved = await store.read(session.id, index.space.publication);
    assert.deepEqual(saved.presentation, session.presentation);
    assert.deepEqual(saved.queries, session.queries);
    assert.equal(saved.tasks.at(-1)?.status, 'completed');
    assert.equal(saved.evidence.find(evidence => evidence.handle.id === result.handleId)?.handle.authority, 'calculated');
    const bridge = await readFile(new URL('../lib/visitor-task-bridge.ts', import.meta.url), 'utf8');
    assert.match(bridge, /you must call prices.total/);
    assert.match(bridge, /Use the returned lineTotal and formattedSubtotal verbatim/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
