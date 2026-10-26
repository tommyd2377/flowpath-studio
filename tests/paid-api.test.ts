import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createAccountServer } from '../lib/account-server';
import { createPaidApi } from '../lib/paid-api';
import { PAID_VISITOR_COOKIE, paidVisitor } from '../lib/paid-http';
import { paidFixture } from './paid-fixture';

const origin = 'http://127.0.0.1:3220';
function req(path: string, method = 'GET', body?: object, cookies = '') {
  return new Request(origin + path, { method, headers: { Host: '127.0.0.1:3220', Origin: origin,
    Cookie: `${PAID_VISITOR_COOKIE}=${'a'.repeat(64)}; ${cookies}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}
async function fixture(credit = true) {
  const f = paidFixture(); const directory = await mkdtemp(join(tmpdir(), 'flowpath-paid-api-'));
  const accounts = createAccountServer({ mode: 'local', development: () => true, localDirectory: directory });
  const api = createPaidApi({ accounts, store: f.store, enabled: true, fixtures: true, pack: f.pack, voiceReady: () => true });
  await f.store.registerVisitor(paidVisitor(req('/api/billing'))!);
  const login = await accounts.accountPOST(req('/api/account', 'POST', { localAccount: 'owner-a' }));
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  await accounts.waveformPUT(req('/api/waveform', 'PUT', { name: f.wave.name, initialPrompt: f.wave.initialPrompt }, cookie));
  const wave = (await accounts.resolveWaveform(req('/api/waveform', 'GET', undefined, cookie)))!;
  const owner = { uid: 'local-owner-a', visitorId: 'local-owner-a' }; if (credit) await f.credit(owner);
  const publishing = (published: boolean, mode = 'creator') => api.publishingPOST(req('/api/publishing', 'POST', { published,
    settings: { mode, budgetSeconds: 300, allowanceSeconds: 300 } }, cookie));
  return { ...f, directory, accounts, api, cookie, publishing, savedWave: wave };
}
test('public HTTP data is allowlisted, publishing requires the owner, and unpublishing closes ID bypass', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.api.publishedGET(req(`/api/published?id=${f.savedWave.id}`))).status, 404);
    assert.equal((await f.publishing(true)).status, 200);
    const result = await f.api.publishedGET(req(`/api/published?id=${f.savedWave.id}`));
    assert.equal(result.status, 200);
    const data = await result.text();
    assert.ok(!data.includes('initialPrompt')); assert.ok(!data.includes(f.wave.initialPrompt)); assert.ok(!data.includes('ownerUid'));
    assert.ok(!data.includes('budgetSeconds')); assert.equal(JSON.parse(data).waveform.voice, undefined);
    assert.equal((await f.api.publishingPOST(req('/api/publishing', 'POST', { published: true, settings: f.store.defaults }))).status, 401);
    assert.equal((await f.publishing(false)).status, 200);
    assert.equal((await f.api.publishedGET(req(`/api/published?id=${f.savedWave.id}`))).status, 404);
    const crossSite = req('/api/publishing', 'POST', { published: true, settings: f.store.defaults }, f.cookie);
    crossSite.headers.set('origin', 'https://evil.example'); assert.equal((await f.api.publishingPOST(crossSite)).status, 403);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
test('checkout needs authentication, repeated clicks share one purchase and forged request fields fail', async () => {
  const f = await fixture();
  try {
    const destination = `/p/${f.savedWave.id}`, requestId = randomUUID();
    assert.equal((await f.api.checkoutPOST(req('/api/billing/checkout', 'POST', { destination, requestId }))).status, 401);
    const one = await (await f.api.checkoutPOST(req('/api/billing/checkout', 'POST', { destination, requestId }, f.cookie))).json();
    const two = await (await f.api.checkoutPOST(req('/api/billing/checkout', 'POST', { destination, requestId: randomUUID() }, f.cookie))).json();
    assert.equal(one.url, two.url);
    assert.equal((await f.api.checkoutPOST(req('/api/billing/checkout', 'POST', { destination, requestId, amount: 1 }, f.cookie))).status, 400);
    const id = one.url.split('/').at(-1)!;
    assert.equal((await f.api.fixturePOST(req('/api/billing/fixture', 'POST', { id }, f.cookie))).status, 200);
    assert.equal((await f.api.fixturePOST(req('/api/billing/fixture', 'POST', { id }, f.cookie))).status, 200);
    assert.equal((await f.store.wallet('local-owner-a')).balance, 1800);
    const paused = createPaidApi({ accounts: f.accounts, store: f.store, enabled: true, fixtures: false, voiceReady: () => false });
    assert.equal((await paused.checkoutPOST(req('/api/billing/checkout', 'POST', { destination, requestId: randomUUID() }, f.cookie))).status, 503);
    assert.equal((await paused.fixturePOST(req('/api/billing/fixture', 'POST', { id }, f.cookie))).status, 403);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('a waveform saved before billing opens privately for its existing owner without rewriting the original record', async () => {
  const f = await fixture();
  try {
    const before = await f.accounts.resolveWaveform(req('/api/waveform', 'GET', undefined, f.cookie));
    assert.equal(await f.store.publication(f.savedWave.id), null);
    const other = await f.accounts.accountPOST(req('/api/account', 'POST', { localAccount: 'owner-b' }));
    const otherCookie = other.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await f.api.publishedGET(req(`/api/published?id=${f.savedWave.id}`, 'GET', undefined, otherCookie))).status, 404);
    assert.equal(await f.store.publication(f.savedWave.id), null);
    const response = await f.api.publishedGET(req(`/api/published?id=${f.savedWave.id}`, 'GET', undefined, f.cookie));
    assert.equal(response.status, 200);
    const view = await response.json();
    assert.equal(view.own, true); assert.equal(view.waveform.id, f.savedWave.id);
    assert.equal(view.waveform.initialPrompt, undefined);
    assert.equal((await f.store.publication(f.savedWave.id))?.published, false);
    assert.deepEqual(await f.accounts.resolveWaveform(req('/api/waveform', 'GET', undefined, f.cookie)), before);
    assert.equal((await f.api.publishedGET(req(`/api/published?id=${f.savedWave.id}`))).status, 404);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('saved server-verified admin testing publishes without funding and grants no visitor funds', async () => {
  const f = await fixture(false);
  try {
    const settings = { mode: 'intro', budgetSeconds: 0, allowanceSeconds: 300 };
    const body = { published: true, settings };
    const regular = await f.api.publishingPOST(req('/api/publishing', 'POST', body, f.cookie));
    assert.equal(regular.status, 402);
    assert.equal((await regular.json()).adminLimit, undefined);
    assert.equal((await f.api.publishingPOST(req('/api/publishing', 'POST', { ...body, continueAsAdmin: true }, f.cookie))).status, 403);
    let testing = false;
    const accounts = { resolveVoiceWaveform: async (request: Request, id?: string) => {
      const saved = await f.accounts.resolveVoiceWaveform(request, id);
      return saved ? { ...saved, waveform: { ...saved.waveform, adminTesting: testing } } : null;
    },
      resolveIdentity: async (request: Request) => {
        const identity = await f.accounts.resolveIdentity(request);
        return identity ? { ...identity, owner: { ...identity.owner, role: 'admin' as const } } : null;
      } };
    const admin = createPaidApi({ accounts, store: f.store, enabled: true, fixtures: true, voiceReady: () => true });
    const normal = await admin.publishingPOST(req('/api/publishing', 'POST', body, f.cookie));
    assert.equal(normal.status, 402); assert.equal((await normal.json()).adminLimit, undefined);
    assert.equal((await admin.publishingPOST(req('/api/publishing', 'POST', { ...body, continueAsAdmin: true }, f.cookie))).status, 403);
    testing = true;
    assert.equal(await f.store.publication(f.savedWave.id), null);
    const beforeWave = await f.accounts.resolveWaveform(req('/api/waveform', 'GET', undefined, f.cookie));
    const beforeWallet = await f.store.wallet('local-owner-a');
    const response = await admin.publishingPOST(req('/api/publishing', 'POST', body, f.cookie));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).adminUnfunded, true);
    assert.deepEqual(await f.store.wallet('local-owner-a'), beforeWallet);
    assert.deepEqual(await f.accounts.resolveWaveform(req('/api/waveform', 'GET', undefined, f.cookie)), beforeWave);
    const visitor = await (await admin.publishedGET(req(`/api/published?id=${f.savedWave.id}`))).json();
    assert.equal(visitor.sponsoredSeconds, 0); assert.equal(visitor.own, false); assert.equal(visitor.adminTesting, false);
    const ownView = await (await admin.publishedGET(req(`/api/published?id=${f.savedWave.id}`, 'GET', undefined, f.cookie))).json();
    assert.equal(ownView.adminTesting, true);
    testing = false;
    assert.equal((await (await admin.publishedGET(req(`/api/published?id=${f.savedWave.id}`, 'GET', undefined, f.cookie))).json()).adminTesting, false);
    assert.equal(visitor.waveform.initialPrompt, undefined);
    assert.equal((await f.store.publication(f.savedWave.id))?.settings.mode, 'intro');
    assert.equal((await f.store.publication(f.savedWave.id))?.settings.budgetSeconds, 0);
    assert.equal((await f.api.publishingPOST(req('/api/publishing', 'POST', { ...body, published: false }, f.cookie))).status, 200);
    // Saved testing mode bypasses personal funding without allocating phantom visitor funds.
    const fundedDraft = { ...body, settings: { ...settings, budgetSeconds: 300 } };
    const insufficient = await admin.publishingPOST(req('/api/publishing', 'POST', fundedDraft, f.cookie));
    assert.equal(insufficient.status, 402); assert.equal((await insufficient.json()).adminLimit, undefined);
    testing = true;
    assert.equal((await admin.publishingPOST(req('/api/publishing', 'POST', fundedDraft, f.cookie))).status, 200);
    assert.equal((await f.store.publication(f.savedWave.id))?.settings.budgetSeconds, 0);
    const malformed = await admin.publishingPOST(req('/api/publishing', 'POST', { ...body, continueAsAdmin: true, settings: { ...settings, allowanceSeconds: -1 } }, f.cookie));
    assert.equal(malformed.status, 400);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
