import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeStore, type KnowledgeScope } from '../lib/knowledge-store';
import { createKnowledgeServer } from '../lib/knowledge-server';
import { openAIKnowledgeProvider, type KnowledgeProvider } from '../lib/knowledge-provider';
import { createKnowledgeStorageBudget } from '../lib/knowledge-storage-budget';
import { hostedKnowledgeConfigured, KNOWLEDGE_GIB, KNOWLEDGE_MONTHLY_STORAGE_MICRO_USD } from '../lib/knowledge-config';
import type { VoiceDatabase } from '../lib/production-voice-store';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function database() {
  let rows = new Map<string, Record<string, unknown>>(), pending = Promise.resolve();
  const db: VoiceDatabase = { async transaction(work) {
    const previous = pending; let release!: () => void; pending = new Promise(resolve => { release = resolve; }); await previous;
    const next = new Map(structuredClone([...rows])); let wrote = false;
    try {
      const result = await work({ get: async path => { assert.equal(wrote, false, 'Firestore reads must precede writes'); return structuredClone(next.get(path) ?? null); },
        set: (path, value) => { wrote = true; next.set(path, structuredClone(value) as Record<string, unknown>); } });
      rows = next; return result;
    } finally { release(); }
  } };
  return { db, corrupt: () => { rows.set('knowledgeStorageBudget/platform', { bytes: -1 }); } };
}
const enabled = { NODE_ENV: 'production', FLOWPATH_KNOWLEDGE_ENABLED: '1', FLOWPATH_LIVE_ENABLED: '1', FLOWPATH_ACCOUNT_MODE: 'firebase',
  FLOWPATH_FIRESTORE_EDITION: 'standard', FLOWPATH_FIREBASE_PROJECT_ID: 'flowpath-studio', FLOWPATH_PUBLIC_ORIGIN: 'https://flowpath.studio',
  FLOWPATH_CREATION_SAFETY_ENABLED: '1', FLOWPATH_CREATION_POLICY_PRESET: 'conservative-v3' };

test('hosted Knowledge requires the explicit production project/origin and active exact safety configuration', () => {
  assert.equal(hostedKnowledgeConfigured(enabled), true);
  for (const key of Object.keys(enabled)) assert.equal(hostedKnowledgeConfigured({ ...enabled, [key]: 'invalid' }), false, key);
});

test('global storage reservations serialize concurrent uploads and never duplicate or release another owner’s hold', async () => {
  const { db } = database(), budget = createKnowledgeStorageBudget();
  const outcomes = await Promise.allSettled(['a', 'b'].map(uid => db.transaction(tx => budget.reserve(tx, uid, id))));
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  await assert.rejects(db.transaction(tx => budget.reserve(tx, 'a', id)), /new upload identifier/);
  const before = await db.transaction(tx => budget.view(tx));
  await db.transaction(tx => budget.release(tx, 'unrelated-owner', id));
  assert.deepEqual(await db.transaction(tx => budget.view(tx)), before);
  assert.equal(before.budgetMicroUsd, KNOWLEDGE_MONTHLY_STORAGE_MICRO_USD);
  assert.equal(before.estimatedMonthlyMicroUsd, 3_100_000);
});

test('reported index usage replaces the estimate idempotently; only confirmed cleanup frees capacity', async () => {
  const { db } = database(), budget = createKnowledgeStorageBudget();
  await db.transaction(tx => budget.reserve(tx, 'a', id));
  await db.transaction(tx => budget.report(tx, 'a', id, 1024));
  const measured = await db.transaction(tx => budget.view(tx));
  await db.transaction(tx => budget.report(tx, 'a', id, 1024));
  assert.deepEqual(await db.transaction(tx => budget.view(tx)), measured);
  await db.transaction(tx => budget.reserve(tx, 'b', other));
  await assert.rejects(db.transaction(tx => budget.report(tx, 'b', other, NaN)), /verified/);
  assert.equal((await db.transaction(tx => budget.view(tx))).uploadCapacityAvailable, false);
  await db.transaction(tx => budget.release(tx, 'b', other));
  await db.transaction(tx => budget.release(tx, 'b', other));
  assert.deepEqual(await db.transaction(tx => budget.view(tx)), measured);
});

test('an underestimated file blocks further admission without deleting retained documents or inventing refunds', async () => {
  const { db } = database(), budget = createKnowledgeStorageBudget();
  await db.transaction(tx => budget.reserve(tx, 'a', id));
  await db.transaction(tx => budget.report(tx, 'a', id, 2 * KNOWLEDGE_GIB));
  const view = await db.transaction(tx => budget.view(tx));
  assert.equal(view.estimatedMonthlyMicroUsd, 6_200_000); assert.equal(view.uploadCapacityAvailable, false);
  await assert.rejects(db.transaction(tx => budget.reserve(tx, 'b', other)), /capacity/);
  await db.transaction(tx => budget.assertKnown(tx, 'a', id));
});

test('malformed storage accounting fails closed', async () => {
  const { db, corrupt } = database(); corrupt();
  await assert.rejects(db.transaction(tx => createKnowledgeStorageBudget().reserve(tx, 'a', id)), /accounting/);
});

function setup() {
  const { db } = database(), budget = createKnowledgeStorageBudget();
  let time = 100000, files = 0, stores = 0, removedFiles = 0, removedStores = 0;
  const provider: KnowledgeProvider = {
    createStore: async () => `store-${++stores}`, upload: async () => `file-${++files}`, attach: async () => {},
    status: async () => ({ status: 'ready', usageBytes: 1024 }), search: async () => [{ fileId: `file-${files}`, text: 'A verified reference.' }],
    remove: async () => { removedFiles++; }, removeStore: async () => { removedStores++; },
  };
  const scope: KnowledgeScope = { uid: 'a', waveformId: id, isCurrent: () => true };
  const store = createKnowledgeStore(db, provider, () => time, undefined, budget);
  const file = () => new File(['An adult creator’s synthetic reference.'], 'reference.txt', { type: 'text/plain' });
  return { db, budget, provider, scope, store, file, advance: () => { time += 4000; }, counts: () => ({ files, stores, removedFiles, removedStores }) };
}

test('hosted upload claims storage before provider work, reconciles indexed bytes and blocks unverified legacy selection', async () => {
  const h = setup();
  await h.store.upload(h.scope, id, h.file());
  await h.store.upload(h.scope, id, h.file()); assert.equal(h.counts().files, 1);
  await assert.rejects(h.store.upload({ ...h.scope, uid: 'b', waveformId: other }, other, h.file()), /capacity/);
  assert.equal(h.counts().files, 1);
  h.advance(); await h.store.refresh(h.scope);
  assert.equal((await h.db.transaction(tx => h.budget.view(tx))).uploadCapacityAvailable, true);
  assert.equal(await h.store.enabled(h.scope), true);
  assert.equal((await h.store.search(h.scope, 'reference')).passages.length, 1);
});

test('last-file removal deletes the file and empty index, retains failed cleanup and blocks racing uploads', async () => {
  const h = setup(); await h.store.upload(h.scope, id, h.file()); h.advance(); await h.store.refresh(h.scope);
  const before = await h.db.transaction(tx => h.budget.view(tx));
  h.provider.removeStore = async () => { throw new Error('synthetic delete failure'); };
  await assert.rejects(h.store.remove(h.scope, id), /disabled/);
  assert.equal((await h.store.view(h.scope)).documents[0].status, 'removing');
  assert.deepEqual(await h.db.transaction(tx => h.budget.view(tx)), before);
  await assert.rejects(h.store.upload(h.scope, other, new File(['A different reference'], 'other.txt')), /removal/);
  assert.deepEqual((await h.store.search(h.scope, 'reference')).passages, []);
  let deleted = 0; h.provider.removeStore = async () => { deleted++; };
  await h.store.remove(h.scope, id); await h.store.remove(h.scope, id);
  assert.equal(deleted, 1); assert.equal((await h.store.view(h.scope)).documents.length, 0);
  assert.equal((await h.db.transaction(tx => h.budget.view(tx))).estimatedMonthlyMicroUsd, 0);
  await h.store.upload(h.scope, other, new File(['A different reference'], 'other.txt'));
  assert.equal(h.counts().stores, 2);
});

test('unknown provider outcomes retain their reservation and cannot be hidden through Remove', async () => {
  const h = setup(); h.provider.createStore = async () => { throw new Error('lost response'); };
  await assert.rejects(h.store.upload(h.scope, id, h.file()));
  await assert.rejects(h.store.remove(h.scope, id), /uncertain/);
  assert.equal((await h.db.transaction(tx => h.budget.view(tx))).estimatedMonthlyMicroUsd, 3_100_000);
});

test('hosted API requires explicit adult upload confirmation and preserves it in every library response', async () => {
  const h = setup();
  const server = createKnowledgeServer({ store: h.store, available: () => true, scope: async () => h.scope,
    publicOrigin: 'https://flowpath.studio', requireAdultConsent: true });
  const request = (adult: boolean) => { const body = new FormData(); body.set('file', h.file());
    return new Request('https://flowpath.studio/api/knowledge', { method: 'POST', body,
      headers: { Host: 'flowpath.studio', Origin: 'https://flowpath.studio', 'X-FlowPath-Upload': id, ...(adult ? { 'X-FlowPath-Adult': '1' } : {}) } }); };
  assert.equal((await server.POST(request(false))).status, 403); assert.equal(h.counts().files, 0);
  const response = await server.POST(request(true)); assert.equal(response.status, 202);
  const view = await response.json(); assert.equal(view.requiresAdultConsent, true); assert.equal(view.storage, undefined);
  assert.doesNotMatch(JSON.stringify(view), /file-1|store-1|ownerUid/);
});

test('provider verifies indexed bytes and every deletion receipt, with retry-safe not-found semantics', async () => {
  let mode = 'ready', calls = 0;
  const provider = openAIKnowledgeProvider(() => 'synthetic-token', (async (url, init) => {
    calls++; const endpoint = String(url);
    if (init?.method === 'DELETE') return mode === '404' ? new Response(null, { status: 404 }) : Response.json({ id: endpoint.split('/').at(-1), deleted: mode !== 'unconfirmed' });
    return Response.json({ id: 'file-1', vector_store_id: 'store-1', status: 'completed', usage_bytes: mode === 'invalid' ? -1 : 2048 });
  }) as typeof fetch);
  assert.deepEqual(await provider.status('store-1', 'file-1'), { status: 'ready', usageBytes: 2048 });
  mode = 'invalid'; await assert.rejects(provider.status('store-1', 'file-1'), /verified/);
  mode = 'unconfirmed'; await assert.rejects(provider.removeStore!('store-1'), /confirmed/);
  mode = '404'; await provider.remove('store-1', 'file-1'); await provider.removeStore!('store-1');
  assert.equal(calls, 6);
});

test('a confirmed provider authorization refusal can be removed without a fictitious unknown resource hold', async () => {
  const { db } = database(), budget = createKnowledgeStorageBudget(); let calls = 0;
  const provider = openAIKnowledgeProvider(() => 'synthetic-token', (async () => { calls++; return new Response(null, { status: 403 }); }) as typeof fetch);
  const store = createKnowledgeStore(db, provider, Date.now, undefined, budget);
  const scope = { uid: 'a', waveformId: id, isCurrent: () => true };
  await assert.rejects(store.upload(scope, id, new File(['A synthetic reference'], 'reference.txt')));
  assert.equal(calls, 1);
  await store.remove(scope, id);
  assert.equal(calls, 1, 'no resource exists to delete after confirmed creation refusal');
  assert.equal((await db.transaction(tx => budget.view(tx))).estimatedMonthlyMicroUsd, 0);
});
