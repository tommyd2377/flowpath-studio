import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkspaceBatch, emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { semanticFixture as catalog } from '../fixtures/semantic-knowledge/graph';
import { sampleContent } from '../lib/site-model';
import { objectInput, planWorkspaceIntent, publishedWorkspace, workspaceBatch } from '../lib/visitor-workspace';

test('an unmatched request offers retry and accessible dismissal without discarding the current view', () => {
  const authority = publishedWorkspace(sampleContent('general'), catalog);
  const empty = emptyWorkspace(authority.publicationId);
  const record = authority.records.find(entry => entry.reference.kind === 'entity' && entry.reference.id === 'blue')!;
  const current = applyWorkspaceBatch(empty, workspaceBatch(empty, [
    { kind: 'add', object: objectInput(record, record.component, 'current-item') },
    { kind: 'focus', instanceId: 'current-item' },
  ]), authority).state;

  for (const state of [empty, current]) {
    const original = structuredClone(state);
    const reply = planWorkspaceIntent('Do you offer tailoring?', state, authority, undefined, catalog);
    assert.equal(reply.batch, undefined);
    assert.match(reply.message, /couldn’t match that request/);
    assert.match(reply.message, /Try a more specific name/);
    assert.match(reply.message, /“Close assistant” to return to the website/);
    assert.doesNotMatch(reply.message, /not provided|browse.*below/i);
    assert.deepEqual(state, original, 'clarification keeps the existing approved view available');
  }
});
