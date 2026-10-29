import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccountServer } from '../lib/account-server';
import { createCreationApi } from '../lib/creation-api';
import { createCreationReviewStore } from '../lib/creation-review';
import { createFixtureCreationReviewer } from '../lib/creation-safety-fixtures';
import { CREATION_SAFETY_CATEGORIES, CreationSafetyError, type CreationSafetyPolicy } from '../lib/creation-safety';
import type { CreationIdentity } from '../lib/creation-runtime';
import type { WaveformInput } from '../lib/account-model';
import { PaidMemoryDatabase } from './paid-fixture';

const request = (path: string, method = 'GET', body?: object, cookie = '') => new Request(`http://127.0.0.1:3225${path}`, {
  method, headers: { host: '127.0.0.1:3225', origin: 'http://127.0.0.1:3225', 'Content-Type': 'application/json', cookie },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-review-api-'));
  const db = new PaidMemoryDatabase();
  let calls = 0;
  const policy: CreationSafetyPolicy = { version: 'test-v1', categories: Object.fromEntries(CREATION_SAFETY_CATEGORIES.map(key => [key, 'block'])) as CreationSafetyPolicy['categories'] };
  policy.categories['portrait-provenance'] = 'allow-and-review';
  const store = (identity: CreationIdentity) => createCreationReviewStore(db, { mode: 'fixture', policy: () => policy,
    verifyOwner: async (_tx, actor) => { if (actor.uid !== identity.owner.uid || !await identity.isCurrent()) throw new CreationSafetyError('Sign in again.', 403); },
    verifyAdmin: async () => { if (identity.owner.role !== 'admin' || !await identity.isCurrent()) throw new CreationSafetyError('Admin access required.', 403); },
    reviewer: createFixtureCreationReviewer({ nodeEnv: 'development', enabled: true }, async candidate => {
      calls++;
      return { findings: Object.fromEntries(CREATION_SAFETY_CATEGORIES.map(key => [key, (candidate.name === 'Manual' && key === 'fraud-impersonation' || candidate.name === 'Followup' && key === 'portrait-provenance') ? 'uncertain' : 'clear'])) as Record<typeof CREATION_SAFETY_CATEGORIES[number], 'clear' | 'uncertain'> };
    }),
  });
  const guard = async (req: Request, input: WaveformInput) => {
    const identity = await accounts.resolveIdentity(req);
    if (!identity) throw new CreationSafetyError('Sign in again.', 403);
    await db.transaction(async tx => { await store(identity).requireAllowed(tx, identity.owner.uid, input); });
  };
  const accounts = createAccountServer({ mode: 'local', development: () => true, localDirectory: directory,
    safetyAdminFixture: true, validateWaveform: guard, checkWaveform: guard });
  const api = createCreationApi({ accounts, enabled: () => true, store });
  const signIn = async (localAccount = 'owner-a') => (await accounts.accountPOST(request('/api/account', 'POST', { localAccount }))).headers.get('set-cookie')!.split(';')[0];
  const candidate = { name: 'Reviewed voice', initialPrompt: 'Synthetic instructions', textPanel: null };
  return { accounts, api, candidate, signIn, calls: () => calls, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
test('Create reuses exact completed background review; direct save and material edits fail closed', async () => {
  const f = await fixture();
  try {
    const cookie = await f.signIn();
    const rejected = await f.accounts.waveformPUT(request('/api/waveform', 'PUT', f.candidate, cookie));
    assert.equal(rejected.status, 409);
    assert.equal((await rejected.json()).reviewRequired, true);
    assert.equal((await f.api.POST(request('/api/creation-review', 'POST', { candidate: f.candidate }, cookie))).status, 200);
    assert.equal(f.calls(), 1);
    assert.equal((await f.accounts.waveformPUT(request('/api/waveform', 'PUT', f.candidate, cookie))).status, 200);
    assert.equal(f.calls(), 1, 'Save does not launch another review');
    await f.api.POST(request('/api/creation-review', 'POST', { candidate: f.candidate }, cookie));
    assert.equal(f.calls(), 1, 'Identical background check reuses authority');
    assert.equal((await f.accounts.waveformPUT(request('/api/waveform', 'PUT', { ...f.candidate, name: 'Changed' }, cookie))).status, 409);
    assert.equal((await f.api.POST(request('/api/creation-review', 'POST', { candidate: f.candidate, status: 'allowed' }, cookie))).status, 400);
  } finally { await f.cleanup(); }
});
test('changed review blocks new starts while owner cleanup remains authorized', async () => {
  const f = await fixture();
  try {
    const cookie = await f.signIn();
    await f.api.POST(request('/api/creation-review', 'POST', { candidate: f.candidate }, cookie));
    const saved = await (await f.accounts.waveformPUT(request('/api/waveform', 'PUT', f.candidate, cookie))).json();
    await f.api.POST(request('/api/creation-review', 'POST', { candidate: { ...f.candidate, name: 'Changed' } }, cookie));
    assert.equal(await f.accounts.resolveVoiceWaveform(request('/api/session', 'POST', {}, cookie), saved.waveform.id), null);
    const cleanup = await f.accounts.resolveVoiceWaveform(request('/api/session', 'DELETE', {}, cookie), saved.waveform.id);
    assert.ok(cleanup); assert.equal(await cleanup.isCurrent(), true);
    assert.ok(await f.accounts.resolveVoiceWaveform(request('/api/publishing', 'POST', {}, cookie), saved.waveform.id, 'cleanup'), 'the owner can still unpublish stale content');
    assert.equal(await f.accounts.resolveVoiceWaveform(request('/api/session', 'DELETE', {}, await f.signIn('owner-b')), saved.waveform.id), null);
  } finally { await f.cleanup(); }
});
test('manual queue requires verified admin and binds its explicit decision to current content', async () => {
  const f = await fixture();
  try {
    const cookie = await f.signIn(), candidate = { ...f.candidate, name: 'Manual' };
    const reviewed = await (await f.api.POST(request('/api/creation-review', 'POST', { candidate }, cookie))).json();
    assert.equal(reviewed.review.status, 'manual-review');
    assert.equal((await f.api.adminGET(request('/api/creation-review/admin', 'GET', undefined, cookie))).status, 403);
    assert.equal((await f.accounts.waveformPUT(request('/api/waveform', 'PUT', candidate, cookie))).status, 409);
    const admin = await f.signIn('owner-admin');
    const { reviews } = await (await f.api.adminGET(request('/api/creation-review/admin', 'GET', undefined, admin))).json();
    assert.equal(reviews.length, 1);
    const row = reviews[0];
    const proof = { ownerUid: row.ownerUid, reviewId: row.reviewId, digest: row.digest, policyDigest: row.policyDigest, policyVersion: row.policyVersion, decision: 'allowed' };
    assert.equal((await f.api.adminPOST(request('/api/creation-review/admin', 'POST', { ...proof, digest: '0'.repeat(64) }, admin))).status, 409);
    assert.equal((await f.api.adminPOST(request('/api/creation-review/admin', 'POST', proof, admin))).status, 200);
    assert.equal((await f.accounts.waveformPUT(request('/api/waveform', 'PUT', candidate, await f.signIn()))).status, 200);
  } finally { await f.cleanup(); }
});

test('low-risk API approval permits Save immediately; only a verified founder can revoke its exact proof', async () => {
  const f = await fixture();
  try {
    const cookie = await f.signIn(), candidate = { ...f.candidate, name: 'Followup' };
    const reviewed = await (await f.api.POST(request('/api/creation-review', 'POST', { candidate }, cookie))).json();
    assert.equal(reviewed.review.status, 'allowed');
    const saved = await f.accounts.waveformPUT(request('/api/waveform', 'PUT', candidate, cookie));
    assert.equal(saved.status, 200); const id = (await saved.json()).waveform.id;
    const admin = await f.signIn('owner-admin');
    const row = (await (await f.api.adminGET(request('/api/creation-review/admin', 'GET', undefined, admin))).json()).reviews[0];
    const proof = { ownerUid: row.ownerUid, reviewId: row.reviewId, digest: row.digest, policyDigest: row.policyDigest, policyVersion: row.policyVersion, decision: 'revoked' };
    assert.equal((await f.api.adminPOST(request('/api/creation-review/admin', 'POST', proof, cookie))).status, 403);
    assert.equal((await f.api.adminPOST(request('/api/creation-review/admin', 'POST', proof, admin))).status, 200);
    assert.equal((await f.accounts.waveformPUT(request('/api/waveform', 'PUT', candidate, cookie))).status, 409);
    await assert.rejects(f.accounts.resolveVoiceWaveform(request('/api/session', 'GET', undefined, cookie), id, 'voice'), /safety review/);
  } finally { await f.cleanup(); }
});
