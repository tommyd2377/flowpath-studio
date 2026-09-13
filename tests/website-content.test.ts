import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { mergeKnowledge } from '../lib/knowledge-model';
import { websiteVisitorCatalog, retireWebsiteSourceCopies } from '../lib/website-content';
import { parseSemanticProviderReply } from '../lib/ingestion';
import { validateSourceProvenance } from '../lib/source-provenance';

const sourceName = 'Website example.com/';
const source = { anchors: [{ id: 'anchor', format: 'html' as const, label: 'Main content', lineStart: 1, lineEnd: 2, excerpt: 'Our story and services. Contact us to learn more.' }], fields: [] };
function response(kind = 'service') {
  return { complete: true, issues: [], name: 'Example business', description: 'Independent work, carefully done.', attributes: [],
    entities: [
      { id: 'story', kind: 'article', name: 'Our story', summary: 'Independent work.', attributes: [], blocks: [{ id: 'body', kind: 'paragraph', text: 'Our complete story, including the important final qualification.' }] },
      { id: 'offering', kind, name: 'Consultation', summary: 'An introductory consultation.', attributes: [] },
      { id: 'raw', kind: 'page', name: 'Home', summary: 'Copied home page and navigation.', attributes: [] },
      { id: 'source', kind: 'source_document', name: 'Website source', summary: 'Crawl bookkeeping.', attributes: [] },
    ],
    collections: [{ id: 'parent', name: 'Explore', entityIds: [] }, { id: 'content', name: 'What we do', entityIds: ['story', 'offering'], parentIds: ['parent'] }, { id: 'pages', name: 'Source pages', entityIds: ['raw', 'source'] }],
    relationships: [{ id: 'useful', fromEntityId: 'story', toEntityId: 'offering', label: 'Describes' }, { id: 'source-link', fromEntityId: 'source', toEntityId: 'raw', label: 'Captured' }],
    facts: [{ id: 'source-fact', entityId: 'raw', target: { field: 'summary', value: 'Copied text' } }],
    evidence: [{ entityId: 'story', field: 'summary', anchorIds: ['anchor'] }, { entityId: 'raw', field: 'summary', anchorIds: ['anchor'] }, { factId: 'source-fact', anchorIds: ['anchor'] }, { relationshipId: 'source-link', anchorIds: ['anchor'] }], jobs: [] };
}

test('mocked website interpretation retains useful content and filters source records with all graph/evidence references', () => {
  for (const kind of ['service', 'product', 'place', 'class']) {
    const parsed = parseSemanticProviderReply(JSON.stringify(response(kind)), source);
    const before = structuredClone(parsed);
    const result = websiteVisitorCatalog(parsed.catalog, parsed.provenance!);
    assert.deepEqual(result.catalog.entities.map(entity => entity.id), ['story', 'offering']);
    assert.equal(result.catalog.entities[1].kind, kind);
    assert.match(result.catalog.entities[0].blocks![0].text, /final qualification/);
    assert.deepEqual(result.catalog.collections.map(collection => collection.id), ['parent', 'content']);
    assert.deepEqual(result.catalog.relationships.map(relation => relation.id), ['useful']);
    assert.deepEqual(result.catalog.facts, []);
    assert.deepEqual([...new Set(result.provenance.fields.map(field => field.entityId))], ['story']);
    assert.deepEqual(result.provenance.anchors, source.anchors, 'source excerpts stay private and intact');
    assert.deepEqual(result.provenance.facts, []);
    assert.deepEqual(result.provenance.relationships, []);
    assert.equal(result.removed, 2);
    assert.deepEqual(parsed, before, 'normalization must not mutate the captured interpretation');
    assert.doesNotThrow(() => validateSourceProvenance(result.provenance, result.catalog));
  }
});

test('source-only output fails instead of offering a publishable crawl dump', () => {
  const parsed = parseSemanticProviderReply(JSON.stringify(response()), source);
  const raw = validateCatalog({ ...parsed.catalog, entities: parsed.catalog.entities.filter(entity => entity.id === 'raw'), collections: [], relationships: [], facts: [] });
  assert.throws(() => websiteVisitorCatalog(raw, source), /only source pages/);
});

test('reimport retires unchanged source copies, preserves publisher edits, and is idempotent', () => {
  const raw = parseSemanticProviderReply(JSON.stringify(response()), source);
  const baseline = mergeKnowledge(null, raw.catalog, { name: sourceName, fileId: randomUUID(), hash: 'original', provenance: raw.provenance });
  const current = structuredClone(baseline);
  current.catalog.entities.find(entity => entity.kind === 'source_document')!.summary = 'Publisher deliberately kept this description.';
  current.catalog.entities.find(entity => entity.kind === 'service')!.name = 'Publisher service name';
  const normalized = websiteVisitorCatalog(raw.catalog, raw.provenance!);
  const incoming = () => mergeKnowledge(current, normalized.catalog, { name: sourceName, fileId: randomUUID(), hash: 'changed', provenance: normalized.provenance });
  const repaired = retireWebsiteSourceCopies(incoming(), current, sourceName);
  assert.equal(repaired.catalog.entities.some(entity => entity.kind === 'page'), false);
  assert.ok(repaired.catalog.entities.some(entity => entity.summary === 'Publisher deliberately kept this description.'));
  assert.ok(repaired.catalog.entities.some(entity => entity.name === 'Publisher service name'));
  assert.equal(current.catalog.entities.length, baseline.catalog.entities.length, 'the saved draft is untouched');
  const repeated = retireWebsiteSourceCopies(mergeKnowledge(repaired, normalized.catalog, { name: sourceName, fileId: randomUUID(), hash: 'changed-again', provenance: normalized.provenance }), repaired, sourceName);
  assert.deepEqual(repeated.catalog.entities, repaired.catalog.entities);
  const editedFact = structuredClone(current);
  editedFact.catalog.facts![0].value = 'A publisher correction on the page';
  const mergedFact = mergeKnowledge(editedFact, normalized.catalog, { name: sourceName, fileId: randomUUID(), hash: 'changed', provenance: normalized.provenance });
  assert.ok(retireWebsiteSourceCopies(mergedFact, editedFact, sourceName).catalog.entities.some(entity => entity.kind === 'page'));
});
