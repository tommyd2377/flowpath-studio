import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkspaceBatch, emptyWorkspace, type WorkspaceScene } from '@thevoice/platform-ui/workspace';
import { semanticFixture as catalog, semanticMediaFixture as media } from '../fixtures/semantic-knowledge/graph';
import { sampleContent } from '../lib/site-model';
import { objectInput, planWorkspaceIntent, publishedWorkspace, workspaceBatch } from '../lib/visitor-workspace';
import { workspaceControlIntent } from '../lib/visitor-workspace-command';

test('ordinary factual questions and conversational confirmations are not UI commands', () => {
  for (const question of [
    'What time do you close on Saturday?', 'Then a Nashville restaurant buyout is definitely offered too, right?',
    'How close are you to Penn Station?', 'Are you open right now?', 'Is the second payment refundable?',
    'Which class is bigger?', 'Does the smaller pizza cost less?', 'Can you close on Sundays?',
    'Can you close for Christmas?', 'Will you close for Christmas?', 'Will you close over Christmas?',
    'Will you close tomorrow?', 'Could you expand on the refund policy?',
    'What is the right choice for me?', 'Tell me more context about catering.', 'Show me the second payment deadline.',
    'Can you show me the right class for beginners?', 'Do I need to reset my password?', 'Return policy?', 'Right?',
  ]) assert.equal(workspaceControlIntent(question), null, question);
});

test('explicit controls preserve polite phrasing, named targets, spatial requests and focused-object actions', () => {
  const commands = {
    'Close the map but keep the photo': 'close', 'Close White Bowl': 'close', 'Please dismiss this card.': 'close',
    'Could you please close that photo?': 'close', 'Please could you close that photo?': 'close', 'I want to close the card': 'close', "I'm done with this photo": 'close', 'Close': 'close',
    'Make that photo bigger': 'expand', 'Would you expand the card, please?': 'expand', 'More context': 'expand',
    'Make this card smaller': 'collapse', 'Collapse': 'collapse', 'Move right': 'focus', 'Focus on the photo': 'show',
    'Open the second photo': 'show', 'Can you show me the first one?': 'show', 'The third one': 'focus',
    'The card on the right': 'focus', 'Move to the card on the right': 'focus', 'Highlight White Bowl': 'show', 'Go back': 'return', 'Please reset the workspace': 'reset',
    'Open that one': 'show', 'Show this one': 'show', 'Can you open that one?': 'show',
    'Bigger': 'expand', 'Smaller': 'collapse', 'Could you close this panel for me?': 'close',
    'Open the first photo from Items collection': 'show', 'Show the second photo in Items collection': 'show',
  } as const;
  for (const [text, expected] of Object.entries(commands)) assert.equal(workspaceControlIntent(text), expected, text);
});

test('question words neither close nor focus an existing workspace object', () => {
  const authority = publishedWorkspace(sampleContent('general'), catalog, media);
  const record = authority.records.find(entry => entry.reference.kind === 'entity' && entry.reference.id === 'blue')!;
  const initial = emptyWorkspace(authority.publicationId);
  const state = applyWorkspaceBatch(initial, workspaceBatch(initial, [{ kind: 'add', object: objectInput(record, record.component, 'visible-card') }, { kind: 'focus', instanceId: 'visible-card' }]), authority).state;
  for (const question of ['What time do you close on Saturday?', 'Then a Nashville restaurant buyout is definitely offered too, right?', 'Can you close for Christmas?', 'Will you close for Christmas?', 'Will you close tomorrow?', 'Could you expand on the refund policy?']) {
    const reply = planWorkspaceIntent(question, state, authority, undefined, catalog, media);
    assert.equal(reply.batch, undefined, question);
    assert.notEqual(reply.message, 'Which open object do you mean? Choose its title or open it with its control.');
    assert.equal(state.focusedId, 'visible-card');
    assert.equal(state.objects.length, 1);
  }
  const close = planWorkspaceIntent('Could you please close Blue Bowl?', state, authority, undefined, catalog, media);
  assert.ok(close.batch, close.message);
  assert.deepEqual(close.batch.operations, [{ kind: 'close', instanceId: 'visible-card' }]);
});

test('deictic opens and standalone resize commands keep their observed workspace operations', () => {
  const authority = publishedWorkspace(sampleContent('general'), catalog, media);
  const record = authority.records.find(entry => entry.reference.kind === 'entity' && entry.reference.id === 'blue')!;
  const initial = emptyWorkspace(authority.publicationId);
  let state = applyWorkspaceBatch(initial, workspaceBatch(initial, [{ kind: 'add', object: objectInput(record, record.component, 'visible-card') }, { kind: 'focus', instanceId: 'visible-card' }]), authority).state;
  const scene = (): WorkspaceScene => ({ revision: 1, workspaceRevision: state.revision, focusedId: state.focusedId, visibility: 'visible', objects: [{ instanceId: 'visible-card', name: record.name, references: [record.reference], order: 1, mounted: true, open: true, expanded: state.objects[0].expanded, selected: false, visibility: 'full', position: 'center', rect: { x: 0, y: 0, width: 250, height: 200 }, controls: ['focus', 'expand', 'collapse', 'close'], scroll: null }] });
  for (const text of ['Can you close for Christmas?', 'Will you close for Christmas?', 'Will you close tomorrow?', 'Could you expand on the refund policy?']) {
    assert.equal(planWorkspaceIntent(text, state, authority, scene(), catalog, media).batch, undefined, text);
  }
  for (const text of ['Open that one', 'Show this one', 'Can you open that one?']) {
    const result = planWorkspaceIntent(text, state, authority, scene(), catalog, media);
    assert.ok(result.batch, result.message);
    assert.deepEqual(result.batch.operations, [{ kind: 'focus', instanceId: 'visible-card' }]);
  }
  for (const [text, expanded] of [['Bigger', true], ['Smaller', false]] as const) {
    const observed = scene(), result = planWorkspaceIntent(text, state, authority, observed, catalog, media);
    assert.ok(result.batch, result.message);
    state = applyWorkspaceBatch(state, result.batch, authority, observed.revision).state;
    assert.equal(state.objects[0].expanded, expanded, text);
  }
  const close = planWorkspaceIntent('Could you close this panel for me?', state, authority, scene(), catalog, media);
  assert.ok(close.batch, close.message);
  assert.deepEqual(close.batch.operations, [{ kind: 'close', instanceId: 'visible-card' }]);
});

test('explicit expand still opens an ordinal from the observed browse page', () => {
  const authority = publishedWorkspace(sampleContent('general'), catalog, media);
  const record = authority.records.find(entry => entry.reference.kind === 'entity' && entry.reference.id === 'blue')!;
  const state = emptyWorkspace(authority.publicationId);
  const scene: WorkspaceScene = { revision: 1, workspaceRevision: state.revision, focusedId: null, visibility: 'visible', objects: [], page: 'browse', browseItems: [{ reference: record.reference, order: 1 }] };
  const result = planWorkspaceIntent('Could you expand the first card?', state, authority, scene, catalog, media);
  assert.ok(result.batch, result.message);
  assert.deepEqual(result.batch.operations.map(operation => operation.kind), ['add', 'focus']);
  assert.equal(result.batch.sceneRevision, scene.revision);
});
