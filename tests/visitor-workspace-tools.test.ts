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
