import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateCatalog, type KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { mergeKnowledge, resolveKnowledgeIdentity, resolveKnowledgeUpdates, remappedEntityId } from '../lib/knowledge-model';
import { parseSemanticReplyWithProvenance, semanticReplyJsonSchema } from '../lib/ingestion';
import { catalogForPublication, refreshAssertionReviews, resolveAssertionReviews, validateAssertionReviews } from '../lib/knowledge-assertions';

function catalog(names: string[], values = [10, 20]): KnowledgeCatalog {
  const entities = names.map((name, index) => ({ id: `source-${index}`, kind: 'offering', name, summary: '', attributes: { price: values[index] ?? null } }));
  return { schemaVersion: 1, id: randomUUID(), name: 'Graph', description: '', attributes: [{ id: 'price', label: 'Price', type: 'number' }], entities,
    collections: [{ id: 'all', name: 'All', entityIds: entities.map(entity => entity.id) }], relationships: [], jobs: [], capabilities: [] };
}

test('catalog facts and temporal relationship metadata validate with typed values', () => {
  const base = catalog(['Alpha', 'Beta']);
  base.relationships = [{ id: 'rel', fromEntityId: 'source-0', toEntityId: 'source-1', label: 'pairs with', kind: 'bundle', confidence: .8, validFrom: '2026-01-01', validTo: '2026-12-31' }];
  base.facts = [{ id: 'fact', entityId: 'source-0', field: 'attributes.price', value: 12, confidence: .9, validFrom: '2026-01-01' }];
  assert.equal(validateCatalog(base).facts?.[0].confidence, .9);
  assert.throws(() => validateCatalog({ ...base, facts: [{ ...base.facts![0], value: 'twelve' }] }), /typed value/);
});

test('names and types alone never consolidate identities, including larger imports', () => {
  const first = mergeKnowledge(null, catalog(['Alpha', 'Beta']), { fileId: randomUUID(), name: 'first.csv', hash: 'first' });
  const next = mergeKnowledge(first, catalog(['Alpha', 'Beta'], [11, 21]), { fileId: randomUUID(), name: 'second.csv', hash: 'second' });
  assert.equal(next.catalog.entities.length, 4);
  assert.equal(next.catalog.entities[0].attributes.price, 10, 'existing approved values are retained when a consolidated source conflicts');
  assert.equal(next.identityMatches?.filter(match => match.status === 'auto').length, 0);
  assert.equal(next.identityMatches?.filter(match => match.status === 'review').length, 2);
  assert.equal(next.origins.length, 2);
});

test('model evidence binds prose fields only to exact, complete anchors', () => {
  const source = { anchors: [{ id: 'html-lines-1-2', format: 'html' as const, label: 'Lines 1–2', excerpt: 'Alpha is offered weekly.', lineStart: 1, lineEnd: 2 }], fields: [] };
  const value = { complete: true, issues: [], name: 'Graph', description: '', attributes: [], entities: [{ id: 'alpha', kind: 'offering', name: 'Alpha', summary: 'Offered weekly.', attributes: [] }], collections: [{ id: 'all', name: 'All', entityIds: ['alpha'] }], relationships: [], facts: [], evidence: [{ entityId: 'alpha', field: 'summary', anchorIds: ['html-lines-1-2'] }], jobs: [] };
  const parsed = parseSemanticReplyWithProvenance(value, source);
  assert.deepEqual(parsed.provenance.fields, [{ entityId: 'alpha', field: 'summary', anchorIds: ['html-lines-1-2'] }]);
  assert.throws(() => parseSemanticReplyWithProvenance({ ...value, evidence: [{ entityId: 'alpha', field: 'summary', anchorIds: ['missing'] }] }, source), /known anchors/);
});

test('publisher identity controls can add aliases, reject suggestions, and approve consolidation', () => {
  const first = catalog(['Alpha Craft Workshop Brooklyn Weekend Evening Class', 'Beta']);
  const artifact = mergeKnowledge(null, first, { fileId: randomUUID(), name: 'first.csv', hash: 'first' });
  const incoming = catalog(['Alpha Craft Workshop Brooklyn Weekend Evening Class Series', 'Beta']);
  incoming.facts = [{ id: 'incoming-price', entityId: 'source-0', field: 'attributes.price', value: 30 }];
  const suggested = mergeKnowledge(artifact, incoming, { fileId: randomUUID(), name: 'second.csv', hash: 'second' });
  const review = suggested.identityMatches?.find(match => match.status === 'review');
  assert.ok(review, 'a high-similarity cross-source identity remains review-only');
  const aliased = resolveKnowledgeIdentity(suggested, [{ id: review!.id, action: 'alias', alias: 'Alpha Weekend Series' }]);
  assert.ok(aliased.catalog.entities.find(entity => entity.id === review!.canonicalEntityId)?.aliases?.includes('Alpha Weekend Series'));
  const approved = resolveKnowledgeIdentity(aliased, [{ id: review!.id, action: 'approve' }]);
  assert.equal(approved.catalog.entities.length, 3);
  assert.equal(approved.catalog.facts?.[0].entityId, review!.canonicalEntityId, 'graph assertions follow the approved canonical identity');
  assert.ok(approved.identityRemaps, 'historical IDs resolve through an explicit remap');
  assert.equal(approved.identityMatches?.find(match => match.id === review!.id)?.decision, 'approved');
  const rejected = resolveKnowledgeIdentity(suggested, [{ id: review!.id, action: 'reject' }]);
  assert.equal(rejected.catalog.entities.length, 4, 'an unrelated name match is not automatically consolidated');
  assert.equal(rejected.identityMatches?.find(match => match.id === review!.id)?.decision, 'rejected');
});

test('fact and relationship source replacement records temporal conflicts and correction history', () => {
  const initial = catalog(['Alpha', 'Beta']);
  initial.relationships = [{ id: 'related', fromEntityId: 'source-0', toEntityId: 'source-1', label: 'pairs with', kind: 'bundle', validFrom: '2026-01-01', validTo: '2026-12-31' }];
  initial.facts = [{ id: 'price-fact', entityId: 'source-0', field: 'attributes.price', value: 10, validFrom: '2026-01-01', validTo: '2026-12-31' }];
  const provenance = (label: string) => ({ anchors: [{ id: 'graph-row', format: 'csv' as const, label, excerpt: label, row: 2, lineStart: 2, lineEnd: 2 }], fields: [], facts: [{ targetId: 'price-fact', anchorIds: ['graph-row'] }], relationships: [{ targetId: 'related', anchorIds: ['graph-row'] }] });
  const first = mergeKnowledge(null, initial, { fileId: randomUUID(), name: 'facts.csv', hash: 'v1', provenance: provenance('old graph assertion') });
  first.catalog.facts![0].value = 12;
  first.catalog.relationships[0].label = 'pairs closely with';
  const next = structuredClone(initial); next.facts![0].value = 15; next.relationships[0].label = 'bundles with';
  const review = mergeKnowledge(first, next, { fileId: randomUUID(), name: 'facts.csv', hash: 'v2', provenance: provenance('new graph assertion') });
  assert.equal(review.graphUpdates?.filter(update => update.kind.endsWith('_conflict')).length, 2);
  assert.equal(review.graphUpdates?.every(update => update.previousSource && update.incomingSource), true);
  const resolved = resolveKnowledgeUpdates(review, review.graphUpdates!.map(update => ({ id: update.id, choice: 'incoming' })));
  assert.equal(resolved.catalog.facts![0].value, 15);
  assert.equal(resolved.catalog.relationships[0].label, 'bundles with');
  assert.ok(resolved.correctionHistory?.some(entry => entry.action === 'source-accepted'));
});

test('automatic identity requires a scoped identifier and corroboration; contradictions and rejection stay separate', () => {
  const source = catalog(['Alpha', 'Beta']);
  source.entities[0].identifiers = [{ scheme: 'publisher-id', value: 'example.org:alpha' }];
  const first = mergeKnowledge(null, source, { fileId: randomUUID(), name: 'a.csv', hash: 'a' });
  const strong = mergeKnowledge(first, source, { fileId: randomUUID(), name: 'b.csv', hash: 'b' });
  assert.equal(strong.catalog.entities.length, 3);
  assert.equal(strong.identityMatches?.find(match => match.status === 'auto')?.method, 'identifier-corroborated');
  const model = mergeKnowledge(first, source, { fileId: randomUUID(), name: 'model.txt', hash: 'm', modelInterpreted: true });
  assert.equal(model.catalog.entities.length, 4, 'model-supplied identifiers await review, even if their text matches');
  const contradictory = structuredClone(source); contradictory.entities[0].attributes.price = 99;
  const review = mergeKnowledge(first, contradictory, { fileId: randomUUID(), name: 'c.csv', hash: 'c' });
  assert.equal(review.catalog.entities.length, 4);
  const match = review.identityMatches!.find(match => match.incomingName === 'Alpha')!;
  const rejected = resolveKnowledgeIdentity(review, [{ id: match.id, action: 'reject' }]);
  const replay = mergeKnowledge(rejected, source, { fileId: randomUUID(), name: 'c.csv', hash: 'd' });
  assert.equal(replay.catalog.entities.length, 4);
  assert.equal(replay.identityMatches?.find(item => item.id === match.id)?.decision, 'rejected');
});

test('approved identity survives renamed source labels, source choices and historical remaps', () => {
  const first = mergeKnowledge(null, catalog(['Alpha', 'Beta']), { fileId: randomUUID(), name: 'a.csv', hash: 'a' });
  const incoming = catalog(['Alpha', 'Beta']); incoming.facts = [{ id: 'fact', entityId: 'source-0', field: 'attributes.price', value: 10 }];
  const suggested = mergeKnowledge(first, incoming, { fileId: randomUUID(), name: 'b.csv', hash: 'b' });
  const match = suggested.identityMatches!.find(match => match.incomingName === 'Alpha')!;
  const oldId = suggested.origins[1].entityMap!['source-0'];
  const approved = resolveKnowledgeIdentity(suggested, [{ id: match.id, action: 'approve' }]);
  assert.equal(remappedEntityId(oldId, approved.identityRemaps), match.canonicalEntityId);
  assert.ok(!approved.updates?.some(update => update.entityId === oldId));
  incoming.entities[0].name = 'Alpha renamed by source';
  const replacement = mergeKnowledge(approved, incoming, { fileId: randomUUID(), name: 'renamed.csv', replacesSourceKey: 'b.csv', hash: 'c' });
  assert.equal(replacement.origins.find(origin => origin.key === 'b.csv')?.entityMap?.['source-0'], match.canonicalEntityId);
  assert.equal(replacement.catalog.entities.length, 3);
  assert.throws(() => remappedEntityId('a', { a: 'b', b: 'a' }), /cycle/);
});

test('graph choices are reversible across IDs, unrelated edits and repeat decisions without duplicate history', () => {
  const initial = catalog(['Alpha', 'Beta']);
  initial.entities[0].identifiers = [{ scheme: 'publisher-id', value: 'example:alpha' }];
  initial.facts = [{ id: 'old', entityId: 'source-0', field: 'attributes.price', value: 10 }];
  const first = mergeKnowledge(null, initial, { fileId: randomUUID(), name: 'a.csv', hash: 'a' });
  const incoming = structuredClone(initial); incoming.facts = [{ ...initial.facts[0], id: 'new', value: 15 }];
  let review = mergeKnowledge(first, incoming, { fileId: randomUUID(), name: 'b.csv', hash: 'b' });
  const update = review.graphUpdates![0];
  assert.equal(update.kind, 'fact_conflict');
  for (const choice of ['incoming', 'keep', 'incoming', 'keep'] as const) {
    review = resolveKnowledgeUpdates(review, [{ id: update.id, choice }]);
    assert.equal(review.catalog.facts![0].value, choice === 'incoming' ? 15 : 10);
  }
  assert.equal(new Set(review.correctionHistory!.map(entry => entry.id)).size, review.correctionHistory!.length);
  const removed = structuredClone(first); removed.catalog.facts = [];
  const repeated = mergeKnowledge(removed, initial, { fileId: randomUUID(), name: 'a.csv', hash: 'new-hash' });
  assert.deepEqual(repeated.catalog.facts, [], 'reimport cannot resurrect a publisher-deleted assertion');
});

test('strict provider schema supports nullable optional values, singleton predicates and explicit unsupported review', () => {
  const schema = semanticReplyJsonSchema() as Record<string, unknown>;
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if ('type' in value && value.type === 'object' && 'properties' in value) {
      const object = value as Record<string, unknown>;
      assert.equal(object.additionalProperties, false);
      assert.deepEqual((object.required as string[]).sort(), Object.keys(value.properties as object).sort());
    }
    Object.values(value).forEach(visit);
  };
  visit(schema);
  const source = { anchors: [{ id: 'source', format: 'text' as const, label: 'Line 1', excerpt: 'Alpha is here.', lineStart: 1, lineEnd: 1 }], fields: [] };
  const reply = { complete: true, issues: [], name: 'Example', description: '', attributes: [], entities: [{ id: 'alpha', name: 'Alpha', kind: 'business', summary: '', aliases: null, identifiers: null, attributes: [] }],
    facts: [{ id: 'email', entityId: 'alpha', target: { scope: 'property', value: 'not-stated@example.test', definition: { id: 'email', label: 'Email', type: 'text', unit: null, currency: null } }, validFrom: null }], relationships: [], collections: [], jobs: [], evidence: [] };
  const parsed = parseSemanticReplyWithProvenance(reply, source);
  let artifact = mergeKnowledge(null, parsed.catalog, { fileId: randomUUID(), name: 'prose.txt', hash: 'x', provenance: parsed.provenance });
  artifact.assertionReviews = refreshAssertionReviews(artifact, 'model');
  assert.ok(artifact.assertionReviews.every(review => review.support === 'unsupported'));
  assert.throws(() => catalogForPublication(artifact), /unsupported/);
  assert.throws(() => validateAssertionReviews([], artifact.catalog), /cover/);
  artifact = resolveAssertionReviews(artifact, artifact.assertionReviews.map(review => ({ targetType: review.targetType, targetId: review.targetId, decision: review.targetType === 'fact' ? 'reject' : 'approve' })));
  assert.deepEqual(catalogForPublication(artifact).facts, []);
  assert.deepEqual(catalogForPublication(artifact).capabilities, []);
  assert.equal(JSON.stringify(artifact.catalog).includes('anchorIds'), false);
});

test('rejected facts cannot leak through mirrored fields and identity metadata needs an explicit review', () => {
  const incoming = catalog(['Alpha']); incoming.entities[0].aliases = ['A'];
  incoming.entities[0].identifiers = [{ scheme: 'publisher-id', value: 'example:alpha' }];
  incoming.facts = [{ id: 'price', entityId: 'source-0', field: 'attributes.price', value: 10 }];
  let artifact = mergeKnowledge(null, incoming, { fileId: randomUUID(), name: 'untrusted.txt', hash: 'x', modelInterpreted: true });
  artifact.assertionReviews = refreshAssertionReviews(artifact, 'model');
  assert.equal(artifact.assertionReviews.filter(review => /\/(aliases|identifiers)$/.test(review.targetId) && review.support === 'unsupported').length, 2);
  artifact = resolveAssertionReviews(artifact, artifact.assertionReviews.map(review => ({ targetType: review.targetType, targetId: review.targetId, decision: review.targetType === 'fact' || review.targetId.endsWith('/identifiers') ? 'reject' : 'approve' })));
  const publicCatalog = catalogForPublication(artifact);
  assert.equal(publicCatalog.entities[0].attributes.price, null);
  assert.equal(publicCatalog.entities[0].identifiers, undefined);
  assert.deepEqual(publicCatalog.facts, []);
});

test('approving identity does not approve unsupported model claims copied to the canonical entity', () => {
  const first = mergeKnowledge(null, catalog(['Alpha']), { fileId: randomUUID(), name: 'a.csv', hash: 'a' });
  first.assertionReviews = refreshAssertionReviews(first, 'publisher');
  const incoming = catalog(['Alpha']); incoming.entities[0].attributes.email = 'unsupported@example.test';
  incoming.attributes.push({ id: 'email', label: 'Email', type: 'text' });
  incoming.facts = [{ id: 'email', entityId: 'source-0', field: 'attributes.email', value: 'unsupported@example.test' }];
  const candidate = mergeKnowledge(first, incoming, { fileId: randomUUID(), name: 'model.txt', hash: 'b', modelInterpreted: true });
  candidate.assertionReviews = refreshAssertionReviews(candidate, 'model', first.assertionReviews);
  const result = resolveKnowledgeIdentity(candidate, [{ id: candidate.identityMatches![0].id, action: 'approve' }]);
  assert.equal(result.catalog.entities.length, 1);
  assert.ok(result.assertionReviews?.some(review => review.targetType === 'fact' && review.origin === 'model' && review.status === 'pending'));
  assert.ok(result.assertionReviews?.some(review => review.targetId.endsWith('/attributes.email') && review.support === 'unsupported' && review.status === 'pending'));
  assert.throws(() => catalogForPublication(result), /unsupported/);
});
