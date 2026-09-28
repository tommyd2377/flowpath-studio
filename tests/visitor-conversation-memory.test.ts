import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskFixture } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { demoExploreResult, exploreResultSchema, DEFAULT_EXPLORE_SETTINGS, type ExploreResult } from '../lib/explore-model';
import { visitorConversationMemory, retainVisitorConversationResearch, recallVisitorConversationResearch, visitorConversationResearchHistory, visitorResearchHistorySchema, VISITOR_RESEARCH_MEMORY_BYTES, type VisitorResearchMemory } from '../lib/visitor-conversation-memory';
import { VisitorTaskStore, confirmVisitorView, retainTaskSurface, restoreTaskSurface } from '../lib/visitor-task-store';
import { buildVisitorTaskView, executeVisitorCapability } from '../lib/visitor-capabilities';
import { resolveEvidence } from '../lib/visitor-evidence-store';
import type { TaskDocuments } from '../lib/task-persistence';
import { createVisitorTaskBridge, readVisitorConversationMemory } from '../lib/visitor-task-bridge';
import { visitorTaskContext } from '../lib/visitor-task-context';

const source = { title: 'Synthetic visitor policy', url: 'https://fixtures.example.org/visitor-policy' };
function finding(id: string, query = 'Group reservation conditions', answer = 'A 7.25% deposit applies to advance group reservations; walk-in visits are excluded.'): ExploreResult {
  return exploreResultSchema.parse({ ...demoExploreResult(query, 'web'), id, query, answer,
    fetchedAt: '2026-09-19T16:00:00.000Z', sources: [source], citations: [{ ...source, start: 0, end: answer.length }], images: [] });
}
function memorySession(now = Date.now()) {
  return { id: randomUUID(), publication: taskFixture().publication, createdAt: now, touchedAt: now, researchMemory: [] as VisitorResearchMemory };
}
function memoryDocuments() {
  const values = new Map<string, unknown>();
  const documents: TaskDocuments = {
    read: async key => structuredClone(values.get(key) ?? null),
    create: async (key, value) => { assert.equal(values.has(key), false); values.set(key, structuredClone(value)); },
    compareAndSwap: async (key, revision, value) => {
      assert.equal((values.get(key) as { revision: number }).revision, revision); values.set(key, structuredClone(value));
    },
  };
  return { documents, values };
}

test('conversation research is isolated by visitor and publication, with unchanged acquisition dates', () => {
  const now = Date.now(), session = memorySession(now), result = finding('first-research');
  retainVisitorConversationResearch(session, result, now);
  const retained = structuredClone(session.researchMemory);
  retainVisitorConversationResearch(session, result, now + 1000);
  assert.deepEqual(session.researchMemory, retained, 'reuse never refreshes retention or the original fetchedAt');
  for (const other of [{ ...session, id: randomUUID() }, { ...session, publication: { ...session.publication, siteId: 'other-publisher' } },
    { ...session, publication: { ...session.publication, revisionId: 'new-publication' } }]) {
    assert.deepEqual(visitorConversationMemory(other, '', 12_000, now)?.available, []);
    assert.deepEqual(visitorConversationResearchHistory(other, now).entries, []);
    assert.throws(() => recallVisitorConversationResearch(other, result.id, now), /unavailable/);
  }
  assert.deepEqual(recallVisitorConversationResearch(session, result.id, now), result);
  assert.throws(() => retainVisitorConversationResearch(session, finding(result.id, result.query, 'Replaced untrusted claim'), now), /Conflicting/);
  assert.throws(() => recallVisitorConversationResearch(session, result.id, now + 30 * 60_000), /expired/);
  assert.deepEqual(visitorConversationMemory({ ...session, touchedAt: now + 2 * 60 * 60_000 }, '', 12_000, now + 2 * 60 * 60_000)?.available, []);
  assert.deepEqual(visitorConversationResearchHistory(session, now + 30 * 60_000).entries, []);
});

test('research storage keeps at most eight complete results within its byte budget', () => {
  const session = memorySession();
  for (let i = 0; i < 9; i++) retainVisitorConversationResearch(session, finding(`small-${i}`));
  assert.equal(session.researchMemory.length, 8);
  assert.throws(() => recallVisitorConversationResearch(session, 'small-0'), /unavailable/);
  for (let i = 0; i < 8; i++) retainVisitorConversationResearch(session, finding(`large-${i}`, `Long policy ${i}`, `${'掲載条件。'.repeat(2200)} Additional conditions remain binding.`));
  assert.ok(Buffer.byteLength(JSON.stringify(session.researchMemory)) <= VISITOR_RESEARCH_MEMORY_BYTES);
  assert.ok(session.researchMemory.length < 8, 'whole older entries are evicted under byte pressure');
  assert.match(recallVisitorConversationResearch(session, 'large-7').answer, /Additional conditions remain binding\.$/);
  const oversized = finding('oversized', '界'.repeat(2000), '界'.repeat(12000));
  oversized.sources = Array.from({ length: 10 }, (_, i) => ({ title: '界'.repeat(300), url: `${source.url}?source=${i}` }));
  assert.ok(Buffer.byteLength(JSON.stringify(oversized)) > 48_000);
  assert.doesNotThrow(() => retainVisitorConversationResearch(session, oversized));
  const omitted = visitorConversationMemory(session).omitted.find(item => item.id === oversized.id)!;
  assert.equal(omitted.reason, 'result-size'); assert.equal(omitted.recallable, false);
  assert.throws(() => recallVisitorConversationResearch(session, oversized.id), /complete evidence is unavailable/);
});

test('prompt memory prioritizes relevant findings without clipping conditions or citation offsets', () => {
  const session = memorySession(), relevant = finding('relevant', 'Museum group reservation deposit', `${'Supporting context. '.repeat(160)} Group reservations require a deposit; walk-in visits are excluded.`);
  const unrelated = finding('unrelated', 'Mountain trail access', 'Unrelated trail context. '.repeat(160));
  const long = finding('long', 'Detailed membership policy', `${'詳細。'.repeat(2000)} Qualified final statement.`);
  for (const result of [relevant, unrelated, long]) retainVisitorConversationResearch(session, result);
  const memory = visitorConversationMemory(session, 'What was the museum group deposit?', 6000);
  assert.ok(memory);
  assert.ok(Buffer.byteLength(JSON.stringify(memory)) <= 6000);
  assert.deepEqual(memory.available[0], relevant);
  assert.deepEqual(memory.available[0].citations, relevant.citations);
  assert.ok(memory.omitted.some(item => item.id === long.id && item.fetchedAt === long.fetchedAt && item.query === long.query && item.recallable));
  assert.deepEqual(recallVisitorConversationResearch(session, long.id), long);
});

test('small prompt budgets omit directory entries without losing complete stored evidence', () => {
  const session = memorySession();
  for (let i = 0; i < 8; i++) retainVisitorConversationResearch(session, finding(`history-${i}`, `Historical policy ${i} ${'詳細な条件。'.repeat(50)}`));
  const before = structuredClone(session.researchMemory);
  const memory = visitorConversationMemory(session, '', 183);
  assert.ok(memory);
  assert.ok(Buffer.byteLength(JSON.stringify(memory)) <= 183);
  assert.deepEqual(memory.available, []);
  assert.deepEqual(memory.omitted, []);
  assert.equal(memory.unlisted, 8);
  assert.equal(visitorConversationMemory(session, '', 1), null, 'even minimum optional metadata may be omitted');
  assert.equal(visitorConversationMemory(session, '', -20), null);
  const partial = visitorConversationMemory(session, '', 800);
  assert.ok(partial && partial.omitted.length > 0 && partial.unlisted > 0);
  assert.equal(partial.omitted.length + partial.unlisted, 8);
  assert.ok(Buffer.byteLength(JSON.stringify(partial)) <= 800);
  const directory = visitorConversationResearchHistory(session);
  assert.equal(directory.entries.length, 8);
  assert.ok(directory.entries.every(entry => entry.queryTruncated && entry.recallable));
  assert.ok(Buffer.byteLength(JSON.stringify(directory)) <= 12_000);
  assert.deepEqual(session.researchMemory, before);
  assert.deepEqual(recallVisitorConversationResearch(session, 'history-0'), before[0].result);
});

test('old stored sessions default to empty memory and session expiration still fails closed', async () => {
  let now = Date.now(); const { documents, values } = memoryDocuments(), store = new VisitorTaskStore(documents, () => now);
  const session = await store.create(taskFixture().publication);
  const old = values.get(session.id) as Record<string, unknown>; delete old.researchMemory;
  assert.deepEqual((await store.read(session.id, session.publication)).researchMemory, []);
  const fresh = await store.read(session.id, session.publication);
  retainVisitorConversationResearch(fresh, finding('retained'), now); await store.save(fresh, fresh.revision);
  const other = await store.create(session.publication);
  assert.deepEqual((await store.read(other.id, other.publication)).researchMemory, []);
  await assert.rejects(store.read(session.id, { ...session.publication, siteId: 'other' }), /Publication changed/);
  now += 30 * 60_000;
  await assert.rejects(store.read(session.id, session.publication), /expired/);
});

test('research persists through filters, Home and Back while old action handles stay stale', async () => {
  const { documents } = memoryDocuments(), store = new VisitorTaskStore(documents), index = compileQueryIndex(taskFixture());
  let session = await store.create(index.space.publication), providerCalls = 0;
  buildVisitorTaskView({ index, session, signal: new AbortController().signal }); session = await store.save(session, session.revision);
  const original = finding('remembered-rate');
  const execute = async (capabilityId: string, input: unknown) => {
    session = await store.read(session.id, session.publication);
    return executeVisitorCapability({ sessionId: session.id, store, index, signal: new AbortController().signal, assertCurrent: async () => {},
      research: async () => { providerCalls++; return original; }, call: { operationId: randomUUID(), expectedRevision: session.revision, capabilityId, input } });
  };
  const lookedUp = await execute('research.lookup', { query: original.query, kind: 'web' });
  session = await store.read(session.id, session.publication);
  assert.deepEqual(recallVisitorConversationResearch(session, original.id), original, 'successful lookup persists memory in its capability save');
  confirmVisitorView(session); const savedView = buildVisitorTaskView({ index, session, signal: new AbortController().signal }); retainTaskSurface(session, savedView);
  session.generation++; session = await store.save(session, session.revision);
  assert.throws(() => resolveEvidence(session, lookedUp.handleId, 'research'), /stale/);
  const query = session.queries[0].current;
  await execute('query.patch', { queryId: query.queryId, baseRevision: query.revision, operations: [{ op: 'setSearch', text: 'record' }] });
  await execute('home', {});
  session = await store.read(session.id, session.publication);
  restoreTaskSurface(session, savedView.operationId ?? 'initial'); session = await store.save(session, session.revision);
  const recalled = await execute('research.recall', { resultId: original.id });
  assert.equal(providerCalls, 1, 'follow-up recall never calls a provider');
  assert.deepEqual(recalled.data, original); assert.equal(session.presentation, null, 'recall does not show a result');
  session = await store.read(session.id, session.publication);
  assert.equal(session.evidence.find(item => item.handle.id === recalled.handleId)?.handle.authority, 'external');
  assert.deepEqual(resolveEvidence(session, recalled.handleId, 'research'), original);
  assert.throws(() => resolveEvidence(session, lookedUp.handleId, 'research'), /stale/);
});

test('resumed bridge and reconnect memory reuse prior research without generation changes or provider calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-memory-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const { withDatabase, initialSite } = await import('../lib/local-store');
    const site = initialSite('general', 'Visitor reference test', 'visitor-reference-test');
    site.published = { ...site.draft, explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled: true } };
    await withDatabase(db => { db.sites = [site]; });
    let providerCalls = 0; const original = finding('shared-result'), search = async () => { providerCalls++; return original; };
    const first = await createVisitorTaskBridge(site.slug, undefined, search, { request: original.query });
    await first.rememberResearch(original, new AbortController().signal);
    const context = await visitorTaskContext(site.slug), stored = await context.store.read(first.sessionId, context.publication);
    const reconnect = await readVisitorConversationMemory(site.slug, first.sessionId, 'What was the deposit?');
    assert.deepEqual(reconnect.available, [original]);
    assert.deepEqual(await context.store.read(first.sessionId, context.publication), stored, 'reconnect read does not save or change generation');
    const resumed = await createVisitorTaskBridge(site.slug, first.sessionId, search, { request: 'Apply that deposit to a different group size.' });
    const instructions = await resumed.instructions();
    assert.ok(Buffer.byteLength(instructions) <= 48_000);
    const modelData = JSON.parse(instructions.split('\n').at(-1)!);
    assert.deepEqual(modelData.researchMemory.available, [original]);
    assert.deepEqual(await resumed.memory(), reconnect);
    const directory = await resumed.execute(JSON.stringify({ capabilityId: 'research.history', input: {} }), new AbortController().signal, async () => { assert.fail('History must not display.'); });
    assert.equal(directory.data.outputType, 'research-directory');
    assert.equal(directory.directText, undefined, 'directory metadata must not be treated as a completed research answer');
    const history = visitorResearchHistorySchema.parse(directory.data.result);
    assert.deepEqual(history.entries.map(entry => [entry.id, entry.fetchedAt, entry.recallable]), [[original.id, original.fetchedAt, true]]);
    const directoryHandleId = directory.data.handleId; assert.ok(directoryHandleId);
    const withDirectory = await context.store.read(resumed.sessionId, context.publication);
    assert.equal(withDirectory.evidence.find(item => item.handle.id === directoryHandleId)?.handle.authority, 'external');
    assert.deepEqual(resolveEvidence(withDirectory, directoryHandleId, 'research-directory'), history);
    assert.throws(() => resolveEvidence(withDirectory, directoryHandleId, 'research'), /unavailable/);
    const read = await resumed.execute(JSON.stringify({ capabilityId: 'research.recall', input: { resultId: history.entries[0].id } }), new AbortController().signal, async () => { assert.fail('Recall must not display.'); });
    const { evidenceExcerpts, omittedEvidenceExcerpts, ...recalled } = read.data.result as ExploreResult & {
      evidenceExcerpts: { resultId: string; url: string; excerpt: string; start: number; end: number }[]; omittedEvidenceExcerpts: number;
    };
    assert.deepEqual(recalled, original); assert.equal(providerCalls, 0);
    assert.ok(Array.isArray(evidenceExcerpts)); assert.equal(typeof omittedEvidenceExcerpts, 'number');
    for (const quote of evidenceExcerpts) {
      assert.equal(quote.resultId, original.id);
      assert.equal(quote.excerpt, original.answer.slice(quote.start, quote.end));
    }
    const afterRecall = await context.store.read(resumed.sessionId, context.publication);
    assert.deepEqual(resolveEvidence(afterRecall, read.data.handleId!, 'research'), original, 'Copyable model excerpts do not change canonical evidence or binding authority');
    await assert.rejects(first.rememberResearch(finding('stale-result'), new AbortController().signal), /cancelled/);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(resumed.rememberResearch(finding('aborted-result'), abort.signal), { name: 'AbortError' });
    assert.equal((await resumed.memory()).available.length, 1);
    const fresh = await createVisitorTaskBridge(site.slug, undefined, search);
    assert.deepEqual((await fresh.memory()).available, []);
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});
