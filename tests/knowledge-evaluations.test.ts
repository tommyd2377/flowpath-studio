import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { CatalogEntity, CatalogFilter, CatalogValue, KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { filterEntities } from '@thevoice/platform-ui/catalog';
import { comparisonPlan, detailPlan } from '@thevoice/platform-ui/interaction';
import { entityKey, mergeKnowledge } from '../lib/knowledge-model';
import { interpretSourceWithProvenance, unlinkedSourceProvenance } from '../lib/source-extractors';

type Fact = { entityId: string; field: string; value: CatalogValue };
type EvaluationPack = {
  schemaVersion: 1;
  structured: { before: Fact[]; after: Fact[]; missingIds: string[]; addedIds: string[] };
  corrections: { entityId: string; field: string; publisherValue: CatalogValue; expectedMergedValue: CatalogValue }[];
  journeys: { id: string; source: 'before' | 'after'; question: string; filters: CatalogFilter[]; expectedIds: string[]; compare?: boolean }[];
  proseEvaluation: { status: 'reference-only-not-model-tested'; facts: string[]; relationships: { from: string; relation: string; to: string }[]; unknowns: string[]; forbiddenInferences: string[] };
};

async function loadPack(id: string) {
  const directory = new URL(`../fixtures/evaluation-packs/${id}/`, import.meta.url);
  const [before, after, prose, expected] = await Promise.all(['before.csv', 'after.csv', 'prose.txt', 'expected.json'].map(name => readFile(new URL(name, directory), 'utf8')));
  return { before, after, prose, expected: JSON.parse(expected) as EvaluationPack };
}

function fieldValue(entity: CatalogEntity, field: string) {
  return field.startsWith('attributes.') ? entity.attributes[field.slice(11)] : entity[field as 'name' | 'kind' | 'summary'];
}

function assertFacts(catalog: KnowledgeCatalog, facts: Fact[]) {
  for (const fact of facts) {
    const entity = catalog.entities.find(entity => entity.id === fact.entityId);
    assert.ok(entity, fact.entityId);
    assert.equal(fieldValue(entity, fact.field), fact.value, `${fact.entityId}.${fact.field}`);
  }
}

for (const packId of ['tequila', 'books', 'classes']) {
  test(`${packId} evaluation: imperfect imports preserve reviewed corrections and expose missing rows`, async () => {
    const pack = await loadPack(packId); const name = `${packId}.csv`;
    const before = interpretSourceWithProvenance(name, { format: 'csv', text: pack.before })!;
    const after = interpretSourceWithProvenance(name, { format: 'csv', text: pack.after })!;
    assertFacts(before.catalog, pack.expected.structured.before);
    assertFacts(after.catalog, pack.expected.structured.after);
    assert.deepEqual(before.catalog.relationships, [], 'Prose reference relationships are not local CSV extraction results.');
    const initial = mergeKnowledge(null, before.catalog, { fileId: randomUUID(), name, hash: 'before', provenance: before.provenance });
    for (const correction of pack.expected.corrections) {
      const entity = initial.catalog.entities.find(entity => entity.id === entityKey(name, correction.entityId))!;
      if (correction.field.startsWith('attributes.')) entity.attributes[correction.field.slice(11)] = correction.publisherValue;
      else {
        assert.equal(typeof correction.publisherValue, 'string');
        entity[correction.field as 'name' | 'kind' | 'summary'] = correction.publisherValue as string;
      }
    }
    const merged = mergeKnowledge(initial, after.catalog, { fileId: randomUUID(), name, hash: 'after', provenance: after.provenance });
    for (const correction of pack.expected.corrections) {
      const entity = merged.catalog.entities.find(entity => entity.id === entityKey(name, correction.entityId))!;
      assert.equal(fieldValue(entity, correction.field), correction.expectedMergedValue);
      const update = merged.updates?.find(update => update.entityId === entity.id && update.field === correction.field);
      assert.equal(update?.kind, 'conflict');
      assert.equal(update?.defaultChoice, 'keep');
      assert.ok(merged.updateAnchors?.find(anchor => anchor.id === update?.previousSource?.anchorId)?.excerpt);
      assert.ok(merged.updateAnchors?.find(anchor => anchor.id === update?.incomingSource?.anchorId)?.excerpt);
    }
    for (const id of pack.expected.structured.missingIds) {
      assert.ok(merged.catalog.entities.some(entity => entity.id === entityKey(name, id)), 'Missing means review, not automatic removal.');
      assert.ok(merged.updates?.some(update => update.kind === 'missing' && update.entityId === entityKey(name, id)));
    }
    for (const id of pack.expected.structured.addedIds) assert.ok(merged.catalog.entities.some(entity => entity.id === entityKey(name, id)));
    assert.deepEqual(merged.catalog.capabilities, [], 'Documents do not create live actions.');
  });

  test(`${packId} evaluation: typed visitor criteria exclude unknowns and retain comparison identity`, async () => {
    const pack = await loadPack(packId);
    for (const journey of pack.expected.journeys) {
      const { catalog } = interpretSourceWithProvenance(`${packId}.csv`, { format: 'csv', text: pack[journey.source] })!;
      const candidates = filterEntities(catalog, journey.filters);
      assert.deepEqual(candidates.map(entity => entity.id), journey.expectedIds, journey.question);
      const plan = journey.compare ? comparisonPlan(catalog, journey.expectedIds) : detailPlan(catalog, journey.expectedIds[0]);
      const component = plan.components.find(component => component.type === (journey.compare ? 'comparison' : 'detail'))!;
      assert.deepEqual(component.entityIds, journey.compare ? journey.expectedIds : [journey.expectedIds[0]]);
      assert.ok(component.attributeIds.every(id => catalog.attributes.some(attribute => attribute.id === id)));
      assert.ok(!plan.components.some(component => component.type === 'actions'));
    }
  });

  test(`${packId} evaluation: realistic prose remains unlinked and model expectations remain explicitly unrun`, async () => {
    const { prose, expected } = await loadPack(packId);
    assert.equal(interpretSourceWithProvenance(`${packId}.txt`, { format: 'text', text: prose }), null);
    const provenance = unlinkedSourceProvenance({ format: 'text', text: prose });
    assert.ok(provenance.anchors.length > 0);
    assert.deepEqual(provenance.fields, []);
    for (const anchor of provenance.anchors) assert.ok(prose.includes(anchor.excerpt));
    assert.equal(expected.proseEvaluation.status, 'reference-only-not-model-tested');
    assert.ok(expected.proseEvaluation.facts.length && expected.proseEvaluation.relationships.length && expected.proseEvaluation.unknowns.length && expected.proseEvaluation.forbiddenInferences.length);
  });
}
