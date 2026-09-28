import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublishedEstimateView } from '../../packages/platform-ui/src/PublishedEstimate.js';
import { publishedEstimateNote, publishedEstimateRounding, publishedEstimateSchema, type PublishedEstimate } from '../../packages/platform-ui/src/estimate.js';
import { taskSurfaceRevisionMatches } from '../../lib/workspace-screen.js';

const fixture = (): PublishedEstimate => publishedEstimateSchema.parse({
  revision: 3, publication: { siteId: 'sample-site', revisionId: 'published-1', indexRevision: 'index-1' }, asOf: '2026-09-24T16:00:00Z',
  basis: 'listed-prices-only', rounding: publishedEstimateRounding, currency: 'USD', fractionDigits: 2,
  lines: [{ recordId: 'item', fieldId: 'single-price', name: 'Example offering', quantity: 2, unitPrice: 12.5, unit: 'person', per: 'person', lineTotal: '25.00',
    sourceSummary: 'Published item description.', sourceTerms: ['Materials are charged separately.'], assertionIds: ['price-one'] },
  { recordId: 'item', fieldId: 'package-price', name: 'Example offering', quantity: 1, unitPrice: 75, unit: 'package', per: 'package', lineTotal: '75.00', sourceSummary: '', sourceTerms: [], assertionIds: ['price-two'] }],
  subtotalMinor: 10000, subtotal: '100.00', formattedSubtotal: 'USD 100.00', note: publishedEstimateNote,
});
const render = (estimate: PublishedEstimate, options: { busy?: boolean; historical?: boolean } = {}) => renderToStaticMarkup(createElement(PublishedEstimateView, { estimate, ...options }));
const withTax = (mode: 'researched' | 'hypothetical' = 'hypothetical', complete = true): PublishedEstimate => {
  const estimate = fixture();
  return publishedEstimateSchema.parse({ ...estimate, tax: {
    mode, status: complete ? 'complete' : 'incomplete', label: mode === 'researched' ? 'Researched tax estimate' : 'Hypothetical tax estimate',
    calculatedAt: '2026-09-24T16:00:00Z', expiresAt: '2026-09-24T17:00:00Z', basisHash: 'a'.repeat(64), currency: 'USD', fractionDigits: 2,
    jurisdiction: 'Example jurisdiction', location: 'Example location', fulfillment: 'Pickup', applicabilityNotes: ['Only the selected item classifications.'], visitorAssumption: mode === 'hypothetical' ? 'For illustration, use 5%.' : null,
    rounding: 'Round each line tax half up to the currency minor unit, then sum the rounded taxes.',
    lines: estimate.lines.map(line => ({ recordId: line.recordId, fieldId: line.fieldId, taxability: complete ? 'taxable' : 'unknown', classification: 'Example category', taxabilityNotes: 'Taxability is a test assumption.',
      ratePercent: complete ? '5' : null, taxMinor: complete ? 125 : null, tax: complete ? '1.25' : null,
      evidence: mode === 'researched' ? [{ resultId: 'source-1', url: 'https://example.com/authority', excerpt: 'Test evidence.', title: 'Example authority', fetchedAt: '2026-09-24T15:00:00Z', start: 0, end: 14 }] : [],
    })),
    estimatedTaxMinor: complete ? 500 : null, estimatedTax: complete ? '5.00' : null, estimatedTotalMinor: complete ? 10500 : null, estimatedTotal: complete ? '105.00' : null,
    missing: complete ? [] : ['Confirm the transaction location.'], notes: ['No real tax rule is represented by this fixture.'],
  } });
};

test('published estimate keeps variants, units, quantities and exact totals distinct without a price paragraph dump', () => {
  const html = render(fixture());
  assert.match(html, /aria-label="Published price estimate"/);
  assert.match(html, /data-estimate-revision="3"/);
  assert.match(html, /data-price-field="single-price"/);
  assert.match(html, /data-price-field="package-price"/);
  assert.match(html, /USD 12\.50 <span>per person<\/span>/);
  assert.match(html, /USD 75\.00 <span>per package<\/span>/);
  assert.match(html, /aria-label="Quantity of Example offering, person: 2">2 ×<\/span> USD 12\.50/);
  assert.match(html, /aria-label="Quantity of Example offering, package: 1">1 ×<\/span> USD 75\.00/);
  assert.match(html, /aria-label="Line total for Example offering, person">USD 25\.00/);
  assert.match(html, /<details class="platform-estimate-source"><summary>Price details<\/summary><p>Published item description\.<\/p><p>Materials are charged separately\.<\/p><\/details>/);
  assert.doesNotMatch(html, /<button|Clear estimate|Remove|Increase quantity|Decrease quantity/);
  assert.match(html, /Tax has not been calculated\./);
  assert.match(html, /<dt>Estimated tax<\/dt><dd>Not included<\/dd>/);
  assert.match(html, /<dt>Before tax<\/dt><dd>USD 100\.00<\/dd>/);
  assert.doesNotMatch(html, /Checkout|Place order|<dt>Estimated total<\/dt>/);
});

test('current, historical and pending estimates are read-only with source disclosures retained', () => {
  for (const options of [{ historical: true }, { busy: true }, {}]) {
    const html = render(fixture(), options);
    assert.doesNotMatch(html, /<button|<input|<select|Clear estimate|Remove|Increase quantity|Decrease quantity/);
    assert.match(html, /<details class="platform-estimate-source"><summary>Price details<\/summary>/);
    if (options.historical) assert.match(html, /Earlier estimate · shown as it was\./);
    if (options.busy) assert.match(html, /aria-busy="true"/);
  }
});

test('display acknowledgement waits for the rendered estimate revision even when item identities are unchanged', () => {
  const previous = fixture();
  const next = publishedEstimateSchema.parse({ ...previous, revision: 4, lines: previous.lines.map((line, index) => index === 0 ? { ...line, quantity: 3, lineTotal: '37.50' } : line), subtotalMinor: 11250, subtotal: '112.50', formattedSubtotal: 'USD 112.50' });
  const renderedSurface = (estimate: PublishedEstimate) => ({ dataset: { estimateRevision: /data-estimate-revision="(\d+)"/.exec(render(estimate))?.[1] } });
  const requested = { focus: 'estimate' as const, estimate: next };
  assert.deepEqual(next.lines.map(line => [line.recordId, line.fieldId]), previous.lines.map(line => [line.recordId, line.fieldId]));
  assert.equal(taskSurfaceRevisionMatches(requested, renderedSurface(previous)), false, 'the old visible estimate cannot acknowledge a quantity-only update');
  assert.equal(taskSurfaceRevisionMatches(requested, null), false);
  assert.equal(taskSurfaceRevisionMatches(requested, { dataset: {} }), false);
  assert.equal(taskSurfaceRevisionMatches(requested, renderedSurface(next)), true);
  assert.equal(taskSurfaceRevisionMatches({ focus: 'estimate', estimate: previous }, renderedSurface(previous)), true, 'an intentional historical restore acknowledges its own revision');
  assert.equal(taskSurfaceRevisionMatches({ focus: 'query' }, { dataset: {} }), true, 'other surfaces retain their existing receipt rules');
});

test('empty estimate offers a clear starting state and does not imply zero tax or free items', () => {
  const estimate = publishedEstimateSchema.parse({ ...fixture(), lines: [], currency: null, fractionDigits: null, subtotalMinor: 0, subtotal: '0', formattedSubtotal: '0' });
  const html = render(estimate);
  assert.match(html, /Your estimate is empty/);
  assert.doesNotMatch(html, /Estimate totals|Estimated tax|Clear estimate|USD 0/);
});

test('hypothetical and researched estimates keep their authority visible and expose retained assumptions', () => {
  const hypothetical = render(withTax());
  assert.match(hypothetical, /<dt>Hypothetical tax<\/dt><dd>USD 5\.00<\/dd>/);
  assert.match(hypothetical, /<dt>Estimated total<\/dt><dd>USD 105\.00<\/dd>/);
  assert.match(hypothetical, /Hypothetical tax estimate/);
  assert.match(hypothetical, /For illustration, use 5%\./);
  const researched = render(withTax('researched'));
  assert.match(researched, /Researched tax estimate/);
  assert.match(researched, /href="https:\/\/example.com\/authority" target="_blank" rel="noopener noreferrer"/);
  assert.equal((researched.match(/>Example authority<\/a>/g) ?? []).length, 1);
  assert.match(researched, /Tax assumptions &amp; sources/);
});

test('incomplete tax never becomes zero or a final inclusive total', () => {
  const html = render(withTax('researched', false));
  assert.match(html, /Researched tax estimate · Incomplete/);
  assert.match(html, /Confirm the transaction location\./);
  assert.match(html, /<dt>Estimated tax<\/dt><dd>Not included<\/dd>/);
  assert.doesNotMatch(html, /<dt>Estimated total<\/dt>|USD 0\.00/);
});

test('missing tax context uses the item and variant instead of backend identifiers', () => {
  const estimate = withTax('researched', false);
  estimate.tax!.missing = ['item/single-price: Establish the classification.', 'item/package-price: Confirm the applicable rate.', 'Confirm the transaction location.'];
  const html = render(estimate);
  assert.match(html, /<li>Example offering · person: Establish the classification\.<\/li>/);
  assert.match(html, /<li>Example offering · package: Confirm the applicable rate\.<\/li>/);
  assert.match(html, /<li>Confirm the transaction location\.<\/li>/);
  assert.doesNotMatch(html, /item\/single-price:|item\/package-price:/);
});

test('untrusted labels and terms stay escaped and unsafe source links are not interactive', () => {
  const estimate = withTax('researched');
  estimate.lines[0].name = '<script>not an instruction</script>';
  estimate.lines[0].sourceTerms = ['<img src=x onerror=alert(1)>'];
  estimate.tax!.lines[0].evidence[0].url = 'javascript:alert(1)';
  estimate.tax!.lines[1].evidence[0].url = 'https://127.0.0.1/private';
  const html = render(estimate);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script|<img|href=/);
});

test('fractional published unit precision and large quantities remain visible without editing controls', () => {
  const estimate = fixture();
  estimate.lines = [{ ...estimate.lines[0], quantity: 1000, unitPrice: .123456, lineTotal: '123.46', unit: 'unit' }];
  const html = render(estimate);
  assert.match(html, /USD 0\.123456 <span>per unit/);
  assert.match(html, /aria-label="Quantity of Example offering, unit: 1000">1000 ×<\/span>/);
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /USD 123\.46/);
});
