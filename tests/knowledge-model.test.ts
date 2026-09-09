import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { claimKnowledgeJob, changeKnowledgeJob, mergeKnowledge, type KnowledgeLedger } from '../lib/knowledge-model';
import { parseCsv, interpretStructuredSource, extractSource } from '../lib/source-extractors';
import { textPdf } from './knowledge-fixtures';

test('CSV preserves quoted commas/newlines and rejects malformed or oversized data', () => {
  assert.deepEqual(parseCsv('Name,Summary\r\n"One","Line one, here\nLine two"'), [['Name', 'Summary'], ['One', 'Line one, here\nLine two']]);
  for (const source of ['Name,Summary\nOne', 'Name\n"Unfinished', 'Name\n"Quoted"oops', `Name\n${Array.from({ length: 101 }, (_, i) => `Item ${i}`).join('\n')}`]) assert.throws(() => parseCsv(source));
});

test('three source packs produce real typed catalogs through the same CSV/TXT parser', async () => {
  for (const kind of ['tequila', 'bookstore', 'classes']) {
    const csv = await readFile(new URL(`../fixtures/source-packs/${kind}.csv`, import.meta.url), 'utf8');
    const txt = await readFile(new URL(`../fixtures/source-packs/${kind}.txt`, import.meta.url), 'utf8');
    const catalog = interpretStructuredSource(`${kind}.csv`, { format: 'csv', text: csv })!;
    const fromText = interpretStructuredSource(`${kind}.txt`, { format: 'text', text: txt })!;
    assert.ok(catalog.entities.length >= 3);
    assert.deepEqual(fromText.entities, catalog.entities);
    assert.deepEqual(fromText.attributes, catalog.attributes);
    assert.ok(catalog.attributes.some(attribute => attribute.type === 'money'));
    assert.deepEqual(catalog.capabilities, []);
  }
});

test('unstructured prose and unsupported currency are never faked as successful interpretation', async () => {
  assert.equal(interpretStructuredSource('menu.txt', { format: 'text', text: 'We sell amazing drinks. Ask us about the available options.' }), null);
  assert.throws(() => interpretStructuredSource('bad.csv', { format: 'csv', text: 'Name,Price [USD]\nOne,$12' }));
  await assert.rejects(() => extractSource('large.txt', 'text/plain', new TextEncoder().encode('a'.repeat(60_001))), /nothing was truncated/);
  await assert.rejects(() => extractSource('invalid.txt', 'text/plain', new Uint8Array([255, 254])), /UTF-8/);
});

test('an explicitly denominated empty price column preserves unknown money values', () => {
  const catalog = interpretStructuredSource('unknown-prices.csv', { format: 'csv', text: 'Name,Price [USD]\nOne,\nTwo,' })!;
  assert.equal(catalog.attributes[0].type, 'money');
  assert.equal(catalog.attributes[0].currency, 'USD');
  assert.ok(catalog.entities.every(entity => entity.attributes['price-usd'] === null));
});

test('reimport preserves publisher attribute/name/removal corrections and stable identity', () => {
  const first = interpretStructuredSource('catalog.csv', { format: 'csv', text: 'ID,Name,Price [USD]\none,One,10\ntwo,Two,20' })!;
  const artifact = mergeKnowledge(null, first, { fileId: randomUUID(), name: 'catalog.csv', hash: 'old' });
  const stableId = artifact.catalog.entities[0].id;
  artifact.catalog.entities[0].name = 'Publisher name';
  artifact.catalog.entities[0].attributes['price-usd'] = 12;
  artifact.catalog.entities = artifact.catalog.entities.slice(0, 1);
  artifact.catalog.collections[0].entityIds = [stableId];
  const next = interpretStructuredSource('catalog.csv', { format: 'csv', text: 'ID,Name,Price [USD]\none,One,15\ntwo,Two,25' })!;
  const merged = mergeKnowledge(artifact, next, { fileId: randomUUID(), name: 'catalog.csv', hash: 'new' });
  assert.equal(merged.catalog.entities.length, 1);
  assert.equal(merged.catalog.entities[0].id, stableId);
  assert.equal(merged.catalog.entities[0].name, 'Publisher name');
  assert.equal(merged.catalog.entities[0].attributes['price-usd'], 12);
  assert.ok(merged.notes.some(note => note.includes('removal')));
  assert.notEqual(merged.id, artifact.id);
});

test('stage claims prevent overlap/replay and fence late completion after interruption', () => {
  const ledger: KnowledgeLedger = { schemaVersion: 1, jobs: [] };
  const input = () => ({ id: randomUUID(), fileId: randomUUID(), sourceName: 'data.csv', sourceHash: 'hash', baseDraftHash: 'draft', baseRevision: 1 });
  const first = claimKnowledgeJob(ledger, input(), 1000);
  assert.throws(() => claimKnowledgeJob(ledger, input(), 1001), /already running/);
  const second = claimKnowledgeJob(ledger, input(), 122000);
  assert.throws(() => changeKnowledgeJob(ledger, first.id, first.claim, { status: 'needs_review' }), /superseded/);
  changeKnowledgeJob(ledger, second.id, second.claim, { status: 'needs_review' });
  assert.throws(() => claimKnowledgeJob(ledger, { ...input(), id: first.id }, 123000), /already received/);
});

test('reimport removes absent unedited source groups/edges and retains publisher-edited edges', () => {
  const first = interpretStructuredSource('catalog.csv', { format: 'csv', text: 'ID,Name\none,One\ntwo,Two' })!;
  first.relationships = [{ id: 'related', fromEntityId: 'one', toEntityId: 'two', label: 'Related to' }, { id: 'custom', fromEntityId: 'two', toEntityId: 'one', label: 'Source relationship' }];
  first.collections.push({ id: 'extra', name: 'Source grouping', entityIds: ['one'] });
  const artifact = mergeKnowledge(null, first, { fileId: randomUUID(), name: 'catalog.csv', hash: 'old' });
  artifact.catalog.relationships[1].label = 'Publisher relationship';
  const next = { ...first, relationships: [], collections: first.collections.slice(0, 1) };
  const merged = mergeKnowledge(artifact, next, { fileId: randomUUID(), name: 'catalog.csv', hash: 'new' });
  assert.equal(merged.catalog.relationships.length, 1);
  assert.equal(merged.catalog.relationships[0].label, 'Publisher relationship');
  assert.equal(merged.catalog.collections.length, 1);
  assert.ok(merged.notes.some(note => note.includes('Removed the unchanged source relationship')));
  assert.ok(merged.notes.some(note => note.includes('Removed the unchanged source collection')));
});


test('real PDF extraction retains structured lines and rejects mixed unreadable pages', async () => {
  const source = await extractSource('item.pdf', 'application/pdf', textPdf([['Name: Example item', 'Kind: offering', 'Price [USD]: 12']]));
  assert.equal(source.pages, 1);
  assert.equal(interpretStructuredSource('item.pdf', source)?.entities[0].attributes['price-usd'], 12);
  await assert.rejects(() => extractSource('mixed.pdf', 'application/pdf', textPdf([['Name: Example item'], []])), /page 2 has no readable text/);
  await assert.rejects(() => extractSource('broken.pdf', 'application/pdf', new TextEncoder().encode('%PDF-broken')), /could not be read/);
});
