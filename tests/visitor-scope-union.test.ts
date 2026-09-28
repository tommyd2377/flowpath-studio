import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskFixture } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { buildVisitorTaskView, executeVisitorCapability } from '../lib/visitor-capabilities';
import { VisitorTaskStore } from '../lib/visitor-task-store';
import { localTaskDocuments } from '../lib/task-persistence';

test('incoming scope guard permits peer unions with shared descendants and reads existing redundant scopes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-scope-union-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const space = taskFixture(); space.edges.push({ parentId: 'cross', childId: 'child' });
  const index = compileQueryIndex(space), store = new VisitorTaskStore(localTaskDocuments(directory));
  let session = await store.create(space.publication);
  buildVisitorTaskView({ index, session, signal: new AbortController().signal });
  // This previously accepted shape remains valid stored query state. Only new
  // setScope input is guarded; reading/refining it must not break hydration.
  session.queries[0].current.scope = { collectionId: 'root', traversal: 'explicitUnion', include: ['topic'], path: ['root'] };
  session = await store.save(session, session.revision);
  const patch = async (operations: unknown[]) => {
    session = await store.read(session.id, space.publication);
    const query = session.queries[0].current;
    return executeVisitorCapability({ index, store, sessionId: session.id, signal: new AbortController().signal, assertCurrent: async () => {},
      call: { capabilityId: 'query.patch', operationId: randomUUID(), expectedRevision: session.revision,
        input: { queryId: query.queryId, baseRevision: query.revision, operations } } });
  };
  const existing = await patch([{ op: 'setSearch', text: '' }]);
  assert.equal(existing.view.result.count.value, 8);
  assert.equal(existing.view.query.scope.collectionId, 'root');
  const peerScope = { collectionId: 'topic', traversal: 'explicitUnion', include: ['cross'], path: ['root', 'topic'] };
  const peers = await patch([{ op: 'setScope', scope: peerScope }]);
  assert.deepEqual(peers.view.query.scope, peerScope);
  assert.equal(peers.view.result.count.value, 8, 'Peer collections may share a descendant and overlapping records');
  const chosen = { collectionId: 'child', traversal: 'descendants', path: ['root', 'cross', 'child'] };
  assert.deepEqual((await patch([{ op: 'setScope', scope: chosen }])).view.query.scope, chosen, 'An explicit multi-parent breadcrumb remains authoritative');
});
