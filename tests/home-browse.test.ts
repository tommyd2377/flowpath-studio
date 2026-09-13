import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkspaceBatch, emptyWorkspace, referenceKey, type WorkspaceScene } from '@thevoice/platform-ui/workspace';
import { semanticFixture as catalog, semanticMediaFixture as media } from '../fixtures/semantic-knowledge/graph';
import { sampleContent } from '../lib/site-model';
import { DEFAULT_OPENING, publicationContent } from '../lib/site-opening';
import { objectInput, openingWorkspace, explicitWorkspaceOpen, planWorkspaceIntent, publishedWorkspace, workspaceBatch } from '../lib/visitor-workspace';
import { visitorPageIntent } from '../lib/visitor-navigation';
import { contextualSearchQuery, searchPlacement } from '../lib/explore-workspace';
import { websiteSections } from '../lib/website-presentation';
import { validateVisitorContext, visitorNavigationSchema } from '../lib/visitor-realtime-context';
import { DEFAULT_EXPLORE_SETTINGS, demoExploreResult, exploreContextForResult } from '../lib/explore-model';

const content = { ...publicationContent(sampleContent('general', 'Harbor')), explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled: true } };
test('Home aliases and full website commands are local; ordinary back and content subjects are not Home', () => {
  for (const text of ['Home', 'Take me home', 'bring me back to the main page', 'take me to the beginning', 'Go back to the beginning please', 'start over', 'Please return to the home page.']) assert.equal(visitorPageIntent(text), 'home', text);
  for (const text of ['Show me the full website', 'Browse published content', 'Open the regular site']) assert.equal(visitorPageIntent(text), 'browse', text);
  for (const text of ['back', 'show home insurance', 'find images of a home', 'What is the homepage address?']) assert.equal(visitorPageIntent(text), null, text);
  assert.deepEqual(visitorNavigationSchema.parse({ kind: 'home' }), { kind: 'home' });
  assert.deepEqual(visitorNavigationSchema.parse({ kind: 'browse' }), { kind: 'browse' });
});
test('returning Home restores only publisher-selected opening references and clears focus history', () => {
  const selected = { ...content, opening: { ...DEFAULT_OPENING, visibility: 'publisher-selected' as const, featuredEntityIds: ['blue'] } };
  const authority = publishedWorkspace(selected, catalog, media), opening = openingWorkspace(authority, selected);
  const other = objectInput(authority.records.find(record => record.reference.id === 'mira')!);
  const changed = applyWorkspaceBatch(opening, workspaceBatch(opening, [{ kind: 'add', object: other }, { kind: 'focus', instanceId: other.instanceId }]), authority).state;
  const home = applyWorkspaceBatch(changed, workspaceBatch(changed, [{ kind: 'replace', objects: opening.objects.map(({ instanceId, component, references }) => ({ instanceId, component, references })) }]), authority).state;
  assert.deepEqual(home.objects.flatMap(object => object.references.map(ref => ref.id)), ['blue']);
  assert.equal(home.focusedId, null); assert.deepEqual(home.focusHistory, []);
});
test('new model IDs for identical cards resolve to the existing instance within the same atomic batch', () => {
  const authority = publishedWorkspace(content, catalog), initial = emptyWorkspace(authority.publicationId);
  const record = authority.records.find(record => record.reference.id === 'blue')!;
  const first = objectInput(record, 'detail', 'first');
  const state = applyWorkspaceBatch(initial, workspaceBatch(initial, [{ kind: 'add', object: first }]), authority).state;
  const result = applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'add', object: { ...first, instanceId: 'generated-again' } }, { kind: 'focus', instanceId: 'generated-again' }]), authority);
  assert.equal(result.state.objects.length, 1); assert.equal(result.state.focusedId, 'first');
  assert.equal(result.aliases?.['generated-again'], 'first');
  assert.throws(() => applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'add', object: { ...first, references: [{ ...first.references[0], id: 'white' }] } }]), authority), /different content/);
});
test('website navigation deduplicates overlapping collections and groups equal names without merging facts', () => {
  const graph = structuredClone(catalog);
  graph.entities.push({ ...graph.entities.find(entity => entity.id === 'blue')!, id: 'another-blue', attributes: { price: 900 }, summary: 'A different published account.' });
  graph.collections.push({ id: 'overlap', name: 'Overlapping selection', entityIds: ['blue', 'another-blue', 'white'] });
  const authority = publishedWorkspace(content, graph, media), before = JSON.stringify(graph);
  const sections = websiteSections(authority, content, graph, media), entries = sections.flatMap(section => section.entries);
  assert.equal(entries.filter(entry => entry.name === 'Blue Bowl').length, 1);
  assert.equal(entries.some(entry => entry.id.startsWith('fact:')), false);
  assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
  const plan = explicitWorkspaceOpen('Open Blue Bowl', emptyWorkspace(authority.publicationId), authority, graph)!;
  assert.ok(plan.batch); assert.equal(plan.batch.operations[0].kind, 'add');
  const opened = applyWorkspaceBatch(emptyWorkspace(authority.publicationId), plan.batch, authority).state;
  assert.deepEqual(opened.objects[0].references.map(ref => ref.id), ['blue', 'another-blue']);
  assert.equal(JSON.stringify(graph), before);
});
test('search history rotates temporary results only; fully published capacity is checked before a search', () => {
  const results = Array.from({ length: 6 }, (_, index) => exploreContextForResult({ ...demoExploreResult(`Set ${index}`, 'web'), id: `result-${index}` }));
  const authority = publishedWorkspace(content, catalog, media, results);
  let state = emptyWorkspace(authority.publicationId);
  for (const record of authority.records.filter(record => record.reference.kind === 'external')) state = applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'add', object: objectInput(record) }]), authority).state;
  assert.deepEqual(searchPlacement(state, results), { close: ['external-external-result-0'], retired: ['result-0'] });
  const published = authority.records.filter(record => record.reference.kind !== 'external');
  state = emptyWorkspace(authority.publicationId);
  for (const record of published.slice(0, 12)) state = applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'add', object: objectInput(record) }]), authority).state;
  assert.throws(() => searchPlacement(state, results), /no search was sent/);
  assert.equal(state.objects.length, 12);
  const reset = emptyWorkspace(authority.publicationId);
  assert.deepEqual(searchPlacement(reset, results), { close: [], retired: [] });
});
test('full website ordinals use measured visible references, and private browse references are rejected', () => {
  const authority = publishedWorkspace(content, catalog, media), state = emptyWorkspace(authority.publicationId);
  const visible = ['white', 'blue'].map(id => authority.records.find(record => record.reference.kind === 'entity' && record.reference.id === id)!);
  const scene: WorkspaceScene = { revision: 4, workspaceRevision: state.revision, visibility: 'visible', focusedId: null, page: 'browse', objects: [], browseItems: visible.map((record, index) => ({ reference: record.reference, order: index + 1 })) };
  const result = planWorkspaceIntent('Open the second one', state, authority, scene, catalog, media);
  assert.ok(result.batch);
  const next = applyWorkspaceBatch(state, result.batch, authority, scene.revision).state;
  assert.equal(referenceKey(next.objects[0].references[0]), referenceKey(visible[1].reference));
  validateVisitorContext({ workspace: state, scene }, content, catalog, media);
  assert.throws(() => validateVisitorContext({ workspace: state, scene: { ...scene, browseItems: [{ reference: { ...visible[0].reference, id: 'private' }, order: 1 }] } }, content, catalog, media));
});

test('deictic image and web queries carry the focused published topic without guessing', () => {
  const authority = publishedWorkspace(content, catalog), state = emptyWorkspace(authority.publicationId);
  const object = objectInput(authority.records.find(record => record.reference.id === 'blue')!);
  const opened = applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'add', object }, { kind: 'focus', instanceId: object.instanceId }]), authority).state;
  assert.match(contextualSearchQuery('Find images online of this item', opened, authority), /Find images online of Blue Bowl/);
  assert.equal(contextualSearchQuery('Search the web for weather this week', opened, authority), 'Search the web for weather this week');
  assert.throws(() => contextualSearchQuery('Search for images of it', state, authority), /No search was sent/);
});
