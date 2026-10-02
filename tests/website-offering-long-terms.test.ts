import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { adaptV1Catalog } from '@thevoice/platform-ui/collection-space';
import { extractWebsitePage, websitePageCatalog } from '../lib/website-import';
import { addWebsiteOfferings, websiteOfferings } from '../lib/website-structure';
import { bindWebsiteOfferingProvenance } from '../lib/website-offering-provenance';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { websiteCatalogEntry } from '../lib/website-catalog';

const url = 'https://shop.example/coffee';
const description = 'Roasted coffee in a one-pound bag. '.repeat(35).trim();
const conditions = 'Free ground shipping applies to coffee-only orders, minimum four bags. Cannot combine with other products. Select an option for availability.';
const reader = (entity: ReturnType<typeof websiteOfferings>['entities'][number]) => entity.blocks?.map(block => block.text).join('') ?? '';
const source = () => extractWebsitePage(`<main><h1>Special Blend Coffee</h1><p>$16.98</p><p>${description}</p><h2>Shipping and availability</h2><p>${conditions}</p></main><footer><p>Newsletter bonus: $5 off.</p></footer>`, url);

test('long adjacent-price descriptions preserve complete conditions in validated item reading blocks', () => {
  const page = source();
  const extracted = websiteOfferings([page], { strict: true });
  const entity = extracted.entities[0];
  assert.equal(extracted.entities.length, 1);
  assert.equal(entity.attributes.source_price_unknown, '$16.98');
  assert.equal(extracted.attributes.some(field => field.type === 'money'), false);
  assert.match(String(entity.attributes.source_price_terms), /Price and conditions require review.*complete source terms.*item details/);
  assert.match(entity.summary, /availability is not verified/);
  assert.equal(reader(entity), `Special Blend Coffee $16.98 ${description} ## Shipping and availability ${conditions}`);
  assert.doesNotMatch(reader(entity), /Newsletter/);
  const catalog = addWebsiteOfferings(websitePageCatalog([page]), [page], { strict: true }).catalog;
  assert.deepEqual(validateCatalog(catalog), catalog);
  const bound = bindWebsiteOfferingProvenance(catalog, { anchors: [], fields: [] }, [page], extracted);
  const terms = bound.fields.find(field => field.entityId === entity.id && field.field === 'attributes.source_price_terms')!;
  const exact = terms.anchorIds.map(id => bound.anchors.find(anchor => anchor.id === id)!.excerpt).join('');
  assert.ok(exact.endsWith(conditions));
  for (const anchor of bound.anchors) assert.equal(page.text.slice(anchor.characterStart, anchor.characterEnd), anchor.excerpt);
});

test('long heading and inherited prices preserve their complete qualifications and explicit currency', () => {
  for (const text of [
    `# Menu\n## Coffee — CAD $17 per bag\n${description}\n${conditions}`,
    `# Menu\nPrices in CAD.\n## One-pound bags — $17 each\n### Coffee\n${description}\n${conditions}`,
  ]) {
    const extracted = websiteOfferings([{ url, text }], { strict: true });
    assert.equal(extracted.entities.length, 1);
    assert.equal(extracted.entities[0].attributes.source_price_cad, 17);
    assert.ok(reader(extracted.entities[0]).endsWith(conditions + (text.includes('Prices in CAD.') ? ' Prices in CAD.' : '')));
    assert.ok(reader(extracted.entities[0]).includes(description));
    assert.match(String(extracted.entities[0].attributes.source_price_terms), /complete source terms/);
  }
});

test('normal publication and website detail projections retain all long source terms and the warning', () => {
  const page = source();
  const catalog = addWebsiteOfferings(websitePageCatalog([page]), [page], { strict: true }).catalog;
  const original = catalog.entities.find(entity => entity.kind === 'offering')!;
  const { space } = adaptV1Catalog(catalog, { siteId: 'local-test', revisionId: 'test-revision', indexRevision: 'test-index' });
  const index = compileQueryIndex(space), record = index.records.get(original.id)!;
  const entry = websiteCatalogEntry(record, index, { detail: true });
  assert.equal(entry.blocks?.map(block => block.text).join(''), reader(original));
  assert.ok(entry.blocks?.at(-1)?.text.endsWith(conditions));
  assert.ok(entry.values?.some(value => /Price and conditions require review.*complete source terms.*item details/.test(value.text)));
  assert.ok(websiteCatalogEntry(record, index).values?.some(value => /complete source terms/.test(value.text)), 'the compact card also exposes the conditions warning');
});

test('strict reconciliation cannot accept or name-merge an offering that drops its long conditions', () => {
  const page = source();
  const catalog = addWebsiteOfferings(websitePageCatalog([page]), [page], { strict: true }).catalog;
  const original = catalog.entities.find(entity => entity.kind === 'offering')!;
  for (const blocks of [undefined, [{ id: 'block-0', kind: 'paragraph' as const, text: description }]]) {
    const altered = structuredClone(catalog), entity = altered.entities.find(entity => entity.id === original.id)!;
    entity.blocks = blocks;
    assert.throws(() => addWebsiteOfferings(altered, [page], { strict: true }), /reserved source offering ID/);
    entity.id = 'provider-copy';
    altered.collections = altered.collections.map(group => ({ ...group, entityIds: group.entityIds.map(id => id === original.id ? entity.id : id) }));
    const restored = addWebsiteOfferings(altered, [page], { strict: true }).catalog.entities.find(entity => entity.id === original.id)!;
    assert.equal(reader(restored), reader(original));
  }
  assert.deepEqual(addWebsiteOfferings(catalog, [page], { strict: true }).catalog, catalog);
});

test('changed or missing long terms cannot inherit parser price-condition evidence', () => {
  const page = source(), extracted = websiteOfferings([page], { strict: true });
  const catalog = addWebsiteOfferings(websitePageCatalog([page]), [page], { strict: true }).catalog;
  const bound = bindWebsiteOfferingProvenance(catalog, { anchors: [], fields: [] }, [page], extracted);
  for (const blocks of [undefined, [{ id: 'block-0', kind: 'paragraph' as const, text: description }]]) {
    const changed = structuredClone(catalog), entity = changed.entities.find(entity => entity.kind === 'offering')!;
    entity.blocks = blocks;
    const result = bindWebsiteOfferingProvenance(changed, bound, [page], extracted);
    assert.ok(!result.fields.some(field => field.entityId === entity.id && field.field === 'attributes.source_price_terms'));
    assert.ok(result.fields.some(field => field.entityId === entity.id && field.field === 'attributes.source_price_unknown'));
  }
});

test('oversized reader content still fails explicitly rather than keeping a partial offering', () => {
  assert.throws(() => websiteOfferings([{ url, text: '# Coffee\n$17\n' + 'x'.repeat(24 * 8000) }], { strict: true }), /24 reading blocks.*no partial text/);
});
