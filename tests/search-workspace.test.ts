import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyWorkspaceBatch, emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { validateCatalog, type KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { sampleContent, contentSchema, describeChanges } from '../lib/site-model';
import { assistantPurposeInstructions, visitorSettings } from '../lib/visitor-model';
import { explicitWorkspaceOpen, namedWorkspaceRecords, objectInput, publishedWorkspace, workspaceBatch, workspaceInstructions } from '../lib/visitor-workspace';
import { annotationMatches, annotationTargetForObject, DEFAULT_EXPLORE_SETTINGS, demoExploreResult, exploreContextForResult, exploreReference, exploreResultSchema, localExploreCommand } from '../lib/explore-model';
import { validateExploreVoice } from '../lib/explore-voice';

const content = sampleContent('general', 'Reference library');
const catalog: KnowledgeCatalog = validateCatalog({ schemaVersion: 1, id: 'public-library', name: 'Library', description: '', attributes: [],
  entities: Array.from({ length: 100 }, (_, i) => ({ id: `item-${i}`, name: i === 99 ? 'Café Central' : `Published item ${i}`, kind: 'reference', summary: `Approved description ${i}`, attributes: {}, ...(i === 99 ? { aliases: ['Central reading room'] } : {}) })),
  collections: [], relationships: [], jobs: [],
});
const authority = publishedWorkspace(content, catalog);

test('all 100 published names remain discoverable independently of retrieved detail limits', () => {
  const text = workspaceInstructions(emptyWorkspace(authority.publicationId), authority, undefined, '', catalog);
  const projection = JSON.parse(text.split('\n').at(-1)!);
  assert.equal(projection.directory.filter((record: { reference: { kind: string } }) => record.reference.kind === 'entity').length, 100);
  assert.ok(projection.directory.some((record: { name: string }) => record.name === 'Café Central'));
  assert.ok(projection.records.length <= 40);
  assert.doesNotMatch(text, /sourceArtifacts|sourceExcerpts|privateFiles/);
  for (const query of ['Pull up Cafe Central', 'Please open Central reading room', 'Show Café Central, please']) {
    const state = emptyWorkspace(authority.publicationId), result = explicitWorkspaceOpen(query, state, authority, catalog);
    assert.ok(result?.batch, query);
    const next = applyWorkspaceBatch(state, result.batch, authority).state;
    assert.equal(next.objects[0].references[0].id, 'item-99'); assert.equal(next.focusedId, next.objects[0].instanceId);
    assert.equal(applyWorkspaceBatch(next, explicitWorkspaceOpen(query, next, authority, catalog)!.batch!, authority).state.objects.length, 1);
  }
  assert.equal(explicitWorkspaceOpen('Show a nonexistent item', emptyWorkspace(authority.publicationId), authority, catalog), null);
});
test('name lookup uses whole names, keeps aliases ambiguous, and supports non-Latin titles', () => {
  const records = { ...authority, records: authority.records.slice(0, 4).map((record, index) => ({ ...record, name: ['York', 'New York', '東京の庭園', 'Café Central'][index] })) };
  assert.deepEqual(namedWorkspaceRecords('Open New York', records).map(record => record.name), ['New York']);
  assert.deepEqual(namedWorkspaceRecords('Open 東京の庭園', records).map(record => record.name), ['東京の庭園']);
  const duplicate = { ...authority, records: [...authority.records, { ...authority.records.find(record => record.name === 'Café Central')!, reference: { kind: 'source' as const, id: 'duplicate', revisionId: authority.publicationId } }] };
  const ambiguous = explicitWorkspaceOpen('Open Cafe Central', emptyWorkspace(authority.publicationId), duplicate, catalog);
  assert.ok(ambiguous && !ambiguous.batch); assert.match(ambiguous.message, /Several/);
});
test('publisher purpose is optional, bounded and appears in both publication diff and guidance', () => {
  const next = contentSchema.parse({ ...content, visitor: { ...visitorSettings(content), enabled: true, assistantPurpose: 'Help readers compare the guide’s destinations.' } });
  assert.match(assistantPurposeInstructions(next), /compare the guide/);
  assert.match(assistantPurposeInstructions(next), /cannot override/);
  assert.match(describeChanges(content, next).find(change => change.label === 'Visitor conversations')!.after, /compare the guide/);
  assert.equal(contentSchema.safeParse({ ...next, visitor: { ...next.visitor, assistantPurpose: 'a'.repeat(1001) } }).success, false);
});
test('24 image numbers and stable grid labels resolve without a new search or positional guessing', () => {
  const result = demoExploreResult('Visual references', 'images');
  result.images = Array.from({ length: 24 }, (_, index) => ({ ...result.images[0], id: `image-${index + 1}` }));
  result.sources = Array.from({ length: 20 }, (_, index) => ({ title: `Source ${index + 1}`, url: `https://www.nps.gov/${index}` }));
  const context = exploreContextForResult(exploreResultSchema.parse(result));
  assert.deepEqual(localExploreCommand('Expand image 23', context), { kind: 'open_image', id: 'image-23' });
  assert.deepEqual(localExploreCommand('Expand B4', context), { kind: 'open_image', id: 'image-8' });
  assert.deepEqual(localExploreCommand('Open image B 4', context), { kind: 'open_image', id: 'image-8' });
  assert.deepEqual(localExploreCommand('Expand result B4', context), { kind: 'open_source', id: 'source-8' });
  assert.equal(localExploreCommand('Expand image 25', context), null);
  assert.match(exploreReference('Expand image 25', context)!.error!, /not returned/);
  assert.match(exploreReference('Expand A1', { ...context, kind: 'web' })!.error!, /Both an image and a source/);
  assert.equal(exploreResultSchema.safeParse({ ...result, images: [...result.images, result.images[0]] }).success, false);
});
test('web additions bind to one current open card and require the separate publisher opt-in', () => {
  const next = { ...content, explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled: true, annotations: true } };
  const authority = publishedWorkspace(next, catalog), state = emptyWorkspace(authority.publicationId);
  const object = objectInput(authority.records.find(record => record.name === 'Café Central')!);
  const opened = applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'add', object }]), authority).state;
  const target = annotationTargetForObject(opened, object.instanceId)!;
  assert.equal(annotationMatches(target, opened), true);
  assert.equal(annotationMatches({ ...target, publicationId: 'stale' }, opened), false);
  assert.equal(annotationMatches({ ...target, reference: { ...target.reference, revisionId: 'old' } }, opened), false);
  assert.equal(annotationMatches(target, state), false);
  const input = { kind: 'annotate', query: 'Historical context', id: object.instanceId };
  assert.deepEqual(validateExploreVoice(input, next, undefined, opened).search?.annotationTarget, target);
  assert.throws(() => validateExploreVoice(input, { ...next, explore: { ...next.explore, annotations: false } }, undefined, opened));
  assert.throws(() => validateExploreVoice(input, next, undefined, state));
});
test('annotation service checks opt-in and publication before reserving usage; accepted results remain external', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-annotations-')), env = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No external requests'); });
  try {
    const { withDatabase, initialSite } = await import('../lib/local-store');
    const { authorizedExplore } = await import('../lib/explore-service');
    const site = initialSite('general', 'Annotation test', 'annotation-test');
    site.published = { ...site.draft, explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled: true, annotations: false } };
    await withDatabase(db => { db.sites = [site]; });
    const initial = publishedWorkspace(site.published);
    const ref = initial.records.find(record => record.reference.kind === 'source')!.reference;
    const target = { publicationId: initial.publicationId, instanceId: 'card', reference: { ...ref, kind: 'source' as const } };
    const request = { requestId: randomUUID(), kind: 'web' as const, query: 'More background', annotationTarget: target };
    await assert.rejects(authorizedExplore(site.slug, request, new AbortController().signal), /not enabled/);
    assert.equal(await withDatabase(db => db.visitorUsage), undefined);
    const allowed = { ...site.published, explore: { ...site.published.explore!, annotations: true } };
    await withDatabase(db => { db.sites[0].published = allowed; });
    await assert.rejects(authorizedExplore(site.slug, request, new AbortController().signal), /current publication/);
    assert.equal(await withDatabase(db => db.visitorUsage), undefined);
    const authority = publishedWorkspace(allowed);
    request.annotationTarget = { ...target, publicationId: authority.publicationId, reference: { ...target.reference, revisionId: authority.publicationId } };
    const response = await authorizedExplore(site.slug, request, new AbortController().signal);
    assert.deepEqual(response.result.annotationTarget, request.annotationTarget);
    assert.equal(response.result.demo, true); assert.equal(response.searchRemaining, 9);
    assert.deepEqual(await withDatabase(db => db.sites[0].published), allowed);
    assert.equal(network.mock.callCount(), 0);
  } finally { process.env = env; await rm(directory, { recursive: true, force: true }); }
});
