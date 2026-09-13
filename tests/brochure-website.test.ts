import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withDocumentReading } from '../lib/document-reading';
import { websiteSections } from '../lib/website-presentation';
import { publishedWorkspace } from '../lib/visitor-workspace';
import { initialSite } from '../lib/local-store';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { validateMediaLibrary } from '@thevoice/platform-ui/media';

const catalog = () => validateCatalog({ schemaVersion: 1, id: randomUUID(), name: 'Harbor guide', description: 'A local guide', attributes: [], capabilities: [], facts: [], relationships: [], jobs: [],
  entities: [{ id: 'town', kind: 'place', name: 'Harbor', summary: 'A coastal town.', attributes: {} }, { id: 'history', kind: 'article', name: 'History', summary: 'A short introduction.', attributes: {}, blocks: [{ id: 'body', kind: 'paragraph', text: 'A complete account beyond the summary.' }] }],
  collections: [{ id: 'all', name: 'Guide', entityIds: ['town', 'history'] }, { id: 'places', name: 'Places', parentIds: ['all'], entityIds: ['town'] }] });

test('prose retains complete reading text, bounded blocks and stable identity without fabricated photos', () => {
  const original = catalog(), text = `${'A paragraph.\n'.repeat(1200)}The final sentence.`;
  const result = withDocumentReading(original, { format: 'pdf', text, pages: 5 });
  const reader = result.entities.at(-1)!;
  assert.equal(reader.kind, 'document');
  assert.equal(reader.blocks?.map(block => block.text).join(''), text);
  assert.ok(reader.blocks?.every(block => block.text.length <= 8000));
  assert.equal(withDocumentReading(result, { format: 'pdf', text }).entities.length, result.entities.length);
  assert.deepEqual(result.entities.slice(0, 2), original.entities);
  assert.deepEqual(result.facts, original.facts);
  assert.equal(withDocumentReading(original, { format: 'csv', text }), original);
  const boundaryText = `${'x'.repeat(8000)}\nLast line.`;
  const boundaryReader = withDocumentReading(original, { format: 'pdf', text: boundaryText }).entities.at(-1)!;
  assert.ok(boundaryReader.blocks?.every(block => block.text.length <= 8000));
  assert.equal(boundaryReader.blocks?.map(block => block.text).join(''), boundaryText);
});

test('topics become reading sections, leaf collections organize names and all references remain addressable', () => {
  const graph = withDocumentReading(catalog(), { format: 'pdf', text: 'Complete source text' });
  const content = { ...initialSite('general').draft, sections: [], knowledgeRevisionId: graph.id };
  const authority = publishedWorkspace(content, graph);
  const sections = websiteSections(authority, content, graph);
  assert.equal(sections[0].kind, 'stories');
  assert.equal(sections[0].title, 'History');
  assert.equal(sections[0].entries[0].blocks?.[0].text, 'A complete account beyond the summary.');
  assert.equal(sections[1].title, 'Places', 'parent all-items collections must not swallow leaf sections');
  const ids = sections.flatMap(section => section.entries.map(entry => entry.id));
  assert.equal(new Set(ids).size, graph.entities.length);
  for (const entity of graph.entities) assert.ok(authority.records.some(record => record.reference.kind === 'entity' && record.reference.id === entity.id));
  assert.equal(sections.at(-1)?.title, 'Read the document');
});

test('reviewed business photos are spread between sections without inventing item associations or repeating strip images', () => {
  const graph = catalog();
  graph.entities.push(...Array.from({ length: 4 }, (_, index) => ({ id: `topic-${index}`, kind: 'article', name: `Topic ${index}`, summary: 'Useful content.', attributes: {}, blocks: [{ id: 'body', kind: 'paragraph' as const, text: 'Some substantive topic content.' }] })));
  const media = validateMediaLibrary({ schemaVersion: 1, id: randomUUID(),
    assets: Array.from({ length: 14 }, (_, index) => ({ id: `photo-${index}`, width: 1600, height: 1200, caption: `Business photo ${index}`, alt: `Photo ${index}` })),
    albums: [{ id: 'work', title: 'Our work', description: 'Reviewed business photography.', assetIds: Array.from({ length: 14 }, (_, index) => `photo-${index}`) }],
    associations: Array.from({ length: 14 }, (_, index) => ({ id: `association-${index}`, assetId: `photo-${index}`, targetType: index === 2 ? 'entity' : 'site', ...(index === 2 ? { targetId: 'history' } : {}), primary: index === 1, role: index === 3 ? 'example' : 'depicts' })),
  });
  const original = structuredClone(media);
  const content = { ...initialSite('general').draft, sections: [], logoAssetId: 'photo-0', knowledgeRevisionId: graph.id };
  const authority = publishedWorkspace(content, graph, media);
  const sections = websiteSections(authority, content, graph, media);
  const highlights = sections.filter(section => section.navigation === false);
  assert.equal(highlights.length, 3);
  const photoIds = highlights.flatMap(section => section.entries.map(entry => entry.imageAssetId));
  assert.equal(new Set(photoIds).size, photoIds.length);
  assert.ok(photoIds.every(id => !['photo-0', 'photo-1', 'photo-2'].includes(id!)), 'logo, lead and already placed item photos are not reused in highlights');
  assert.ok(highlights.flatMap(section => section.entries).find(entry => entry.imageAssetId === 'photo-3')?.example);
  assert.ok(sections.find(section => section.id === 'article-history')?.entries.some(entry => entry.imageAssetId === 'photo-2'));
  assert.equal(sections[1].kind, 'photos');
  assert.equal(sections[2].kind, 'stories');
  const galleryIds = sections.filter(section => section.kind === 'photos').flatMap(section => section.entries.map(entry => entry.imageAssetId));
  assert.equal(new Set(galleryIds).size, galleryIds.length);
  assert.equal(galleryIds.length, 13, 'all non-logo photos remain browsable');
  assert.deepEqual(media, original, 'presentation never changes reviewed associations');
});
