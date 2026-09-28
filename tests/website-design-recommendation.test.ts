import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendWebsiteDesign } from '../lib/website-design-recommendation';
import { designWebsite, extractWebsitePage } from '../lib/website-import';
import { applyWebsiteDesign } from '../lib/website-import-model';
import { sampleContent } from '../lib/site-model';
import { templateFixtures } from '../fixtures/template-sites';
import { WEBSITE_TEMPLATES } from '@thevoice/platform-ui/site-design';

test('a one-page menu and a one-page professional service recommend comparable offerings, independent of subject', () => {
  for (const fixture of templateFixtures.slice(0, 2)) {
    const catalog = { ...structuredClone(fixture.catalog), entities: fixture.catalog.entities.filter(entity => entity.kind !== 'project') };
    const before = structuredClone(catalog);
    assert.equal(recommendWebsiteDesign({ catalog, pageCount: 1, discoveredImageCount: 3 }).template, 'clarity');
    assert.deepEqual(catalog, before);
  }
});

test('project-led content and longer guides get different starting compositions with the same page count', () => {
  const portfolio = structuredClone(templateFixtures[1].catalog);
  assert.equal(recommendWebsiteDesign({ catalog: portfolio, pageCount: 3, discoveredImageCount: 3 }).template, 'showcase');
  assert.equal(recommendWebsiteDesign({ catalog: templateFixtures[2].catalog, pageCount: 3, discoveredImageCount: 0 }).template, 'editorial');
  assert.notEqual(recommendWebsiteDesign({ catalog: portfolio, pageCount: 3, discoveredImageCount: 0 }).template, 'showcase', 'no invented photographs to fill an image-led layout');
});

test('dense collections override a visual suggestion; source pages and duplicate membership do not masquerade as items', () => {
  const catalog = structuredClone(templateFixtures[1].catalog);
  catalog.entities = Array.from({ length: 16 }, (_, index) => ({ ...catalog.entities[0], id: `service-${index}` }));
  catalog.collections = [{ id: 'services', name: 'Services', entityIds: catalog.entities.map(entity => entity.id) }];
  assert.equal(recommendWebsiteDesign({ catalog, pageCount: 1, discoveredImageCount: 10 }).template, 'clarity');
  catalog.entities = [{ id: 'source', name: 'Captured page', kind: 'source_document', attributes: {}, summary: 'Private evidence' }];
  catalog.collections[0].entityIds = Array(30).fill('source');
  assert.equal(recommendWebsiteDesign({ catalog, pageCount: 1, discoveredImageCount: 10 }).template, 'editorial');
});

test('import recommendations retain factual identity and never replace a publisher-selected design', () => {
  const page = extractWebsitePage('<h1>A small studio</h1><p>Independent work with thoughtful details.</p>', 'https://studio.example');
  const catalog = templateFixtures[1].catalog;
  const proposal = designWebsite(page, 1, catalog, 3);
  assert.equal(proposal.style?.template, 'showcase');
  assert.equal(proposal.name, page.name); assert.equal(proposal.description, page.description);
  const draft = { ...sampleContent('general'), style: { ...WEBSITE_TEMPLATES.editorial.defaults, websiteMotion: 'off' as const, textSize: 'larger' as const, entry: 'assistant' as const } };
  const before = structuredClone(draft);
  const applied = applyWebsiteDesign(draft, proposal);
  assert.deepEqual(applied.style, draft.style);
  assert.deepEqual(draft, before);
  assert.equal(applyWebsiteDesign({ ...draft, style: undefined }, proposal).style?.template, 'showcase');
});
