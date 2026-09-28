import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkspaceBatch, emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { semanticFixture, semanticMediaFixture } from '../fixtures/semantic-knowledge/graph';
import { sampleContent } from '../lib/site-model';
import { objectInput, parseWorkspaceReply, parseWorkspaceToolReply, publishedWorkspace, workspaceBatch, workspaceInstructions, workspaceToolJsonSchema } from '../lib/visitor-workspace';
import { requiresWebsiteQuery } from '../lib/visitor-task-bridge';

const content = sampleContent('general');
const authority = publishedWorkspace(content, semanticFixture, semanticMediaFixture);
const state = emptyWorkspace(authority.publicationId);
const album = authority.records.find(record => record.reference.kind === 'album')!;
const object = objectInput(album);
const proposal = { batch: { sceneRevision: null, operations: [{ kind: 'add', object }, { kind: 'focus', instanceId: object.instanceId }] }, clarification: '' };

test('task display tools advertise photos and sources while routing record details through the task owner', () => {
  const components: string[][] = [];
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'component' && child && typeof child === 'object' && 'enum' in child) components.push(child.enum as string[]);
      else inspect(child);
    }
  };
  inspect(workspaceToolJsonSchema(true)); assert.ok(components.length);
  for (const allowed of components) {
    for (const name of ['detail', 'collection', 'comparison']) assert.ok(!allowed.includes(name));
    for (const name of ['information', 'photo', 'gallery', 'chart']) assert.ok(allowed.includes(name));
  }
  const guide = workspaceInstructions(state, authority, undefined, 'Bring up the address', semanticFixture, semanticMediaFixture, 'tool', true);
  assert.match(guide, /visitor_task record.detail/);
  assert.doesNotMatch(guide, /For show\/open\/pull up, add the matching object/);
  const detail = objectInput(authority.records.find(record => record.reference.kind === 'entity')!);
  for (const operations of [[{ kind: 'add' as const, object: detail }], [{ kind: 'replace' as const, objects: [detail] }], [{ kind: 'reset' as const, objects: [detail] }], [{ kind: 'update' as const, ...detail }]]) {
    assert.equal(requiresWebsiteQuery(workspaceBatch(state, operations)), true);
  }
  assert.equal(requiresWebsiteQuery(workspaceBatch(state, [{ kind: 'add', object }])), false);
  assert.ok(JSON.stringify(workspaceToolJsonSchema()).includes('"detail"'), 'Legacy non-task callers keep their components');
});

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
  assert.equal(schema.includes('"revisionId"'), false, 'The server binds content revisions from the published snapshot');
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


test('compact tool references resolve exact public identities without model-copied revisions', () => {
  const photo = authority.records.find(record => record.reference.kind === 'photo')!;
  const compact = { kind: photo.reference.kind, id: photo.reference.id };
  const gallery = { instanceId: 'requested-gallery', component: 'gallery', references: [compact] };
  const raw = { batch: { sceneRevision: null, operations: [{ kind: 'replace', objects: [gallery] }] }, clarification: '' };
  const accepted = parseWorkspaceToolReply(raw, state, authority).batch!;
  assert.deepEqual(applyWorkspaceBatch(state, accepted, authority).state.objects[0].references, [photo.reference]);
  assert.equal('revisionId' in compact, false);
  for (const reference of [{ kind: 'photo', id: 'private-photo' }, { ...photo.reference, revisionId: 'mistyped-revision' }]) {
    assert.throws(() => parseWorkspaceToolReply({ batch: { operations: [{ kind: 'replace', objects: [{ ...gallery, references: [reference] }] }] }, clarification: '' }, state, authority));
  }
  const changed = publishedWorkspace(content, semanticFixture, { ...semanticMediaFixture, id: 'new-media-revision' });
  assert.throws(() => applyWorkspaceBatch(state, accepted, changed), /publication changed/);
});

test('compact add and update bind origin and object references while preserving scene checks', () => {
  const photo = authority.records.find(record => record.reference.kind === 'photo')!;
  const compactPhoto = { kind: photo.reference.kind, id: photo.reference.id };
  const compactAlbum = { kind: album.reference.kind, id: album.reference.id };
  const scene = { revision: 7, workspaceRevision: state.revision, visibility: 'visible' as const, focusedId: null, objects: [] };
  const raw = { batch: { sceneRevision: scene.revision, operations: [{ kind: 'add',
    object: { instanceId: 'compact-photo-gallery', component: 'gallery', references: [compactPhoto] },
    origin: { objectId: null, reference: compactAlbum, focusKey: '', scrollTop: 0 } }] }, clarification: '' };
  const original = structuredClone(raw);
  const added = parseWorkspaceToolReply(raw, state, authority, scene).batch!;
  const opened = applyWorkspaceBatch(state, added, authority, scene.revision).state;
  assert.deepEqual(opened.objects[0].references, [photo.reference]);
  assert.deepEqual(opened.objects[0].origin?.reference, album.reference);
  assert.deepEqual(raw, original);
  assert.throws(() => applyWorkspaceBatch(state, added, authority, scene.revision + 1), /workspace changed/);
  const updated = parseWorkspaceToolReply({ batch: { operations: [{ kind: 'update', instanceId: opened.objects[0].instanceId,
    component: 'gallery', references: [compactAlbum] }] }, clarification: '' }, opened, authority).batch!;
  assert.deepEqual(applyWorkspaceBatch(opened, updated, authority).state.objects[0].references, [album.reference]);
});

test('compact binding rejects ambiguous, mixed or partially supplied authority without repairing legacy batches', () => {
  const photo = authority.records.find(record => record.reference.kind === 'photo')!;
  const compact = { kind: photo.reference.kind, id: photo.reference.id };
  const item = { instanceId: 'compact-gallery', component: 'gallery', references: [compact] };
  const raw = { batch: { operations: [{ kind: 'add', object: item }] }, clarification: '' };
  const originalState = structuredClone(state);
  const ambiguous = { ...authority, records: [...authority.records, { ...photo, reference: { ...photo.reference, revisionId: 'another-revision' } }] };
  assert.throws(() => parseWorkspaceToolReply(raw, state, ambiguous), 'A kind/id collision never chooses a revision');
  for (const references of [
    [compact, { kind: 'photo', id: 'private-photo' }],
    [compact, compact],
    [{ ...compact, revisionId: null }],
    [{ ...compact, kind: 'source' }],
  ]) assert.throws(() => parseWorkspaceToolReply({ batch: { operations: [{ kind: 'add', object: { ...item, references } }] }, clarification: '' }, state, authority));
  for (const [field, value] of Object.entries({ schemaVersion: 1, requestId: 'supplied-request', publicationId: state.publicationId, baseRevision: state.revision })) {
    assert.throws(() => parseWorkspaceToolReply({ ...raw, batch: { ...raw.batch, [field]: value } }, state, authority), `Partial ${field} is never repaired`);
  }
  const legacy = workspaceBatch(state, [{ kind: 'add', object }]);
  assert.throws(() => parseWorkspaceToolReply({ batch: { ...legacy, operations: raw.batch.operations }, clarification: '' }, state, authority), 'Legacy batches must supply their own complete references');
  assert.deepEqual(state, originalState, 'No failed batch partially changes the current view');
  assert.equal('revisionId' in compact, false, 'Failed binding does not mutate provider input');
});
