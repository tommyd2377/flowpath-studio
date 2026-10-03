import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnimatePresence } from 'motion/react';
import { TaskComparison, PublishedEstimateView } from '@thevoice/platform-ui/task-components';
import { RichAnswer } from '@thevoice/platform-ui/answer';
import { CatalogExplorer, PresentationView, ExternalSearchResults, MediaProvider, MediaVideo, type ExternalSearchResult } from '@thevoice/platform-ui';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { comparisonPlan, initialInteraction } from '@thevoice/platform-ui/interaction';
import { publishedEstimateNote, publishedEstimateRounding, publishedEstimateSchema } from '@thevoice/platform-ui/estimate';
import { websiteTaskFixture } from '../../fixtures/visitor-tasks';
import { comparisonMissingnessCatalog } from '../helpers/v1-comparison-missingness.fixture';

// Exercise the real shared markup and styles in an isolated browser document.
// Shell integration, hydration and Motion transitions have their own browser suites.
const styles = ['styles.css', 'answer.css', 'estimate.css'].map(file => readFileSync(new URL(`../../packages/platform-ui/src/${file}`, import.meta.url), 'utf8').replace(/^@import[^;]+;\s*$/gm, '')).join('\n');
async function show(page: Page, content: ReactNode) {
  await page.setContent('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shared mobile components</title><body><main class="platform-information-frame">' + renderToStaticMarkup(content) + '</main></body></html>');
  await page.addStyleTag({ content: `* { box-sizing: border-box; } body { margin: 0; padding: 16px; font: 16px/1.5 system-ui, sans-serif; --platform-body-font: system-ui, sans-serif; --platform-heading-font: system-ui, sans-serif; --platform-bg: #faf8f2; --platform-text: #202922; --platform-muted: #59655c; --platform-accent: #265d43; --platform-line: #58685a44; --platform-border: #58685a44; color: var(--platform-text); background: var(--platform-bg); } ${styles}` });
}
const fitsViewport = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const comparisons = [
  { domain: 'restaurant', names: ['Garden bowl', 'Charred vegetable bowl'], fields: ['Price', 'Ingredients', 'Conditions'], values: [['USD 14', 'Chickpeas, kale and herbs', 'Dressing contains sesame.'], ['USD 16', 'Seasonal vegetables and rice', 'Ingredients change with the season.']] },
  { domain: 'services', names: ['Repair consultation', 'Annual maintenance'], fields: ['Starting price', 'Duration', 'Conditions'], values: [['USD 80', '45 minutes', 'Materials are charged separately.'], ['unknown', 'Two scheduled visits', 'Quote follows an assessment.']] },
  { domain: 'bookshop', names: ['The Imaginary Harbor', 'The Cedar Atlas'], fields: ['Price', 'Format', 'Pages'], values: [['USD 24', 'Hardcover with illustrated endpapers', '320'], ['USD 18', 'Paperback', '256']] },
  { domain: 'freelancer', names: ['Brand strategy workshop', 'Portfolio review'], fields: ['Starting price', 'Duration', 'Conditions'], values: [['USD 300', 'Two hours', 'Includes one written recommendation.'], ['USD 125', '45 minutes', 'Additional revisions quoted separately.']] },
];
const fieldTemplate = websiteTaskFixture('products', 2).fields[0];
function comparisonFixture(sample: typeof comparisons[number]) {
  return { fields: sample.fields.map((label, index) => ({ ...fieldTemplate, id: `field-${index}`, label })), rows: sample.names.map((name, index) => ({ id: `item-${index}`, name, values: sample.values[index].map((text, field) => ({ fieldId: `field-${field}`, text })) })) };
}
const estimate = publishedEstimateSchema.parse({
  revision: 2, publication: { siteId: 'synthetic-publisher', revisionId: 'publication-1', indexRevision: 'index-1' }, asOf: '2026-09-27T12:00:00Z',
  basis: 'listed-prices-only', rounding: publishedEstimateRounding, currency: 'USD', fractionDigits: 2,
  lines: [
    { recordId: 'book', fieldId: 'hardcover', name: 'The Imaginary Harbor · illustrated hardcover', quantity: 2, unitPrice: 24, unit: 'book', per: 'book', lineTotal: '48.00', sourceSummary: 'Published hardcover edition.', sourceTerms: ['Gift wrapping is quoted separately.'], assertionIds: ['price-book'] },
    { recordId: 'service', fieldId: 'consultation', name: 'Repair and maintenance consultation', quantity: 1, unitPrice: 80, unit: 'session', per: 'session', lineTotal: '80.00', sourceSummary: '', sourceTerms: ['Materials are charged separately.'], assertionIds: ['price-service'] },
  ],
  subtotalMinor: 12800, subtotal: '128.00', formattedSubtotal: 'USD 128.00', note: publishedEstimateNote,
  tax: {
    mode: 'hypothetical', status: 'complete', label: 'Hypothetical tax estimate', calculatedAt: '2026-09-27T12:00:00Z', expiresAt: '2026-09-27T13:00:00Z', basisHash: 'a'.repeat(64), currency: 'USD', fractionDigits: 2,
    jurisdiction: 'Synthetic jurisdiction', location: 'Synthetic location', fulfillment: 'Pickup', applicabilityNotes: ['This fixture is an illustration, not a tax determination.'], visitorAssumption: 'For illustration, use 5%.',
    rounding: 'Round each line tax half up to the currency minor unit, then sum the rounded taxes.',
    lines: [
      { recordId: 'book', fieldId: 'hardcover', taxability: 'taxable', classification: 'Illustrative product', taxabilityNotes: 'Taxability is a test assumption.', ratePercent: '5', taxMinor: 240, tax: '2.40', evidence: [] },
      { recordId: 'service', fieldId: 'consultation', taxability: 'taxable', classification: 'Illustrative service', taxabilityNotes: 'Taxability is a test assumption.', ratePercent: '5', taxMinor: 400, tax: '4.00', evidence: [] },
    ],
    estimatedTaxMinor: 640, estimatedTax: '6.40', estimatedTotalMinor: 13440, estimatedTotal: '134.40', missing: [], notes: [],
  },
});

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, route => route.abort('blockedbyclient'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

const v1Catalog = validateCatalog(JSON.parse(readFileSync(new URL('../../fixtures/catalogs/classes.json', import.meta.url), 'utf8')));
v1Catalog.attributes.push({ id: 'conditions', label: 'Conditions and additional registration requirements', type: 'text' });
v1Catalog.entities[0].name = 'Introduction to handbuilding and extended studio practice';
v1Catalog.entities[0].attributes.conditions = 'Materials are charged separately. Placement is not guaranteed. Reference-' + 'ABCD'.repeat(24);
v1Catalog.entities[1].attributes.conditions = 'Prior introductory experience is required; confirm the applicable fee before registering.';
const v1Entities = v1Catalog.entities.slice(0, 2);
const v1Plan = comparisonPlan(v1Catalog, v1Entities.map(entity => entity.id));

for (const mode of ['bare', 'catalog'] as const) for (const width of [320, 390, 1440]) {
  test(`v1 comparison follows its own width in ${mode} mode at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 852 });
    const content = mode === 'bare'
      ? createElement(PresentationView, { catalog: v1Catalog, plan: v1Plan, state: initialInteraction(v1Catalog) })
      : createElement(CatalogExplorer, { catalog: v1Catalog, plan: v1Plan, showComposer: false });
    await show(page, content);
    const comparison = page.getByRole('region', { name: 'Compare published attributes' });
    const cards = comparison.locator('.platform-comparison-mobile'), table = comparison.locator('.platform-comparison-table');
    const compact = width < 600;
    await expect(compact ? cards : table).toBeVisible();
    await expect(compact ? table : cards).toBeHidden();
    for (const entity of v1Entities) {
      const visible = compact ? cards.locator(`article[data-entity-id="${entity.id}"]`) : table;
      await expect(visible.getByRole('button', { name: entity.name, exact: true })).toBeVisible();
      await expect(visible).toContainText(String(entity.attributes.conditions));
      const control = visible.getByRole('button', { name: entity.name, exact: true });
      await control.focus(); await expect(control).toBeFocused();
      expect(await control.evaluate(node => node.closest('.platform-comparison-mobile') !== null)).toBe(compact);
    }
    expect(await comparison.evaluate(node => [...node.querySelectorAll('h4, dt, dd')]
      .filter(element => element.getClientRects().length > 0)
      .every(element => element.scrollWidth <= element.clientWidth + 1))).toBe(true);
    expect(await fitsViewport(page)).toBe(true);
    if (mode === 'bare') await page.screenshot({ path: testInfo.outputPath(`v1-${width}.png`), fullPage: true });
  });
}

test('v1 comparison uses compact records in a narrow desktop panel and restores its table on expansion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await show(page, createElement('div', { id: 'comparison-panel', style: { width: 390 } },
    createElement(PresentationView, { catalog: v1Catalog, plan: v1Plan, state: initialInteraction(v1Catalog) })));
  const cards = page.locator('.platform-comparison-mobile'), table = page.locator('.platform-comparison-table');
  await expect(cards).toBeVisible(); await expect(table).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(cards).toBeVisible();
  await page.locator('#comparison-panel').evaluate(node => { node.style.width = '1000px'; });
  await expect(table).toBeVisible(); await expect(cards).toBeHidden();
  for (const entity of v1Entities) await expect(table).toContainText(String(entity.attributes.conditions));
  await page.locator('#comparison-panel').evaluate(node => { node.style.width = '390px'; });
  await expect(cards).toBeVisible(); await expect(table).toBeHidden();
  expect(await fitsViewport(page)).toBe(true);
});

for (const width of [320, 390, 1440]) test(`v1 comparison keeps labeled missing values accessible at ${width}px`, async ({ page }, testInfo) => {
  const catalog = comparisonMissingnessCatalog;
  await page.setViewportSize({ width, height: 852 });
  await show(page, createElement(PresentationView, { catalog, plan: comparisonPlan(catalog, catalog.entities.map(entity => entity.id)), state: initialInteraction(catalog) }));
  const comparison = page.getByRole('region', { name: 'Compare published attributes' });
  const compact = width < 600, cards = comparison.locator('.platform-comparison-mobile'), table = comparison.locator('.platform-comparison-table');
  await expect(compact ? cards : table).toBeVisible();
  await expect(compact ? table : cards).toBeHidden();
  if (compact) {
    for (const id of ['missing', 'omitted']) {
      const card = cards.locator(`article[data-entity-id="${id}"]`);
      for (const label of ['Material', 'Listed price', 'Machine washable', 'Additional fringe', 'Source qualifications']) {
        await expect(card.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')).toHaveText('Not specified');
      }
      await expect(card).not.toContainText('100% wool');
    }
    await expect(cards.locator('article[data-entity-id="stated"]')).toContainText('100% wool');
  } else {
    await expect(table.getByRole('columnheader', { name: /Rug with missing details/ })).toBeVisible();
    for (const label of ['Material', 'Listed price', 'Machine washable', 'Additional fringe', 'Source qualifications']) {
      const row = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) });
      await expect(row.getByRole('cell')).toHaveText([label === 'Material' ? '100% wool' : label === 'Listed price' ? '$0.00' : label === 'Machine washable' ? 'No' : label === 'Additional fringe' ? '0 cm' : String(catalog.entities[0].attributes.terms), 'Not specified', 'Not specified']);
    }
  }
  for (const entity of catalog.entities) {
    const control = (compact ? cards : table).getByRole('button', { name: entity.name, exact: true });
    await control.focus(); await expect(control).toBeFocused();
  }
  await expect(comparison).not.toContainText('Live inventory');
  await expect(comparison).not.toContainText('Unspecified for every item');
  expect(await fitsViewport(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`v1-missingness-${width}.png`), fullPage: true });
});

for (const width of [320, 375, 393, 430]) {
  test(`mobile comparisons align both values by attribute without losing detail at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 852 });
    for (const sample of comparisons) {
      await show(page, createElement(TaskComparison, { comparison: comparisonFixture(sample) }));
      const table = page.getByRole('table', { name: 'Compare two items by attribute' });
      await expect(table).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(1);
      for (const name of sample.names) await expect(table.getByRole('columnheader', { name, exact: true })).toBeVisible();
      const rows = await table.locator('tbody').evaluateAll(groups => groups.map(group => {
        const cells = [...group.querySelectorAll('td')];
        return { top: cells.map(cell => cell.getBoundingClientRect().y), headers: cells.map(cell => cell.headers.split(' ').map(id => document.getElementById(id)?.textContent)), text: cells.map(cell => cell.textContent) };
      }));
      rows.forEach((row, index) => {
        expect(Math.abs(row.top[0] - row.top[1]), `${sample.domain}: ${sample.fields[index]} values must align`).toBeLessThan(1);
        expect(row.headers).toEqual(sample.names.map(name => [name, sample.fields[index]]));
        expect(row.text).toEqual(sample.values.map(values => values[index] === 'unknown' ? 'Not specified' : values[index]));
      });
      expect(await fitsViewport(page), sample.domain).toBe(true);
      if (width === 393 && sample.domain === 'freelancer') await page.screenshot({ path: testInfo.outputPath('mobile-comparison.png') });
    }
  });

  test(`mobile estimate keeps amounts beside labels and preserves usable disclosures at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 852 });
    await show(page, createElement(PublishedEstimateView, { estimate }));
    const totals = page.getByRole('complementary', { name: 'Estimate totals' });
    const positions = await totals.locator(':scope > dl > div').evaluateAll(rows => rows.map(row => {
      const label = row.querySelector('dt')!.getBoundingClientRect(), amount = row.querySelector('dd')!.getBoundingClientRect();
      return { labelY: label.y, amountY: amount.y, labelRight: label.right, amountLeft: amount.left };
    }));
    for (const row of positions) { expect(Math.abs(row.labelY - row.amountY)).toBeLessThan(4); expect(row.amountLeft).toBeGreaterThan(row.labelRight); }
    const itemPositions = await page.locator('.platform-estimate-item-heading').evaluateAll(rows => rows.map(row => {
      const name = row.querySelector('h3')!.getBoundingClientRect(), amount = row.querySelector('p')!.getBoundingClientRect();
      return { nameY: name.y, amountY: amount.y, nameRight: name.right, amountLeft: amount.left };
    }));
    for (const row of itemPositions) { expect(Math.abs(row.nameY - row.amountY)).toBeLessThan(5); expect(row.amountLeft).toBeGreaterThan(row.nameRight); }
    await expect(totals).toContainText('USD 134.40');
    await expect(totals.getByText('Hypothetical tax estimate', { exact: true })).toBeVisible();
    await expect(page.locator('.platform-estimate button, .platform-estimate input, .platform-estimate select')).toHaveCount(0);
    if (width === 393) await page.screenshot({ path: testInfo.outputPath('mobile-estimate.png') });
    const prices = page.locator('summary').filter({ hasText: 'Price details' }).first();
    expect((await prices.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await prices.focus(); await prices.press('Enter');
    await expect(page.getByText('Gift wrapping is quoted separately.', { exact: true })).toBeVisible();
    const assumptions = page.locator('summary').filter({ hasText: 'Tax assumptions & sources' });
    expect((await assumptions.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await assumptions.focus(); await assumptions.press('Enter');
    await expect(page.getByText('For illustration, use 5%.', { exact: true })).toBeVisible();
    await expect(page.getByText('This fixture is an illustration, not a tax determination.', { exact: true })).toBeVisible();
    expect(await assumptions.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe('none');
    expect(await fitsViewport(page)).toBe(true);
  });
}

test('large comparison text and amounts reflow at 320px without hiding qualifications', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 852 });
  const sample = comparisons[1];
  await show(page, createElement(Fragment, null, createElement(TaskComparison, { comparison: comparisonFixture(sample) }), createElement(PublishedEstimateView, { estimate: { ...estimate, formattedSubtotal: 'USD 123,456,789.00', tax: undefined, lines: [{ ...estimate.lines[0], lineTotal: '123456789.00' }] } })));
  await page.addStyleTag({ content: 'body { font-size: 20px; } .platform-task-comparison :is(th, td) { font-size: 20px; } .platform-estimate[data-estimate-revision] :is(h3, dt, dd, .platform-estimate-line-total) { font-size: 20px; }' });
  await expect(page.getByRole('cell', { name: 'Materials are charged separately.', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Not specified', exact: true })).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);
});

test('rich answer tables scroll locally while normal content stays readable on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 852 });
  await show(page, createElement(RichAnswer, { text: '## Workshop options\n\nChoose the session that matches your goals.\n\n| Session | Preparation | Follow-up | Price |\n| --- | --- | --- | ---: |\n| Illustration fundamentals | Bring a sketchbook | Written recommendations | USD 120 |\n| Portfolio development | Bring five examples | One revision included | USD 180 |\n\nAll materials listed in the published terms remain included.' }));
  const table = page.getByRole('region', { name: 'Answer table' });
  await expect(table).toBeVisible(); await table.focus();
  expect(await table.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe('none');
  expect(await table.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  await table.press('ArrowRight');
  await expect.poll(() => table.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  await expect(page.getByText('All materials listed in the published terms remain included.')).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);
});

test('phone media uses paired image tiles and a proportional video without a forced tall blank area', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 852 });
  const result: ExternalSearchResult = { id: 'synthetic-images', kind: 'images', query: 'Bookbinding examples', fetchedAt: '2026-09-27T12:00:00Z', demo: true, answer: '', sources: [], citations: [], map: null, images: [1, 2, 3].map(index => ({ id: `image-${index}`, url: `https://example.com/image-${index}.jpg`, thumbnail: `https://example.com/image-${index}.jpg`, sourceUrl: 'https://example.com/gallery', caption: `Illustrative binding ${index}` })) };
  const gallery = createElement(AnimatePresence, { initial: false }, createElement(ExternalSearchResults, { result, kind: 'images', selected: null, onCommand: () => {}, onInteraction: () => {}, showViewer: false, surface: true }));
  const video = createElement(MediaProvider, { library: { schemaVersion: 1, id: 'demo-media', assets: [], albums: [], associations: [], videos: [{ id: 'binding-video', title: 'Binding demonstration', description: 'Illustrative video description.', source: { kind: 'youtube', videoId: 'ABCDEFGHIJK' }, autoplay: false }] }, resolveAssetUrl: () => '' }, createElement(MediaVideo, { videoId: 'binding-video' }));
  await show(page, createElement(Fragment, null, gallery, video));
  const tiles = page.getByRole('group', { name: 'Web images' }).getByRole('button');
  const first = (await tiles.nth(0).boundingBox())!, second = (await tiles.nth(1).boundingBox())!, third = (await tiles.nth(2).boundingBox())!;
  expect(Math.abs(first.y - second.y)).toBeLessThan(1); expect(third.y).toBeGreaterThan(first.y + first.height); expect(second.x).toBeGreaterThan(first.x + first.width);
  expect(first.width).toBeGreaterThanOrEqual(44); expect(first.height).toBeGreaterThanOrEqual(44);
  const play = page.getByRole('button', { name: 'Play Binding demonstration' }), player = (await play.boundingBox())!;
  expect(player.width / player.height).toBeCloseTo(16 / 9, 1);
  await expect(page.getByText('Illustrative video description.', { exact: true })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(await fitsViewport(page)).toBe(true);
});
