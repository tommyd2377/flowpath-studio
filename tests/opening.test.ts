import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { sampleContent } from '../lib/site-model';
import { DEFAULT_OPENING, openingPresentation, validateOpening } from '../lib/site-opening';

test('opening references compose shared components and cannot invent links', () => {
  const catalog = validateCatalog(JSON.parse(readFileSync(new URL('../fixtures/catalogs/classes.json', import.meta.url), 'utf8')));
  const content = { ...sampleContent('photographer'), opening: { ...DEFAULT_OPENING, highlights: ['Explore at your own pace'], featuredEntityIds: [catalog.entities[0].id] } };
  validateOpening(content, catalog);
  const plan = openingPresentation(content, catalog);
  assert.deepEqual(plan.components.find(component => component.type === 'collection')?.entityIds, content.opening.featuredEntityIds);
  assert.throws(() => validateOpening({ ...content, opening: { ...content.opening, capabilityIds: ['invented-checkout'] } }, catalog));
  assert.throws(() => validateOpening(content, null));
  assert.deepEqual(openingPresentation(content, { ...catalog, entities: catalog.entities.slice(1), collections: [], relationships: [] }).components[0].entityIds, []);
});
