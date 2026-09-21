import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkspaceBatch, emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { semanticFixture, semanticMediaFixture } from '../fixtures/semantic-knowledge/graph';
import { sampleContent } from '../lib/site-model';
import { objectInput, parseWorkspaceReply, parseWorkspaceToolReply, publishedWorkspace, workspaceBatch, workspaceInstructions, workspaceToolJsonSchema } from '../lib/visitor-workspace';

const content = sampleContent('general');
const authority = publishedWorkspace(content, semanticFixture, semanticMediaFixture);
const state = emptyWorkspace(authority.publicationId);
const album = authority.records.find(record => record.reference.kind === 'album')!;
const object = objectInput(album);
const proposal = { batch: { sceneRevision: null, operations: [{ kind: 'add', object }, { kind: 'focus', instanceId: object.instanceId }] }, clarification: '' };

test('the task photo collection opens the same approved assets through workspace tools', () => {
  const photos = authority.records.find(record => record.reference.kind === 'collection' && record.reference.id === 'published-photos')!;
  const gallery = objectInput(photos);
  assert.equal(gallery.component, 'gallery');
  assert.deepEqual(photos.members?.map(ref => ref.id), semanticMediaFixture.assets.map(asset => asset.id));
  const apply = (references = gallery.references) => applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'add', object: { ...gallery, references } }]), authority);
  assert.equal(apply().state.objects[0].component, 'gallery');
  assert.throws(() => apply([{ ...photos.reference, revisionId: 'unpublished' }]));
  const changed = publishedWorkspace(content, semanticFixture, { ...semanticMediaFixture, id: 'different-media-revision' });
  assert.throws(() => applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'add', object: gallery }]), changed), /publication changed/);
  const collision = publishedWorkspace(content, { ...semanticFixture, collections: [...semanticFixture.collections, { ...structuredClone(semanticFixture.collections[0]), id: 'published-photos' }] }, semanticMediaFixture);
  assert.equal(collision.records.find(record => record.reference.id === 'media-published-photos-1')?.component, 'gallery');
});

test('photo tools leave publication and request bookkeeping to the server', () => {
  const schema = JSON.stringify(workspaceToolJsonSchema());
  for (const field of ['schemaVersion', 'requestId', 'publicationId', 'baseRevision']) assert.equal(schema.includes(`"${field}"`), false, field);
  assert.ok(schema.includes('"sceneRevision"'));
  assert.ok(schema.includes('"revisionId"'), 'Published content references still require their exact revision');
  assert.match(workspaceInstructions(state, authority, undefined, 'Show me your photos', semanticFixture, semanticMediaFixture, 'tool'), /The server supplies schemaVersion/);
  // Reproduce the former failure when a model copied a media/catalog revision
  // into the full workspace publication field.
  const old = { ...proposal, batch: { ...workspaceBatch(state, [{ kind: 'add', object }]), publicationId: semanticMediaFixture.id } };
  assert.throws(() => parseWorkspaceReply(old, state, authority), /publication changed/);
  assert.throws(() => parseWorkspaceToolReply(old, state, authority), /publication changed/, 'Legacy invalid batches are never repaired');
  const accepted = parseWorkspaceToolReply(proposal, state, authority).batch!;
  assert.equal(accepted.publicationId, authority.publicationId);
  assert.equal(accepted.baseRevision, state.revision);
  assert.match(accepted.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(applyWorkspaceBatch(state, accepted, authority).state.focusedId, object.instanceId);
  assert.equal('publicationId' in proposal.batch, false, 'Parsing does not mutate the model proposal');
});

test('server-bound photo operations still reject changed views and unapproved media', () => {
  const accepted = parseWorkspaceToolReply(proposal, state, authority).batch!;
  const changed = applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'reset', objects: [] }]), authority).state;
  assert.throws(() => applyWorkspaceBatch(changed, accepted, authority), /workspace changed/);
  const changedPublication = publishedWorkspace({ ...content, headline: 'A newly published headline' }, semanticFixture, semanticMediaFixture);
  assert.throws(() => applyWorkspaceBatch(state, accepted, changedPublication), /publication changed/);
  for (const reference of [{ ...album.reference, id: 'unpublished-photo' }, { ...album.reference, revisionId: 'private-revision' }]) {
    const invalid = { batch: { operations: [{ kind: 'add', object: { ...object, references: [reference] } }] }, clarification: '' };
    assert.throws(() => parseWorkspaceToolReply(invalid, state, authority));
  }
  assert.throws(() => parseWorkspaceToolReply({ ...proposal, batch: { ...proposal.batch, baseRevision: 0 } }, state, authority), 'Partial legacy identity cannot bypass validation');
});

test('strict tool nulls omit only optional chart fields across object operations', () => {
  for (const kind of ['add', 'replace'] as const) {
    const item = { ...object, metric: null };
    const operation = kind === 'add' ? { kind, object: item, origin: null } : { kind, objects: [item] };
    const raw = { batch: { sceneRevision: null, operations: [operation] }, clarification: '' };
    const original = structuredClone(raw);
    const batch = parseWorkspaceToolReply(raw, state, authority).batch!;
    assert.equal(applyWorkspaceBatch(state, batch, authority).state.objects[0].metric, undefined);
    assert.deepEqual(raw, original, 'Provider observations remain intact');
  }
  for (const invalid of [{ ...object, metric: 'unapproved' }, { ...object, references: null }, { ...object, unexpected: null }]) {
    assert.throws(() => parseWorkspaceToolReply({ batch: { operations: [{ kind: 'add', object: invalid }] }, clarification: '' }, state, authority));
  }
  assert.throws(() => parseWorkspaceToolReply({ batch: { operations: [{ kind: 'reset', objects: [{ ...object, metric: null }] }] }, clarification: '' }, state, authority), /Reset must be empty/);
});
