import assert from 'node:assert/strict';
import test from 'node:test';
import { applyWorkspaceBatch, emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { DEFAULT_EXPLORE_SETTINGS, type ExploreContext } from '../lib/explore-model';
import { exploreVoiceTool, validateExploreVoice } from '../lib/explore-voice';
import { sampleContent } from '../lib/site-model';
import { objectInput, publishedWorkspace, workspaceBatch } from '../lib/visitor-workspace';

const content = { ...sampleContent('general'), explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled: true, annotations: true } };
const context: ExploreContext = {
  resultId: 'current-results', kind: 'images', images: [{ id: 'image-1', caption: 'A published result' }],
  sources: [{ id: 'source-1', title: 'A returned source' }], selectedImageId: null, map: null,
};

test('voice searches accept an omitted unused id across search capabilities', () => {
  for (const kind of ['web', 'images', 'map'] as const) {
    const query = 'Public library visitor information';
    assert.deepEqual(validateExploreVoice({ kind, query }, content), {
      search: { kind, query, annotationTarget: undefined },
    });
    assert.deepEqual(validateExploreVoice({ kind, query, id: null }, content), validateExploreVoice({ kind, query }, content));
  }
});

test('voice result navigation accepts omitted unused query and id without another search', () => {
  for (const [kind, command] of [['back', 'back'], ['gallery', 'images'], ['sources', 'web'], ['zoom_in', 'zoom_in'], ['zoom_out', 'zoom_out']]) {
    for (const unused of [{}, { query: null }, { id: null }, { query: null, id: null }]) {
      assert.deepEqual(validateExploreVoice({ kind, ...unused }, content, context), { command: { kind: command } });
    }
  }
  for (const [kind, id] of [['open_image', 'image-1'], ['open_source', 'source-1']]) {
    assert.deepEqual(validateExploreVoice({ kind, id }, content, context), { command: { kind, id } });
  }
});

test('voice search normalization never supplies a required query or accepts an unrelated target', () => {
  for (const kind of ['web', 'images', 'map']) {
    for (const query of [undefined, null, '', '   ', 42, false, [], {}, 'x'.repeat(2001)]) {
      assert.throws(() => validateExploreVoice({ kind, query }, content));
    }
    assert.throws(() => validateExploreVoice({ kind, query: 'Library', id: 'image-1' }, content));
  }
});

test('voice navigation retains exact current-result references and rejects invented fields', () => {
  for (const [kind, id] of [['open_image', 'image-1'], ['open_source', 'source-1']]) {
    for (const target of [undefined, null, '', 'forged', 1, {}, 'https://example.org']) {
      assert.throws(() => validateExploreVoice({ kind, id: target }, content, context));
    }
    assert.throws(() => validateExploreVoice({ kind, id }, content));
    assert.throws(() => validateExploreVoice({ kind, id, query: 'Find something else' }, content, context));
  }
  assert.throws(() => validateExploreVoice({ kind: 'open_image', id: 'source-1' }, content, context));
  assert.throws(() => validateExploreVoice({ kind: 'open_source', id: 'image-1' }, content, context));
  for (const kind of ['back', 'gallery', 'sources', 'zoom_in', 'zoom_out']) {
    assert.throws(() => validateExploreVoice({ kind }, content));
    assert.throws(() => validateExploreVoice({ kind, id: 'image-1' }, content, context));
    assert.throws(() => validateExploreVoice({ kind, query: 'Library' }, content, context));
  }
  for (const input of [null, [], 'web', 42, {}, { kind: 'invented' }, { kind: 'web', query: 'Library', extra: true },
    { kind: 'back', arbitrary: null }, { kind: 'web', query: 'Library', id: false }]) {
    assert.throws(() => validateExploreVoice(input, content, context));
  }
});

test('voice annotations still require both a query and a current open published target', () => {
  const authority = publishedWorkspace(content), state = emptyWorkspace(authority.publicationId);
  const object = objectInput(authority.records.find(record => record.reference.kind === 'source')!);
  const opened = applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'add', object }]), authority).state;
  const input = { kind: 'annotate', query: 'Historical background', id: object.instanceId };
  assert.equal(validateExploreVoice(input, content, undefined, opened).search?.annotationTarget?.instanceId, object.instanceId);
  for (const invalid of [{ kind: 'annotate', query: input.query }, { kind: 'annotate', id: input.id },
    { ...input, id: 'forged' }, { ...input, query: null }, { ...input, id: null }]) {
    assert.throws(() => validateExploreVoice(invalid, content, undefined, opened));
  }
  assert.throws(() => validateExploreVoice(input, content, undefined, state));
  assert.throws(() => validateExploreVoice(input, { ...content, explore: { ...content.explore, annotations: false } }, undefined, opened));
});

test('omitted nullable fields never bypass published capability flags', () => {
  const disabled = { ...content, explore: { ...content.explore, enabled: false } };
  for (const input of [{ kind: 'web', query: 'Library' }, { kind: 'images', query: 'Library' }, { kind: 'map', query: 'Library' },
    { kind: 'back' }, { kind: 'gallery' }, { kind: 'sources' }, { kind: 'zoom_in' }, { kind: 'zoom_out' },
    { kind: 'open_image', id: 'image-1' }, { kind: 'open_source', id: 'source-1' }]) {
    assert.throws(() => validateExploreVoice(input, disabled, context));
  }
  const noImages = { ...content, explore: { ...content.explore, images: false } };
  assert.throws(() => validateExploreVoice({ kind: 'images', query: 'Library' }, noImages, context));
  assert.throws(() => validateExploreVoice({ kind: 'open_image', id: 'image-1' }, noImages, context));
  assert.throws(() => validateExploreVoice({ kind: 'map', query: 'Library' }, { ...content, explore: { ...content.explore, maps: false } }, context));
});

test('the advertised search tool retains required nullable fields and strict object properties', () => {
  assert.deepEqual(exploreVoiceTool.parameters.required, ['kind', 'query', 'id']);
  assert.equal(exploreVoiceTool.parameters.additionalProperties, false);
});
