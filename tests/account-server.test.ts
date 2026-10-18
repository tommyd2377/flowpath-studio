import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAccountServer, waveformRecord, type FirebaseAccountAdapter } from '../lib/account-server';
import type { Waveform } from '../lib/account-model';

const origin = 'http://127.0.0.1:3220';
const input = { name: 'Tom’s waveform', initialPrompt: 'You are Tom’s assistant. Speak warmly and keep answers concise.' };

function request(path: string, method = 'GET', body?: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/${path}`, {
    method,
    headers: { host: '127.0.0.1:3220', origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function harness(t: { after: (fn: () => Promise<void>) => void }, extra: Parameters<typeof createAccountServer>[0] = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-accounts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = { mode: 'local' as const, development: () => true, localDirectory: directory, ...extra };
  const server = createAccountServer(settings);
  async function signIn(localAccount = 'owner-a') {
    const response = await server.accountPOST(request('account', 'POST', { localAccount }));
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  }
  return { server, settings, directory, signIn };
}

test('account mode is unavailable by default and synthetic sign-in is development-only', async t => {
  const { server, directory } = await harness(t, {
    mode: undefined,
    firebaseConfig: () => { throw new Error('Disabled account modes must not access Firebase configuration'); },
  });
  assert.deepEqual(await (await server.accountGET(request('account'))).json(), { mode: 'unavailable', user: null });
  assert.equal((await server.accountPOST(request('account', 'POST', { localAccount: 'owner-a' }))).status, 503);
  const production = createAccountServer({ mode: 'local', development: () => false, localDirectory: directory });
  assert.equal((await (await production.accountGET(request('account'))).json()).mode, 'unavailable');
  assert.equal((await production.accountPOST(request('account', 'POST', { localAccount: 'owner-a' }))).status, 503);
  assert.deepEqual(await readdir(directory), []);
});

test('local test identity uses an opaque HttpOnly cookie and never accepts a client UID', async t => {
  const { server, signIn } = await harness(t);
  assert.equal((await server.accountPOST(request('account', 'POST', { uid: 'local-owner-a' }))).status, 400);
  assert.equal((await server.accountPOST(request('account', 'POST', { localAccount: 'owner-a', uid: 'local-owner-b' }))).status, 400);
  assert.equal((await server.accountPOST(request('account', 'POST', { localAccount: '__proto__' }))).status, 400);
  const response = await server.accountPOST(request('account', 'POST', { localAccount: 'owner-a' }));
  const setCookie = response.headers.get('set-cookie')!;
  assert.match(setCookie, /HttpOnly; SameSite=Strict; Max-Age=432000/);
  assert.equal(setCookie.includes('owner-a'), false);
  const cookie = await signIn();
  assert.deepEqual(await (await server.accountGET(request('account', 'GET', undefined, cookie))).json(), {
    mode: 'local', user: { uid: 'local-owner-a', displayName: 'Test owner A' },
  });
  assert.equal(await server.resolveOwner(request('account', 'GET', undefined, 'flowpath_account=local-owner-a')), null);
  assert.equal(await server.resolveOwner(request('account', 'GET', undefined, `${cookie}; ${cookie}`)), null);
});

test('all account and waveform mutations require exact local origin and host', async t => {
  const { server, signIn } = await harness(t);
  const cookie = await signIn();
  const headerSets: Record<string, string>[] = [
    { origin: 'https://attacker.example' },
    { origin: '' },
    { host: 'attacker.example' },
    { 'sec-fetch-site': 'cross-site' },
    { host: '127.0.0.1:3225' },
  ];
  for (const headers of headerSets) {
    assert.equal((await server.accountPOST(request('account', 'POST', { localAccount: 'owner-a' }, cookie, headers))).status, 403);
    assert.equal((await server.accountDELETE(request('account', 'DELETE', undefined, cookie, headers))).status, 403);
    assert.equal((await server.waveformPUT(request('waveform', 'PUT', input, cookie, headers))).status, 403);
    if (!('origin' in headers) || headers.origin) assert.equal((await server.waveformGET(request('waveform', 'GET', undefined, cookie, headers))).status, 403);
  }
  const remote = new Request('https://flowpathapp.com/api/account', { headers: { host: 'flowpathapp.com' } });
  assert.equal((await server.accountGET(remote)).status, 403);
  const normalized = new Request('http://localhost:3220/api/account', { headers: { host: '127.0.0.1:3220', origin, cookie } });
  assert.equal((await server.accountGET(normalized)).status, 200);
});

test('one saved waveform stays private to its verified owner and keeps its stable ID', async t => {
  const { server, signIn } = await harness(t);
  assert.equal((await server.waveformGET(request('waveform'))).status, 401);
  assert.equal((await server.waveformPUT(request('waveform', 'PUT', input))).status, 401);
  const ownerA = await signIn();
  assert.deepEqual(await (await server.waveformGET(request('waveform', 'GET', undefined, ownerA))).json(), { waveform: null });
  const saved = (await (await server.waveformPUT(request('waveform', 'PUT', input, ownerA))).json()).waveform as Waveform;
  assert.match(saved.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ name: saved.name, initialPrompt: saved.initialPrompt }, input);
  assert.equal(saved.voice, 'marin');
  const edited = (await (await server.waveformPUT(request('waveform', 'PUT', { ...input, name: 'Updated waveform' }, ownerA))).json()).waveform;
  assert.equal(edited.id, saved.id);
  const ownerB = await signIn('owner-b');
  assert.deepEqual(await (await server.waveformGET(request('waveform', 'GET', undefined, ownerB))).json(), { waveform: null });
  assert.equal((await server.waveformGET(request(`waveform?id=${saved.id}`, 'GET', undefined, ownerB))).status, 404);
  assert.equal(await server.resolveVoiceWaveform(request('session', 'GET', undefined, ownerB), saved.id), null);
  const resolved = await server.resolveVoiceWaveform(request('session', 'GET', undefined, ownerA), saved.id);
  assert.equal(resolved?.ownerUid, 'local-owner-a');
  assert.deepEqual(resolved?.waveform, edited);
  assert.equal(resolved?.isCurrent(), true);
  const other = (await (await server.waveformPUT(request('waveform', 'PUT', { ...input, name: 'Another owner' }, ownerB))).json()).waveform;
  assert.notEqual(other.id, saved.id);
  assert.equal((await server.waveformGET(request(`waveform?id=${other.id}`, 'GET', undefined, ownerA))).status, 404);
  assert.equal((await server.waveformGET(request('waveform?id=', 'GET', undefined, ownerA))).status, 404);
});

test('synthetic prompts persist across sign-out and a fresh server without retaining the auth session', async t => {
  const { server, signIn, settings } = await harness(t);
  const cookie = await signIn();
  const waveform = (await (await server.waveformPUT(request('waveform', 'PUT', input, cookie))).json()).waveform;
  const resolved = await server.resolveVoiceWaveform(request('session', 'GET', undefined, cookie), waveform.id);
  assert.equal(resolved?.isCurrent(), true);
  const logout = await server.accountDELETE(request('account', 'DELETE', undefined, cookie));
  assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/);
  assert.equal(await server.resolveOwner(request('account', 'GET', undefined, cookie)), null);
  assert.equal(resolved?.isCurrent(), false, 'an already-resolved voice request must be invalidated before reservation');
  const fresh = createAccountServer(settings);
  assert.equal(await fresh.resolveOwner(request('account', 'GET', undefined, cookie)), null);
  const login = await fresh.accountPOST(request('account', 'POST', { localAccount: 'owner-a' }));
  const nextCookie = login.headers.get('set-cookie')!.split(';')[0];
  assert.deepEqual(await (await fresh.waveformGET(request('waveform', 'GET', undefined, nextCookie))).json(), { waveform });
});

test('simultaneous first saves create one stable waveform rather than duplicate documents', async t => {
  const { server, signIn } = await harness(t);
  const cookie = await signIn();
  const responses = await Promise.all(['First', 'Second', 'Third'].map(name => server.waveformPUT(request('waveform', 'PUT', { ...input, name }, cookie))));
  const waveforms = await Promise.all(responses.map(async response => {
    assert.equal(response.status, 200);
    return (await response.json()).waveform;
  }));
  assert.equal(new Set(waveforms.map(waveform => waveform.id)).size, 1);
  assert.equal((await (await server.waveformGET(request('waveform', 'GET', undefined, cookie))).json()).waveform.name, 'Third');
});

test('prompt validation rejects oversized bodies, owner fields, invalid content and waveform selectors', async t => {
  const { server, signIn } = await harness(t);
  const cookie = await signIn();
  for (const body of [
    { ...input, ownerUid: 'local-owner-b' },
    { ...input, id: 'client-selected-id' },
    { ...input, voice: 'unavailable-voice' },
    { ...input, voice: { id: 'custom-voice' } },
    { ...input, voice: null },
    { ...input, name: ' ' },
    { ...input, name: 'a'.repeat(81) },
    { ...input, initialPrompt: '' },
    { ...input, initialPrompt: 'a'.repeat(4_001) },
    { ...input, initialPrompt: 'a'.repeat(21_000) },
    { ...input, name: 'Hidden\u0000text' },
    { ...input, initialPrompt: 'Hidden\u0000text' },
    [], null,
  ]) assert.equal((await server.waveformPUT(request('waveform', 'PUT', body, cookie))).status, 400);
  assert.equal((await server.waveformGET(request('waveform?uid=local-owner-b', 'GET', undefined, cookie))).status, 400);
  assert.equal((await server.waveformGET(request('waveform?id=a&id=b', 'GET', undefined, cookie))).status, 400);
  assert.equal((await server.waveformPUT(request('waveform', 'PUT', input, cookie, { 'content-type': 'text/plain' }))).status, 400);
  assert.equal((await server.waveformPUT(request('waveform', 'PUT', input, cookie, { 'content-length': '999999' }))).status, 400);
  assert.deepEqual(await (await server.waveformGET(request('waveform', 'GET', undefined, cookie))).json(), { waveform: null });
});

test('a saved voice survives reload and changing it preserves waveform identity and prompt', async t => {
  const { server, signIn, settings } = await harness(t);
  const cookie = await signIn();
  const first = (await (await server.waveformPUT(request('waveform', 'PUT', { ...input, voice: 'meridian' }, cookie))).json()).waveform;
  assert.equal(first.voice, 'meridian');
  const changed = (await (await server.waveformPUT(request('waveform', 'PUT', { ...input, voice: 'vesper' }, cookie))).json()).waveform;
  assert.equal(changed.id, first.id);
  assert.equal(changed.initialPrompt, first.initialPrompt);
  const fresh = createAccountServer(settings);
  const login = await fresh.accountPOST(request('account', 'POST', { localAccount: 'owner-a' }));
  const newCookie = login.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await (await fresh.waveformGET(request('waveform', 'GET', undefined, newCookie))).json()).waveform.voice, 'vesper');
});

test('legacy records without a voice read as Marin without rewriting saved instructions', async t => {
  const { server, directory, signIn } = await harness(t);
  const legacy = { id: randomUUID(), ...input, updatedAt: new Date().toISOString() };
  const filename = `${createHash('sha256').update('local-owner-a').digest('hex')}.json`;
  await writeFile(join(directory, filename), JSON.stringify(legacy));
  const cookie = await signIn();
  const loaded = (await (await server.waveformGET(request('waveform', 'GET', undefined, cookie))).json()).waveform;
  assert.deepEqual(loaded, { ...legacy, voice: 'marin' });
  assert.equal(waveformRecord({ ...legacy, voice: 'not-a-supported-voice' }), null);
});

test('expired local sessions cannot read or overwrite the saved prompt', async t => {
  let now = 100_000;
  const { server, signIn } = await harness(t, { now: () => now });
  const cookie = await signIn();
  await server.waveformPUT(request('waveform', 'PUT', input, cookie));
  now += 5 * 24 * 60 * 60 * 1_000;
  assert.equal((await server.waveformGET(request('waveform', 'GET', undefined, cookie))).status, 401);
  assert.equal((await server.waveformPUT(request('waveform', 'PUT', input, cookie))).status, 401);
});

test('account switching and sign-out wait for confirmed conversation cleanup and retain the current cookie when blocked', async t => {
  let allowed = false;
  let cleanupCalls = 0;
  const owners: string[] = [];
  const { server, signIn } = await harness(t, {
    async beforeAccountChange(owner) {
      cleanupCalls++;
      owners.push(owner.uid);
      return allowed;
    },
  });
  const ownerA = await signIn();
  assert.equal(cleanupCalls, 0, 'initial sign-in has no prior owner');
  assert.equal((await server.accountPOST(request('account', 'POST', { localAccount: 'invalid' }, ownerA))).status, 400);
  assert.equal(cleanupCalls, 0, 'invalid sign-in does not cancel a conversation');
  for (const response of [
    await server.accountPOST(request('account', 'POST', { localAccount: 'owner-b' }, ownerA)),
    await server.accountDELETE(request('account', 'DELETE', undefined, ownerA)),
  ]) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.has('set-cookie'), false);
    assert.match((await response.json()).error, /previous conversation is still finishing/);
    assert.equal((await server.resolveOwner(request('account', 'GET', undefined, ownerA)))?.uid, 'local-owner-a');
  }
  allowed = true;
  const switched = await server.accountPOST(request('account', 'POST', { localAccount: 'owner-b' }, ownerA));
  assert.equal(switched.status, 200);
  const ownerB = switched.headers.get('set-cookie')!.split(';')[0];
  assert.equal(await server.resolveOwner(request('account', 'GET', undefined, ownerA)), null);
  assert.equal((await server.resolveOwner(request('account', 'GET', undefined, ownerB)))?.uid, 'local-owner-b');
  assert.equal((await server.accountDELETE(request('account', 'DELETE', undefined, ownerB))).status, 200);
  assert.equal(await server.resolveOwner(request('account', 'GET', undefined, ownerB)), null);
  assert.deepEqual(owners, ['local-owner-a', 'local-owner-a', 'local-owner-a', 'local-owner-b']);
});

test('a delayed settings save cannot write after its account signs out', async t => {
  const { server, signIn } = await harness(t);
  const cookie = await signIn();
  let complete!: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      complete = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(input))); controller.close(); };
    },
  });
  const delayed = new Request(`${origin}/api/waveform`, {
    method: 'PUT', body, duplex: 'half',
    headers: { host: '127.0.0.1:3220', origin, cookie, 'content-type': 'application/json' },
  } as RequestInit);
  const save = server.waveformPUT(delayed);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await server.accountDELETE(request('account', 'DELETE', undefined, cookie))).status, 200);
  complete();
  assert.equal((await save).status, 401);
  const nextCookie = await signIn();
  assert.deepEqual(await (await server.waveformGET(request('waveform', 'GET', undefined, nextCookie))).json(), { waveform: null });
});

test('Firebase adapter verifies server cookies and derives document ownership from that verification', async t => {
  const records = new Map<string, Waveform>();
  let verifications = 0;
  const firebase: FirebaseAccountAdapter = {
    async signIn(token) {
      if (token !== 'synthetic.id.token') throw new Error('Private provider detail');
      return { user: { uid: 'firebase-owner-a', displayName: 'Synthetic Firebase owner' }, cookie: 'verified.synthetic.cookie' };
    },
    async authenticate(cookie) {
      verifications++;
      return cookie === 'verified.synthetic.cookie' ? { uid: 'firebase-owner-a', displayName: 'Synthetic Firebase owner' } : null;
    },
    async readWaveform(uid) { return records.get(uid) ?? null; },
    async saveWaveform(uid, value) {
      const waveform = { ...value, id: records.get(uid)?.id ?? '12345678-1234-4234-8234-123456789012', updatedAt: '2026-10-18T12:00:00.000Z' };
      records.set(uid, waveform);
      return waveform;
    },
  };
  const { server } = await harness(t, { mode: 'firebase', firebase });
  const rejected = await server.accountPOST(request('account', 'POST', { idToken: 'unverified' }));
  assert.equal(rejected.status, 401);
  assert.equal((await rejected.text()).includes('Private provider detail'), false);
  const login = await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }));
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await server.waveformPUT(request('waveform', 'PUT', input, cookie))).status, 200);
  assert.equal(records.has('firebase-owner-a'), true);
  verifications = 0;
  assert.equal((await server.resolveVoiceWaveform(request('session', 'GET', undefined, cookie)))?.ownerUid, 'firebase-owner-a');
  assert.equal(verifications, 1);
  assert.equal((await server.waveformGET(request('waveform', 'GET', undefined, 'flowpath_account=local-owner-a'))).status, 401);
  assert.equal((await server.accountPOST(request('account', 'POST', { localAccount: 'owner-a' }))).status, 400);
  const resolved = await server.resolveVoiceWaveform(request('session', 'GET', undefined, cookie));
  assert.equal(resolved?.isCurrent(), true);
  assert.equal((await server.accountDELETE(request('account', 'DELETE', undefined, cookie))).status, 200);
  assert.equal(resolved?.isCurrent(), false);
  assert.equal(await server.resolveOwner(request('account', 'GET', undefined, cookie)), null, 'a still-cryptographically-valid Firebase cookie cannot be replayed after local sign-out');
});

test('storage failures return a bounded generic error without exposing provider data', async t => {
  const firebase: FirebaseAccountAdapter = {
    async signIn() { return { user: { uid: 'synthetic', displayName: 'Test owner' }, cookie: 'synthetic.cookie' }; },
    async authenticate() { return { uid: 'synthetic', displayName: 'Test owner' }; },
    async readWaveform() { throw new Error('Private provider detail'); },
    async saveWaveform() { throw new Error('Private provider detail'); },
  };
  const { server } = await harness(t, { mode: 'firebase', firebase });
  const login = await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }));
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  for (const response of [
    await server.waveformGET(request('waveform', 'GET', undefined, cookie)),
    await server.waveformPUT(request('waveform', 'PUT', input, cookie)),
  ]) {
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('Private provider detail'), false);
  }
});
