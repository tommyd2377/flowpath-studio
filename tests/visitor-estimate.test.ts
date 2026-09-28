import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateUpdateInputSchema, publishedEstimateSchema } from '@thevoice/platform-ui/estimate';
import { websiteTaskFixture } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { readPublishedEstimate, updatePublishedEstimate } from '../lib/visitor-estimate';

const asOf = '2026-09-24';
const line = (position: number, quantity = 1, fieldId = 'price') => ({ recordId: `record-${String(position).padStart(5, '0')}`, fieldId, quantity });
function pricedSpace(kind: 'products' | 'services' = 'products', amounts = [12.5, 3.5], currency = 'USD') {
  const space = websiteTaskFixture(kind, amounts.length);
  space.relationships = [];
  space.fields.find(field => field.id === 'price')!.currency = currency;
  for (const [position, record] of space.records.entries()) record.assertions.find(assertion => assertion.fieldId === 'price')!.value = {
    type: 'money', value: amounts[position], currency, basis: kind === 'products' ? 'item' : 'session',
  };
  return space;
}

test('estimates start and clear empty without inventing a currency or a priced line', () => {
  const index = compileQueryIndex(pricedSpace()), empty = readPublishedEstimate(index, undefined, asOf);
  assert.equal(empty.revision, 0);
  assert.deepEqual(empty.publication, index.space.publication);
  assert.deepEqual(empty.lines, []);
  assert.equal(empty.currency, null);
  assert.equal(empty.fractionDigits, null);
  assert.equal(empty.subtotalMinor, 0);
  assert.equal(empty.formattedSubtotal, '0');
  const populated = updatePublishedEstimate(index, empty, { op: 'set', expectedRevision: 0, lines: [line(0)] }, asOf);
  const cleared = updatePublishedEstimate(index, populated, { op: 'clear', expectedRevision: 1 }, asOf);
  assert.deepEqual(cleared, { ...empty, revision: 2 });
  assert.deepEqual(updatePublishedEstimate(index, populated, { op: 'set', expectedRevision: 1, lines: [] }, asOf), cleared);
  assert.equal(publishedEstimateSchema.safeParse({ ...empty, currency: 'USD' }).success, false);
});

test('set replaces the basket, upsert sets absolute quantities, and remove keeps other lines', () => {
  const index = compileQueryIndex(pricedSpace());
  const first = updatePublishedEstimate(index, undefined, { op: 'set', expectedRevision: 0, lines: [line(0, 2), line(1)] }, asOf);
  assert.equal(first.formattedSubtotal, 'USD 28.50');
  const original = structuredClone(first);
  const second = updatePublishedEstimate(index, first, { op: 'upsert', expectedRevision: 1, lines: [line(0, 3)] }, asOf);
  assert.deepEqual(second.lines.map(({ quantity }) => quantity), [3, 1]);
  assert.equal(second.subtotal, '41.00');
  const third = updatePublishedEstimate(index, second, { op: 'remove', expectedRevision: 2, lines: [{ recordId: line(0).recordId, fieldId: 'price' }] }, asOf);
  assert.deepEqual(third.lines.map(({ recordId }) => recordId), [line(1).recordId]);
  assert.equal(third.subtotal, '3.50');
  const replaced = updatePublishedEstimate(index, third, { op: 'set', expectedRevision: 3, lines: [line(0)] }, asOf);
  assert.equal(replaced.subtotal, '12.50');
  assert.deepEqual(first, original, 'Helpers do not mutate the prior server state');
});

test('product and service estimates derive names, terms, bases and prices only from published data', () => {
  for (const kind of ['products', 'services'] as const) {
    const space = pricedSpace(kind);
    space.fields.push({ id: 'terms', label: 'Price / size terms', type: 'text', cardinality: 'one', aliases: [], recordTypes: [], operations: [], filter: false, sort: false, facet: false, coverage: { known: 1, total: 2 } });
    space.records[0].assertions.push({ id: 'terms-0', fieldId: 'terms', value: { type: 'text', value: 'Starting price; published extras are separate. Availability is not guaranteed.' }, polarity: 'affirmed', conditions: [], authority: 'publisher' });
    const index = compileQueryIndex(space), estimate = updatePublishedEstimate(index, undefined, { op: 'set', expectedRevision: 0, lines: [line(0, 2)] }, asOf);
    assert.equal(estimate.lines[0].name, space.records[0].name);
    assert.equal(estimate.lines[0].per, kind === 'products' ? 'item' : 'session');
    assert.deepEqual(estimate.lines[0].assertionIds, ['price-0']);
    assert.match(estimate.lines[0].sourceTerms[0], /Starting price/);
    assert.match(estimate.note, /availability/);
    const forgedCache = { ...estimate, subtotalMinor: 1, subtotal: '0.01', formattedSubtotal: 'USD 0.01', lines: [{ ...estimate.lines[0], name: 'Untrusted name', unitPrice: 0.01, lineTotal: '0.01' }] };
    assert.deepEqual(readPublishedEstimate(index, forgedCache, asOf), estimate, 'Cached display values never supply arithmetic inputs');
    assert.equal(estimateUpdateInputSchema.safeParse({ op: 'set', expectedRevision: 0, lines: [{ ...line(0), unitPrice: 1 }] }).success, false);
  }
});

test('one record can have distinct explicit price variants without guessing or converting bases', () => {
  const space = pricedSpace();
  space.fields.push({ ...space.fields.find(field => field.id === 'price')!, id: 'pack-price', label: 'Published pack price', basis: 'pack' });
  space.records[0].assertions.push({ id: 'pack-price-0', fieldId: 'pack-price', value: { type: 'money', value: 75, currency: 'USD', basis: 'pack' }, polarity: 'affirmed', conditions: [], authority: 'publisher' });
  const index = compileQueryIndex(space);
  const estimate = updatePublishedEstimate(index, undefined, { op: 'set', expectedRevision: 0, lines: [line(0, 2), line(0, 1, 'pack-price')] }, asOf);
  assert.equal(estimate.subtotal, '100.00');
  assert.deepEqual(estimate.lines.map(({ per }) => per), ['item', 'pack']);
  const edited = updatePublishedEstimate(index, estimate, { op: 'upsert', expectedRevision: 1, lines: [line(0, 2, 'pack-price')] }, asOf);
  assert.equal(edited.subtotal, '175.00');
  assert.equal(edited.lines[0].quantity, 2);
  assert.throws(() => updatePublishedEstimate(index, estimate, { op: 'set', expectedRevision: 1, lines: [{ recordId: line(0).recordId, quantity: 1 }] }, asOf));
});

test('revision conflicts, missing removals and invalid edits preserve the previous estimate', () => {
  const index = compileQueryIndex(pricedSpace()), estimate = updatePublishedEstimate(index, undefined, { op: 'set', expectedRevision: 0, lines: [line(0)] }, asOf);
  const original = structuredClone(estimate);
  assert.throws(() => updatePublishedEstimate(index, estimate, { op: 'clear', expectedRevision: 0 }, asOf), /Estimate changed/);
  assert.throws(() => updatePublishedEstimate(index, undefined, { op: 'clear', expectedRevision: 1 }, asOf), /Estimate changed/);
  assert.throws(() => updatePublishedEstimate(index, estimate, { op: 'remove', expectedRevision: 1, lines: [{ recordId: line(1).recordId, fieldId: 'price' }] }, asOf), /line was not found/);
  assert.throws(() => updatePublishedEstimate(index, estimate, { op: 'upsert', expectedRevision: 1, lines: [line(1), { ...line(0), fieldId: 'unpublished' }] }, asOf), /known, current/);
  assert.deepEqual(estimate, original);
});

test('publication identity and as-of time are validated before returning a revalued estimate', () => {
  const space = pricedSpace(), index = compileQueryIndex(space);
  const estimate = updatePublishedEstimate(index, undefined, { op: 'set', expectedRevision: 0, lines: [line(0)] }, asOf);
  for (const key of ['siteId', 'revisionId', 'indexRevision'] as const) {
    const changed = { ...estimate, publication: { ...estimate.publication, [key]: 'different' } };
    assert.throws(() => readPublishedEstimate(index, changed, asOf), /publication changed/);
    assert.throws(() => updatePublishedEstimate(index, changed, { op: 'clear', expectedRevision: 1 }, asOf), /publication changed/);
  }
  assert.throws(() => readPublishedEstimate(index, estimate, 'not-a-date'));
  assert.throws(() => readPublishedEstimate(index, { ...estimate, asOf: '2026-02-30' }, asOf));
  space.records[0].assertions.find(assertion => assertion.fieldId === 'price')!.validTo = '2026-09-24';
  const dated = compileQueryIndex(space);
  assert.throws(() => readPublishedEstimate(dated, estimate, '2026-09-25'), /known, current/);
  assert.equal(updatePublishedEstimate(dated, estimate, { op: 'clear', expectedRevision: 1 }, '2026-09-25').lines.length, 0, 'Expired lines can still be removed');
});

test('cached tax is invalidated when reading or editing and empty baskets can explain incomplete tax', () => {
  const index = compileQueryIndex(pricedSpace()), estimate = updatePublishedEstimate(index, undefined, { op: 'set', expectedRevision: 0, lines: [line(0)] }, asOf);
  const tax = {
    mode: 'hypothetical', status: 'incomplete', label: 'Hypothetical tax estimate', calculatedAt: '2026-09-24T12:00:00Z', expiresAt: '2026-09-24T12:30:00Z', basisHash: 'a'.repeat(64),
    currency: estimate.currency, fractionDigits: estimate.fractionDigits, jurisdiction: null, location: null, fulfillment: null, applicabilityNotes: [], visitorAssumption: 'Example only.',
    rounding: 'Round each line tax half up to the currency minor unit, then sum the rounded taxes.', lines: [],
    estimatedTaxMinor: null, estimatedTax: null, estimatedTotalMinor: null, estimatedTotal: null, missing: ['Tax scope is unknown.'], notes: [],
  };
  const cached = publishedEstimateSchema.parse({ ...estimate, tax });
  assert.equal(readPublishedEstimate(index, cached, asOf).tax, undefined);
  assert.equal(updatePublishedEstimate(index, cached, { op: 'upsert', expectedRevision: 1, lines: [line(0, 2)] }, asOf).tax, undefined);
  const empty = readPublishedEstimate(index, undefined, asOf);
  assert.equal(publishedEstimateSchema.safeParse({ ...empty, tax: { ...tax, currency: null, fractionDigits: null } }).success, true);
  assert.equal(publishedEstimateSchema.safeParse({ ...estimate, tax: { ...tax, currency: 'EUR' } }).success, false);
});

test('basket bounds reject extra lines, duplicate variants, invalid quantities and caller-supplied amounts', () => {
  const index = compileQueryIndex(pricedSpace('products', Array.from({ length: 13 }, () => 1)));
  for (const lines of [[line(0, 0)], [line(0, 1001)], [line(0, 1.5)], [line(0), line(0)], Array.from({ length: 13 }, (_, i) => line(i))]) {
    assert.throws(() => updatePublishedEstimate(index, undefined, { op: 'set', expectedRevision: 0, lines }, asOf));
  }
  const full = updatePublishedEstimate(index, undefined, { op: 'set', expectedRevision: 0, lines: Array.from({ length: 12 }, (_, i) => line(i, 1000)) }, asOf);
  assert.equal(full.subtotal, '12000.00');
  assert.throws(() => updatePublishedEstimate(index, full, { op: 'upsert', expectedRevision: 1, lines: [line(12)] }, asOf));
  assert.throws(() => updatePublishedEstimate(index, full, { op: 'clear', expectedRevision: 1, subtotal: 1 }, asOf));
});

test('unknown, conditional and conflicting price assertions never become estimate prices', () => {
  for (const modify of [
    (space: ReturnType<typeof pricedSpace>) => { space.records[0].assertions.find(assertion => assertion.fieldId === 'price')!.value = null; },
    (space: ReturnType<typeof pricedSpace>) => { space.records[0].assertions.find(assertion => assertion.fieldId === 'price')!.conditions = ['Only with publisher review']; },
    (space: ReturnType<typeof pricedSpace>) => { const price = space.records[0].assertions.find(assertion => assertion.fieldId === 'price')!; space.records[0].assertions.push({ ...price, id: 'conflicting-price', value: { ...price.value!, value: 200 } }); },
  ]) {
    const space = pricedSpace(); modify(space);
    assert.throws(() => updatePublishedEstimate(compileQueryIndex(space), undefined, { op: 'set', expectedRevision: 0, lines: [line(0)] }, asOf), /known, current, unconditional/);
  }
});

test('basket totals retain currency minor-unit rounding and reject mixed currencies', () => {
  for (const [currency, amounts, subtotal] of [['USD', [1.005, 1.005], '2.02'], ['JPY', [12.5, 2.1], '15'], ['KWD', [1.2345, 1], '2.235']] as const) {
    const index = compileQueryIndex(pricedSpace('services', [...amounts], currency));
    assert.equal(updatePublishedEstimate(index, undefined, { op: 'set', expectedRevision: 0, lines: [line(0), line(1)] }, asOf).subtotal, subtotal);
  }
  const space = pricedSpace();
  space.fields.push({ ...space.fields.find(field => field.id === 'price')!, id: 'euro-price', currency: 'EUR' });
  space.records[1].assertions.push({ id: 'euro-price-1', fieldId: 'euro-price', value: { type: 'money', value: 4, currency: 'EUR', basis: 'item' }, polarity: 'affirmed', conditions: [], authority: 'publisher' });
  assert.throws(() => updatePublishedEstimate(compileQueryIndex(space), undefined, { op: 'set', expectedRevision: 0, lines: [line(0), line(1, 1, 'euro-price')] }, asOf), /cannot mix currencies/);
});
