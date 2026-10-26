import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeStore, type KnowledgeScope } from '../lib/knowledge-store';
import { createKnowledgeServer } from '../lib/knowledge-server';
import { openAIKnowledgeProvider, type KnowledgeProvider } from '../lib/knowledge-provider';
import type { VoiceDatabase } from '../lib/production-voice-store';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function database(): VoiceDatabase {
  let rows = new Map<string, Record<string, unknown>>(), pending = Promise.resolve();
  return { async transaction(work) {
    const prior = pending; let release!: () => void; pending = new Promise(resolve => { release = resolve; }); await prior;
    const next = new Map(structuredClone([...rows]));
    try { const result = await work({ get: async path => structuredClone(next.get(path) ?? null), set: (path, row) => { next.set(path, structuredClone(row) as Record<string, unknown>); } }); rows = next; return result; }
    finally { release(); }
  } };
}
function setup() {
  let time = 100_000, current = true, uploads = 0, stores = 0, deletes = 0, searches = 0;
  const scope: KnowledgeScope = { uid: 'owner-a', waveformId: id, isCurrent: () => current };
  const files = new Map<string, string>();
  const provider: KnowledgeProvider = {
    async createStore() { stores++; return 'private-store'; },
    async upload(file) { uploads++; const fileId = `file-${uploads}`; files.set(fileId, await file.text()); return fileId; },
    async attach() {}, async status() { return 'ready'; },
    async search() { searches++; return [...files].map(([fileId, text]) => ({ fileId, text })); },
    async remove(_store, fileId) { deletes++; files.delete(fileId); },
  };
  const store = createKnowledgeStore(database(), provider, () => time);
  const available = () => true;
  const api = createKnowledgeServer({ store, available, scope: async () => current ? scope : null });
  const file = () => new File(['Synthetic opening hours: Monday at nine.'], 'hours.txt', { type: 'text/plain' });
  const request = (method: string, body?: object, origin = 'http://localhost:3220') => new Request('http://localhost:3220/api/knowledge', {
    method, headers: { host: 'localhost:3220', origin, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  return { scope, store, api, provider, files, file, request, counts: () => ({ uploads, stores, deletes, searches }),
    revoke: () => { current = false; }, advance: () => { time += 4_000; } };
}

test('uploads are immutable, private, sanitized and idempotent across concurrent requests', async () => {
  const h = setup();
  await Promise.all([h.store.upload(h.scope, id, h.file()), h.store.upload(h.scope, id, h.file())]);
  assert.deepEqual(h.counts(), { uploads: 1, stores: 1, searches: 0, deletes: 0 });
  const initial = await h.store.view(h.scope);
  assert.equal(initial.documents[0].status, 'preparing'); assert.equal(initial.documents[0].selected, false);
  assert.doesNotMatch(JSON.stringify(initial), /fileId|storeId|digest|private-store|owner-a/);
  h.advance(); const ready = await h.store.refresh(h.scope);
  assert.equal(ready.documents[0].status, 'ready'); assert.equal(ready.documents[0].selected, true);
  await assert.rejects(h.store.upload(h.scope, id, new File(['Different'], 'hours.txt')), /identifier/);
  await assert.rejects(h.store.upload(h.scope, second, h.file()), /already/);
  const other: KnowledgeScope = { ...h.scope, uid: 'owner-b' };
  assert.equal((await h.store.view(other)).documents.length, 0);
  assert.deepEqual((await h.store.search(other, 'hours')).passages, []);
  await assert.rejects(h.store.view({ ...h.scope, waveformId: second }), /different waveform/);
});

test('search filters provider IDs against selected documents and rechecks revocation after retrieval', async () => {
  const h = setup(); await h.store.upload(h.scope, id, h.file()); h.advance(); await h.store.refresh(h.scope);
  h.files.set('another-owner-file', 'Never leak this.');
  const result = await h.store.search(h.scope, 'hours');
  assert.equal(result.passages.length, 1); assert.equal(result.passages[0].filename, 'hours.txt');
  assert.equal(result.passages[0].quote, 'Synthetic opening hours: Monday at nine.');
  const original = h.provider.search;
  h.provider.search = async (...args) => { const result = await original(...args); await h.store.select(h.scope, id, false); return result; };
  await assert.rejects(h.store.search(h.scope, 'hours'), /changed/);
  assert.deepEqual((await h.store.search(h.scope, 'hours')).passages, []);
  h.provider.search = original;
  await h.store.select(h.scope, id, true);
  h.provider.search = async (...args) => { const result = await original(...args); h.revoke(); return result; };
  await assert.rejects(h.store.search(h.scope, 'hours'), /Sign in/);
});

test('removal revokes immediately even when provider deletion fails; explicit cleanup is retryable', async () => {
  const h = setup(); await h.store.upload(h.scope, id, h.file()); h.advance(); await h.store.refresh(h.scope);
  const remove = h.provider.remove; h.provider.remove = async () => { throw new Error('synthetic interruption'); };
  await assert.rejects(h.store.remove(h.scope, id), /disabled/);
  assert.equal((await h.store.view(h.scope)).documents[0].status, 'removing');
  assert.deepEqual((await h.store.search(h.scope, 'hours')).passages, []);
  h.provider.remove = remove; await h.store.remove(h.scope, id); await h.store.remove(h.scope, id);
  assert.equal((await h.store.view(h.scope)).documents.length, 0); assert.equal(h.counts().deletes, 1);
});

test('failed ingestion is not retried by refresh or upload replay', async () => {
  const h = setup(); h.provider.attach = async () => { throw new Error('synthetic'); };
  await assert.rejects(h.store.upload(h.scope, id, h.file()), /No automatic retry/);
  h.advance(); await h.store.refresh(h.scope); await h.store.upload(h.scope, id, h.file());
  assert.equal(h.counts().uploads, 1); assert.equal((await h.store.view(h.scope)).documents[0].status, 'failed');
});

test('approval checks may transact without nesting/deadlocking Knowledge metadata transactions', async () => {
  const db = database();
  const h = setup();
  const scope = { ...h.scope, isCurrent: () => db.transaction(async tx => { await tx.get('approval/check'); return true; }) };
  const store = createKnowledgeStore(db, h.provider);
  await store.upload(scope, id, h.file());
  assert.equal((await store.view(scope)).documents.length, 1);
});

test('an uncertain index creation blocks additional ingestion instead of retrying a billable operation', async () => {
  const h = setup(); let attempts = 0;
  h.provider.createStore = async () => { attempts++; throw new Error('lost response'); };
  await assert.rejects(h.store.upload(h.scope, id, h.file()));
  await h.store.remove(h.scope, id);
  await assert.rejects(h.store.upload(h.scope, second, new File(['Another document'], 'another.txt')), /earlier index creation/);
  assert.equal(attempts, 1);
});

test('a lost file identifier retains an explicit reconciliation record instead of pretending deletion succeeded', async () => {
  const h = setup(); h.provider.upload = async () => { throw new Error('lost file response'); };
  await assert.rejects(h.store.upload(h.scope, id, h.file()));
  await assert.rejects(h.store.remove(h.scope, id), /reconciliation/);
  assert.equal((await h.store.view(h.scope)).documents[0].status, 'failed');
  assert.deepEqual((await h.store.search(h.scope, 'hours')).passages, []);
});

test('Knowledge HTTP routes require current owner, same origin, bounded input and exact waveform scope', async () => {
  const h = setup();
  assert.equal((await h.api.PATCH(h.request('PATCH', { id, selected: true }, 'https://other.invalid'))).status, 403);
  assert.equal((await h.api.search(h.request('POST', { waveformId: second, query: 'hours' }))).status, 400);
  assert.equal((await h.api.search(h.request('POST', { waveformId: id, query: 'hours', vectorStoreId: 'foreign' }))).status, 400);
  const form = new FormData(); form.set('file', new File(['not a PDF'], 'fake.pdf'));
  assert.equal((await h.api.POST(new Request('http://localhost:3220/api/knowledge', { method: 'POST',
    headers: { host: 'localhost:3220', origin: 'http://localhost:3220', 'X-FlowPath-Upload': id }, body: form }))).status, 400);
  h.revoke(); assert.equal((await h.api.GET(h.request('GET'))).status, 401);
  assert.equal(h.counts().uploads, 0); assert.equal(h.counts().searches, 0);
});

test('managed provider uses documented filters, no retries, no raw provider errors or IDs in client results', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const provider = openAIKnowledgeProvider(() => 'synthetic-token', (async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json({ data: [{ file_id: 'file-1', content: [{ type: 'text', text: 'Verified passage.' }] }] });
  }) as typeof fetch);
  assert.deepEqual(await provider.search('vs-1', [id], 'hours'), [{ fileId: 'file-1', text: 'Verified passage.' }]);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/vector_stores/vs-1/search');
  const body = JSON.parse(String(requests[0].init?.body));
  assert.deepEqual(body.filters, { type: 'in', key: 'document_id', value: [id] }); assert.equal(body.rewrite_query, false);
  let attempts = 0;
  const failed = openAIKnowledgeProvider(() => 'synthetic-token', (async () => { attempts++; return Response.json({ error: 'secret upstream details' }, { status: 500 }); }) as typeof fetch);
  await assert.rejects(failed.createStore(), error => error instanceof Error && /No automatic retry/.test(error.message) && !/secret/.test(error.message));
  assert.equal(attempts, 1);
});
