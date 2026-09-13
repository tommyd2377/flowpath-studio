import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { retrieveKnowledge, projectKnowledgeCatalog, selectFactValue } from '@thevoice/platform-ui/knowledge';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { semanticFixture, semanticMediaFixture } from '../fixtures/semantic-knowledge/graph';
import { catalogPresentationContext } from '../lib/catalog-presentation';
import { initialInteraction } from '@thevoice/platform-ui/interaction';
import { interpretSourceWithProvenance } from '../lib/source-extractors';

const expected = JSON.parse(await readFile(new URL('../fixtures/semantic-knowledge/expected.json', import.meta.url), 'utf8'));
const request = { revisionId: semanticFixture.id, asOf: '2026-09-12', expansion: 0 as const };

test('handoff example 1: one business supports independent address, email and unknown map questions', () => {
  for (const [query, key] of [['address', 'address'], ['email', 'email']] as const) {
    const result = retrieveKnowledge(semanticFixture, { ...request, query, entityIds: ['harbor'] });
    assert.equal(result.values.find(value => value.field === `properties.${key}`)?.value, expected.answers[key]);
    assert.equal(result.revisionId, semanticFixture.id);
  }
  const result = retrieveKnowledge(semanticFixture, { ...request, factIds: ['latitude', 'longitude'] });
  assert.equal(result.values.find(value => value.field === 'properties.latitude')?.value, expected.answers.mapLatitude);
  assert.equal(result.values.find(value => value.field === 'properties.longitude')?.status, 'unknown');
  assert.deepEqual(result.entities.map(entity => entity.id), ['harbor']);
  assert.deepEqual(semanticFixture.capabilities, []);
});

test('handoff example 2: compare class prices as of a date without hiding policy exceptions', () => {
  const september = retrieveKnowledge(semanticFixture, { ...request, query: 'price', entityIds: ['clay', 'summer'] });
  const october = retrieveKnowledge(semanticFixture, { ...request, query: 'price', asOf: '2026-10-15', entityIds: ['clay', 'summer'] });
  assert.equal(september.values.find(value => value.entityId === 'clay' && value.field === 'attributes.price')?.value, expected.answers.septemberPrice);
  assert.equal(october.values.find(value => value.entityId === 'clay' && value.field === 'attributes.price')?.value, expected.answers.octoberPrice);
  assert.equal(october.values.find(value => value.entityId === 'summer' && value.field === 'attributes.price')?.value, expected.answers.unannouncedPrice);
  assert.equal(october.values.find(value => value.field === 'properties.children-allowed')?.status, 'qualified');
  assert.equal(october.facts.find(fact => fact.id === 'child-policy')?.qualifiers?.[1].value, expected.answers.childCondition);
  assert.equal(october.values.find(value => value.field === 'properties.requires-own-kiln')?.value, expected.answers.requiresOwnKiln);
  assert.equal(projectKnowledgeCatalog(semanticFixture, '2026-10-15').entities.find(entity => entity.id === 'clay')?.attributes.price, 50);
  const filtered = retrieveKnowledge(semanticFixture, { ...request, asOf: '2026-10-15', filters: [{ attributeId: 'price', operator: 'lte', value: 49 }] });
  assert.ok(!filtered.entities.some(entity => ['clay', 'summer'].includes(entity.id)));
});

test('handoff example 3: a reviewed photo retrieves its subject and related location, not lookalikes', () => {
  const result = retrieveKnowledge(semanticFixture, { ...request, intent: 'photos', assetIds: ['blue-photo'], expansion: 1 }, semanticMediaFixture);
  assert.deepEqual(result.media?.associations.map(link => link.targetId), [expected.answers.photoEntity]);
  assert.ok(result.entities.some(entity => entity.id === expected.answers.photoLocationEntity));
  assert.ok(!result.entities.some(entity => entity.id === 'white'));
  assert.equal(result.values.find(value => value.field === 'properties.address')?.value, expected.answers.address);
  const affiliation = retrieveKnowledge(semanticFixture, { ...request, query: 'Mira', expansion: 1 }).relationships.find(relation => relation.id === 'affiliation');
  assert.deepEqual([affiliation?.fromEntityId, affiliation?.toEntityId], expected.answers.affiliationDirection);
});

test('conflicting approved assertions, false/unknown values, actual dates and validity endpoints remain distinct', () => {
  const conflict = structuredClone(semanticFixture);
  conflict.facts!.push({ id: 'conflicting-price', entityId: 'clay', field: 'attributes.price', value: 55, validFrom: '2026-09-01' });
  const result = retrieveKnowledge(conflict, { ...request, entityIds: ['clay'] });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.values.find(value => value.field === 'attributes.price')?.status, 'conflict');
  assert.equal(result.entities[0].attributes.price, null);
  assert.equal(selectFactValue([semanticFixture.facts![4]], '2026-09-30T23:59:59Z').value, 45);
  assert.equal(selectFactValue([semanticFixture.facts![4]], '2026-10-01').status, 'out-of-time');
  assert.throws(() => retrieveKnowledge(semanticFixture, { ...request, asOf: '2026-02-30' }));
  assert.throws(() => validateCatalog({ ...semanticFixture, facts: [{ ...semanticFixture.facts![0], validFrom: '2026-02-30' }] }));
  assert.throws(() => validateCatalog({ ...semanticFixture, facts: [{ ...semanticFixture.facts![0], definition: undefined }] }));
});

test('retrieval bounds references, expansion, payloads and actual visitor planner context', () => {
  const many = structuredClone(semanticFixture);
  many.entities = Array.from({ length: 100 }, (_, index) => ({ id: `item-${index}`, kind: 'item', name: `Offering ${index}`, summary: '', attributes: { price: index } }));
  many.facts = []; many.relationships = []; many.collections = [];
  const result = retrieveKnowledge(many, { ...request, query: 'Offering', expansion: 2 });
  assert.equal(result.entities.length, 12); assert.equal(result.omitted.entities, 88);
  const context = catalogPresentationContext(many, initialInteraction(many), undefined, 'Offering 99');
  assert.ok(context.entities.some(entity => entity.id === 'item-99'));
  assert.ok(context.entities.length <= 12); assert.ok(context.knowledge.omitted.entities > 0);
  assert.throws(() => retrieveKnowledge(many, { ...request, revisionId: 'old' }), /revision/);
  assert.equal(retrieveKnowledge(many, { ...request, entityIds: ['private-draft-id'] }).status, 'unresolved');
  assert.equal(retrieveKnowledge(many, { ...request, query: 'unpublished submarine' }).status, 'unresolved');
  assert.throws(() => retrieveKnowledge(many, { ...request, expansion: 3 }));
  const original = JSON.stringify(semanticFixture);
  retrieveKnowledge(semanticFixture, { ...request, query: 'location' }, semanticMediaFixture);
  assert.equal(JSON.stringify(semanticFixture), original, 'retrieval never mutates a publication');
});

test('cross-format corpus supports singleton table fields with exact independent source locations offline', async () => {
  const business = await readFile(new URL('../fixtures/semantic-knowledge/business.txt', import.meta.url), 'utf8');
  const classes = await readFile(new URL('../fixtures/semantic-knowledge/classes.csv', import.meta.url), 'utf8');
  const items = await readFile(new URL('../fixtures/semantic-knowledge/items.csv', import.meta.url), 'utf8');
  const parsedBusiness = interpretSourceWithProvenance('business.txt', { format: 'text', text: business })!;
  const result = retrieveKnowledge(parsedBusiness.catalog, { revisionId: parsedBusiness.catalog.id, query: 'email' });
  assert.equal(result.values.find(value => value.field === 'attributes.email')?.value, expected.answers.email);
  assert.equal(parsedBusiness.provenance.anchors[0].lineStart, expected.provenance.businessAddressLine);
  const parsedClasses = interpretSourceWithProvenance('classes.csv', { format: 'csv', text: classes })!;
  const reference = parsedClasses.provenance.fields.find(field => field.entityId === 'clay' && field.field === expected.provenance.classPriceField)!;
  assert.equal(parsedClasses.provenance.anchors.find(anchor => anchor.id === reference.anchorIds[0])?.row, expected.provenance.classPriceRow);
  assert.equal(interpretSourceWithProvenance('items.csv', { format: 'csv', text: items })!.catalog.entities.length, 2);
  assert.equal(expected.modelQuality.startsWith('Not measured.'), true);
});

test('legacy fact references cannot collide with explicit assertion IDs in the same publication', () => {
  const catalog = structuredClone(semanticFixture);
  catalog.facts![0].id = 'legacy-3-0';
  const result = retrieveKnowledge(catalog, { ...request, entityIds: ['harbor', 'glaze'] });
  assert.equal(new Set(result.facts.map(fact => fact.id)).size, result.facts.length);
  assert.equal(result.facts.find(fact => fact.entityId === 'glaze')?.id, 'legacy-3-0-1');
});
