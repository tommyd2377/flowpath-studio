import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { mergeKnowledge, resolveSourceOrigin, resolveKnowledgeUpdates, validateKnowledgeUpdates, validateKnowledgeUpdateContext, type KnowledgeArtifact } from '../lib/knowledge-model';
import type { SourceProvenance } from '../lib/source-provenance';

function catalog(prices = [10, 20]): KnowledgeCatalog {
  return { schemaVersion: 1, id: randomUUID(), name: 'Source catalog', description: '',
    attributes: [{ id: 'price', label: 'Price', type: 'money', currency: 'USD' }],
    entities: prices.map((price, index) => ({ id: `item-${index}`, kind: 'offering', name: `Item ${index}`, summary: 'Source description', attributes: { price } })),
    collections: [{ id: 'all', name: 'All items', entityIds: prices.map((_, index) => `item-${index}`) }], relationships: [], jobs: [], capabilities: [] };
}
const source = (hash: string) => ({ fileId: randomUUID(), name: 'catalog.csv', hash });
function provenance(label: string): SourceProvenance {
  return { anchors: [{ id: 'row-2', format: 'csv', label, excerpt: `Item 0,${label}`, row: 2, lineStart: 2, lineEnd: 2 }],
    fields: [{ entityId: 'item-0', field: 'attributes.price', anchorIds: ['row-2'] }] };
}
function base() { const incoming = catalog(); return { incoming, artifact: mergeKnowledge(null, incoming, source('v1')) }; }
const decide = (artifact: KnowledgeArtifact, id: string, choice: 'keep' | 'incoming') => resolveKnowledgeUpdates(artifact, [{ id, choice }]);

test('source changes adopt safe values while publisher conflicts remain explicit and reversible', () => {
  const { incoming, artifact } = base();
  artifact.catalog.entities[0].attributes.price = 12;
  const next = structuredClone(incoming); next.entities[0].attributes.price = 15; next.entities[1].summary = 'Updated source description';
  const result = mergeKnowledge(artifact, next, source('v2'));
  const conflict = result.updates!.find(update => update.kind === 'conflict')!;
  const changed = result.updates!.find(update => update.kind === 'changed')!;
  assert.deepEqual([conflict.previous, conflict.current, conflict.incoming, conflict.defaultChoice], [10, 12, 15, 'keep']);
  assert.equal(result.catalog.entities[0].attributes.price, 12); assert.equal(result.catalog.entities[1].summary, 'Updated source description');
  assert.equal(changed.field, 'summary'); assert.equal(changed.defaultChoice, 'incoming');
  const accepted = decide(result, conflict.id, 'incoming');
  assert.equal(accepted.catalog.entities[0].attributes.price, 15); assert.equal(accepted.updates![0].id, result.updates![0].id);
  assert.ok(accepted.notes.every(note => !note.startsWith('Kept your price correction')), 'notes do not contradict a changed resolution');
  assert.notEqual(accepted.id, result.id); assert.equal(accepted.id, accepted.catalog.id);
  const restored = decide(accepted, conflict.id, 'keep');
  assert.equal(restored.catalog.entities[0].attributes.price, 12);
  const keptOriginal = decide(restored, changed.id, 'keep');
  assert.equal(keptOriginal.catalog.entities[1].summary, 'Source description');
  assert.equal(result.catalog.entities[0].attributes.price, 12, 'resolutions do not mutate earlier candidates');
  assert.equal(accepted.origins[0].baseline.entities[0].attributes.price, 15, 'decisions never rewrite the new source baseline');
});

test('unchanged source and already-matching publisher values do not manufacture conflicts', () => {
  const { incoming, artifact } = base();
  artifact.catalog.entities[0].attributes.price = 12; artifact.catalog.entities[0].name = 'Publisher name';
  assert.deepEqual(mergeKnowledge(artifact, incoming, source('same-facts')).updates, []);
  const next = structuredClone(incoming); next.entities[0].attributes.price = 12;
  assert.deepEqual(mergeKnowledge(artifact, next, source('already-correct')).updates, []);
  artifact.catalog.entities.pop(); artifact.catalog.collections[0].entityIds.pop();
  assert.deepEqual(mergeKnowledge(artifact, incoming, source('unchanged-removal')).updates, []);
});

test('a kept source change becomes a publisher override against the newest baseline', () => {
  const { incoming, artifact } = base();
  const next = structuredClone(incoming); next.entities[0].attributes.price = 15;
  const review = mergeKnowledge(artifact, next, source('v2'));
  const kept = decide(review, review.updates![0].id, 'keep');
  assert.equal(kept.catalog.entities[0].attributes.price, 10);
  assert.equal(kept.origins[0].baseline.entities[0].attributes.price, 15);
  assert.deepEqual(mergeKnowledge(kept, next, source('v2-equivalent')).updates, []);
  next.entities[0].attributes.price = 16;
  const later = mergeKnowledge(kept, next, source('v3'));
  assert.deepEqual([later.updates![0].kind, later.updates![0].previous, later.updates![0].current, later.updates![0].incoming], ['conflict', 15, 10, 16]);
});

test('missing items stay by default; removal prunes references and can be reversed within the review', () => {
  const { incoming, artifact } = base();
  const [first, second] = artifact.catalog.entities.map(entity => entity.id);
  artifact.catalog.collections.push({ id: 'publisher-group', name: 'Publisher grouping', entityIds: [first, second] });
  artifact.catalog.relationships.push({ id: 'publisher-relation', fromEntityId: first, toEntityId: second, label: 'Related' });
  artifact.catalog.capabilities = [{ id: 'publisher-link', kind: 'link', label: 'More', url: 'https://example.com/more', entityIds: [first, second] }];
  const next = structuredClone(incoming); next.entities.pop(); next.collections[0].entityIds.pop();
  const review = mergeKnowledge(artifact, next, source('v2'));
  const missing = review.updates!.find(update => update.kind === 'missing')!;
  assert.equal(review.catalog.entities.length, 2); assert.equal(missing.defaultChoice, 'keep');
  const removed = decide(review, missing.id, 'incoming');
  assert.ok(removed.notes.every(note => !note.includes('It was retained')), 'missing-source notes do not claim the removed item remains');
  assert.equal(removed.catalog.entities.length, 1); assert.equal(removed.catalog.relationships.length, 0);
  assert.ok(removed.catalog.collections.every(group => !group.entityIds.includes(second)));
  assert.deepEqual(removed.catalog.capabilities![0].entityIds, [first]);
  const restored = decide(removed, missing.id, 'keep');
  assert.deepEqual(restored.catalog.entities, review.catalog.entities);
  assert.deepEqual(restored.catalog.relationships, review.catalog.relationships);
  assert.deepEqual(restored.catalog.capabilities, review.catalog.capabilities);
  assert.deepEqual(restored.catalog.collections, review.catalog.collections);
});

test('added and publisher-removed items can be declined or restored without losing stable IDs', () => {
  const { incoming, artifact } = base(); const second = artifact.catalog.entities[1].id;
  artifact.catalog.entities.pop(); artifact.catalog.collections[0].entityIds.pop();
  const next = catalog([10, 25, 30]); next.relationships = [{ id: 'source-link', fromEntityId: 'item-1', toEntityId: 'item-2', label: 'Together' }];
  const review = mergeKnowledge(artifact, next, source('v2'));
  const removed = review.updates!.find(update => update.kind === 'removed_by_publisher')!;
  const added = review.updates!.find(update => update.kind === 'added')!;
  assert.equal(removed.defaultChoice, 'keep'); assert.equal(added.defaultChoice, 'incoming');
  const restored = decide(review, removed.id, 'incoming');
  assert.ok(restored.catalog.entities.some(entity => entity.id === second));
  assert.ok(restored.catalog.collections.some(group => group.entityIds.includes(second)));
  assert.ok(restored.catalog.relationships.some(relation => relation.fromEntityId === second));
  const declined = decide(restored, added.id, 'keep');
  assert.equal(declined.catalog.entities.length, incoming.entities.length); assert.equal(declined.catalog.relationships.length, 0);
  const readded = decide(declined, added.id, 'incoming');
  assert.ok(readded.catalog.entities.some(entity => entity.id === added.entityId));
  assert.ok(readded.catalog.collections.some(group => group.entityIds.includes(second)), 'restoring another item must not discard existing memberships');
  assert.equal(readded.catalog.relationships.length, 1);
});

test('renamed replacement retains the source namespace, future reimports and provenance field identities', () => {
  const incoming = catalog();
  const artifact = mergeKnowledge(null, incoming, { ...source('v1'), provenance: provenance('Old price') });
  const stableId = artifact.catalog.entities[0].id;
  assert.equal(artifact.origins[0].provenance!.fields[0].entityId, stableId);
  assert.equal(artifact.origins[0].provenance!.fields[0].anchorIds[0], 'row-2');
  incoming.entities[0].attributes.price = 15;
  const review = mergeKnowledge(artifact, incoming, { ...source('v2'), name: 'new-name.csv', replacesSourceKey: 'catalog.csv', provenance: provenance('New price') });
  assert.equal(review.origins.length, 1); assert.equal(review.origins[0].key, 'catalog.csv'); assert.equal(review.origins[0].name, 'new-name.csv');
  assert.equal(review.catalog.entities[0].id, stableId);
  assert.equal(review.updates![0].previousSource!.sourceName, 'catalog.csv'); assert.equal(review.updates![0].incomingSource!.sourceName, 'new-name.csv');
  assert.equal(review.updateAnchors!.find(anchor => anchor.id === review.updates![0].previousSource!.anchorId)!.label, 'Old price');
  assert.equal(review.updateAnchors!.find(anchor => anchor.id === review.updates![0].incomingSource!.anchorId)!.label, 'New price');
  incoming.entities[0].attributes.price = 16;
  const later = mergeKnowledge(review, incoming, { ...source('v3'), name: 'new-name.csv' });
  assert.equal(later.origins.length, 1); assert.equal(later.catalog.entities[0].id, stableId);
  assert.throws(() => mergeKnowledge(artifact, incoming, { ...source('v2'), replacesSourceKey: 'unknown-source' }), /existing source/);
  assert.throws(() => mergeKnowledge(null, incoming, { ...source('v2'), replacesSourceKey: 'catalog.csv' }), /existing source/);
  assert.equal(resolveSourceOrigin(review, { name: 'new-name.csv' })?.key, 'catalog.csv');
  const other = mergeKnowledge(review, catalog(), { ...source('other'), name: 'other.csv' });
  assert.throws(() => resolveSourceOrigin(other, { name: 'other.csv', replacesSourceKey: 'catalog.csv' }), /already uses this filename/);
  assert.throws(() => resolveSourceOrigin(other, { name: 'new.csv', replacesSourceKey: 'unknown' }), /existing source/);
});

test('absent incoming attributes remain distinct from explicit null and restore their original presence', () => {
  const { incoming, artifact } = base(); delete incoming.entities[0].attributes.price;
  const review = mergeKnowledge(artifact, incoming, source('v2'));
  const update = review.updates![0]; assert.equal(update.incoming, null); assert.equal(update.incomingPresent, false);
  assert.equal(Object.hasOwn(review.catalog.entities[0].attributes, 'price'), false);
  const kept = decide(review, update.id, 'keep'); assert.equal(kept.catalog.entities[0].attributes.price, 10);
  const accepted = decide(kept, update.id, 'incoming'); assert.equal(Object.hasOwn(accepted.catalog.entities[0].attributes, 'price'), false);
});

test('resolution rejects forged, duplicate, stale, invalid and last-item-removing decisions', () => {
  const { incoming, artifact } = base(); incoming.entities[0].attributes.price = 15;
  const review = mergeKnowledge(artifact, incoming, source('v2')); const update = review.updates![0];
  assert.throws(() => decide(review, 'unknown', 'incoming'), /no longer available/);
  assert.throws(() => resolveKnowledgeUpdates(review, [{ id: update.id, choice: 'keep' }, { id: update.id, choice: 'incoming' }]), /only once/);
  assert.throws(() => resolveKnowledgeUpdates(review, [{ id: update.id, choice: 'invented' as 'keep' }]));
  assert.throws(() => validateKnowledgeUpdates([{ ...update, incoming: 'not money' }], review.catalog), /invalid attribute/);
  assert.throws(() => validateKnowledgeUpdates([{ ...update, field: 'capabilities.url' }], review.catalog));
  review.catalog.entities[0].attributes.price = 99;
  assert.throws(() => decide(review, update.id, 'incoming'), /edited after/);
  const first = mergeKnowledge(null, catalog([10]), source('v1'));
  const replacement = catalog([20]); replacement.entities[0].id = 'replacement'; replacement.collections[0].entityIds = ['replacement'];
  const replacing = mergeKnowledge(first, replacement, source('v2'));
  assert.throws(() => resolveKnowledgeUpdates(replacing, replacing.updates!.map(update => ({ id: update.id, choice: update.kind === 'added' ? 'keep' : 'incoming' }))), /Keep at least one item/);
  assert.equal(replacing.catalog.entities.length, 2);
});

test('older artifacts remain valid without provenance or update records', () => {
  const { artifact } = base(); delete artifact.updates;
  assert.deepEqual(validateKnowledgeUpdates(artifact.updates ?? [], artifact.catalog), []);
  assert.throws(() => resolveKnowledgeUpdates(artifact, [{ id: 'unknown', choice: 'keep' }]), /no longer available/);
  assert.equal(artifact.origins[0].provenance, undefined);
});

test('restoring several removed items shares context without losing other memberships', () => {
  const initial = catalog([10, 20, 30]); const artifact = mergeKnowledge(null, initial, source('v1'));
  const ids = artifact.catalog.entities.map(entity => entity.id);
  artifact.catalog.entities = artifact.catalog.entities.slice(0, 1); artifact.catalog.collections[0].entityIds = [ids[0]];
  const review = mergeKnowledge(artifact, catalog([10, 25, 35]), source('v2'));
  const changes = review.updates!;
  assert.equal(changes.length, 2); assert.equal(review.updateContext!.collections.length, 1);
  assert.ok(changes.every(update => update.restoration!.collectionIds.length === 1));
  const restored = resolveKnowledgeUpdates(review, changes.map(update => ({ id: update.id, choice: 'incoming' })));
  assert.deepEqual(restored.catalog.collections[0].entityIds, ids);
  const removedAgain = decide(restored, changes[0].id, 'keep');
  assert.deepEqual(removedAgain.catalog.collections[0].entityIds, [ids[0], ids[2]]);
  assert.deepEqual(decide(removedAgain, changes[0].id, 'incoming').catalog.collections[0].entityIds, ids);
  const forged = structuredClone(review); forged.updates![0].restoration!.collectionIds = ['unknown'];
  assert.throws(() => decide(forged, changes[0].id, 'incoming'), /unavailable saved relationships/);
  assert.throws(() => validateKnowledgeUpdateContext({ ...review.updateContext, collections: [...review.updateContext!.collections, ...review.updateContext!.collections] }), /duplicate/);
});

test('wide sources share anchors and context; extreme update sets fail the existing storage cap honestly', async () => {
  const wide = catalog(Array.from({ length: 100 }, (_, index) => index));
  wide.attributes = Array.from({ length: 24 }, (_, index) => ({ id: `attr${index}`, label: `Attribute ${index}`, type: 'number' as const }));
  for (const [index, entity] of wide.entities.entries()) entity.attributes = Object.fromEntries(wide.attributes.map((attribute, column) => [attribute.id, index + column]));
  const locations = (value: KnowledgeCatalog): SourceProvenance => ({
    anchors: value.entities.map((entity, index) => ({ id: `row-${index + 2}`, format: 'csv', label: `Record ${index + 2}`, row: index + 2, lineStart: index + 2, lineEnd: index + 2, excerpt: [entity.name, ...Object.values(entity.attributes)].join(',') })),
    fields: value.entities.flatMap((entity, index) => value.attributes.map(attribute => ({ entityId: entity.id, field: `attributes.${attribute.id}`, anchorIds: [`row-${index + 2}`] }))),
  });
  const original = mergeKnowledge(null, wide, { ...source('wide-v1'), provenance: locations(wide) });
  assert.deepEqual(original.updates, [], 'initial item review does not duplicate every item as an added update');
  const changed = structuredClone(wide); for (const entity of changed.entities) entity.attributes.attr0 = Number(entity.attributes.attr0) + 1;
  const common = mergeKnowledge(original, changed, { ...source('wide-v2'), provenance: locations(changed) });
  assert.equal(common.updates!.length, 100); assert.equal(common.updateAnchors!.length, 200);
  assert.ok(Buffer.byteLength(JSON.stringify(original)) < 700_000); assert.ok(Buffer.byteLength(JSON.stringify(common)) < 700_000);
  const extreme = structuredClone(wide); for (const entity of extreme.entities) for (const field of Object.keys(entity.attributes)) entity.attributes[field] = Number(entity.attributes[field]) + 1;
  const allChanged = mergeKnowledge(original, extreme, { ...source('wide-v3'), provenance: locations(extreme) });
  assert.equal(allChanged.updates!.length, 2400, 'all source changes remain represented');
  assert.equal(allChanged.updateAnchors!.length, 200, 'source excerpts are stored once per old/new row');
  assert.ok(Buffer.byteLength(JSON.stringify(allChanged)) > 700_000);
  const directory = await mkdtemp(join(tmpdir(), 'source-review-size-'));
  const previous = { directory: process.env.VOICE_DATA_DIR, backend: process.env.VOICE_BACKEND };
  process.env.VOICE_DATA_DIR = directory; process.env.VOICE_BACKEND = 'demo';
  try {
    const { writeKnowledgeArtifact } = await import('../lib/knowledge-store');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null }; const siteId = randomUUID();
    await writeKnowledgeArtifact(user, siteId, original); await writeKnowledgeArtifact(user, siteId, common);
    await assert.rejects(() => writeKnowledgeArtifact(user, siteId, allChanged), /pilot storage limit.*nothing was truncated/);
  } finally {
    if (previous.directory === undefined) delete process.env.VOICE_DATA_DIR; else process.env.VOICE_DATA_DIR = previous.directory;
    if (previous.backend === undefined) delete process.env.VOICE_BACKEND; else process.env.VOICE_BACKEND = previous.backend;
    await rm(directory, { recursive: true, force: true });
  }
});
