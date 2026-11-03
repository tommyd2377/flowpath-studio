import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { createAccountServer, type FirebaseAccountAdapter } from '../lib/account-server';
import type { Waveform } from '../lib/account-model';
import { configuredFirebaseProjectId, createFirebaseAccountAdapter, getFirebaseAccountServices, supportedAccountClaims } from '../lib/firebase-accounts';
import { accountSessionId, activeAccountSession, createDurableAccountSessions } from '../lib/production-account-session';
import { configuredProxyHost, configuredPublicOrigin, isAllowedPublicHost, isAllowedRequest } from '../lib/request-origin';
import { MEMBERS_COLLECTION, BetaAccessRequiredError, createBetaMembershipAccess } from '../lib/membership';
import { demoGrantId, createDemoAccess } from '../lib/demo-access';
import { PaidMemoryDatabase } from './paid-fixture';

const origin = 'https://flowpath.studio';
const input = { name: 'Synthetic owner', initialPrompt: 'Discuss gardening.' };
const user = { uid: 'synthetic-owner', displayName: 'Synthetic owner' };
function request(path = 'account', method = 'GET', body?: unknown, cookie?: string, headers = {}) {
  return new Request(`${origin}/api/${path}`, {
    method, headers: { host: 'flowpath.studio', origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Serialized in-memory transactions: no emulator, project, credentials or network. */
function fakeDatabase() {
  const rows = new Map<string, Record<string, unknown>>();
  type Reference = { path: string };
  const snapshot = (ref: Reference) => ({ exists: rows.has(ref.path), data: () => rows.has(ref.path) ? structuredClone(rows.get(ref.path)) : undefined });
  let pending = Promise.resolve();
  type Collection = { doc(id: string): Reference & {
    collection(name: string): Collection;
    create(value: Record<string, unknown>): Promise<void>;
    get(): Promise<ReturnType<typeof snapshot>>;
  } };
  const db: { collection(name: string): Collection; runTransaction<T>(run: (transaction: {
    get(ref: Reference): Promise<ReturnType<typeof snapshot>>;
    update(ref: Reference, value: Record<string, unknown>): void;
    set(ref: Reference, value: Record<string, unknown>): void;
  }) => Promise<T>): Promise<T> } = {
    collection: (collection: string) => ({ doc: (id: string) => ({
      path: `${collection}/${id}`,
      collection: (name: string) => db.collection(`${collection}/${id}/${name}`),
      async create(value: Record<string, unknown>) {
        const path = `${collection}/${id}`;
        if (rows.has(path)) throw new Error('Already exists');
        rows.set(path, structuredClone(value));
      },
      async get() { return snapshot({ path: `${collection}/${id}` }); },
    }) }),
    runTransaction<T>(run: (transaction: {
      get(ref: Reference): Promise<ReturnType<typeof snapshot>>;
      update(ref: Reference, value: Record<string, unknown>): void;
      set(ref: Reference, value: Record<string, unknown>): void;
    }) => Promise<T>) {
      const result = pending.then(() => run({
        async get(ref) { return snapshot(ref); },
        update(ref, value) { rows.set(ref.path, { ...rows.get(ref.path), ...value }); },
        set(ref, value) { rows.set(ref.path, structuredClone(value)); },
      }));
      pending = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  return { rows, db: db as unknown as Firestore };
}

function firebaseFixture() {
  const { rows, db } = fakeDatabase();
  const sessions = createDurableAccountSessions(db);
  const cookies = new Set<string>();
  const records = new Map<string, Waveform>();
  const firebase: FirebaseAccountAdapter = {
    sessions,
    async signIn(token) {
      if (token !== 'synthetic.id.token') throw new Error('Rejected');
      const cookie = `synthetic.${randomUUID()}`;
      cookies.add(cookie);
      return { user, cookie };
    },
    async authenticate(cookie) { return cookies.has(cookie) ? user : null; },
    async readWaveform(uid) { return records.get(uid) ?? null; },
    async saveWaveform(uid, value, sessionId) {
      assert.ok(sessionId, 'production saves carry the durable account session');
      if (!await sessions.active(sessionId, uid)) throw new Error('Expired');
      const waveform: Waveform = { id: records.get(uid)?.id ?? randomUUID(), ...value, updatedAt: new Date().toISOString() };
      records.set(uid, waveform);
      return waveform;
    },
  };
  const options = { mode: 'firebase' as const, firebase, development: () => false, publicOrigin: () => origin };
  const server = createAccountServer(options);
  async function signIn() {
    const response = await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }));
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  }
  return { server, options, signIn, rows, records };
}

test('admin testing persists across instances and every read/write rechecks the verified role', async () => {
  const f = firebaseFixture();
  let admin = true;
  const base = f.options.firebase;
  const firebase: FirebaseAccountAdapter = { ...base,
    async signIn(...args) { const result = await base.signIn(...args); return { ...result, user: { ...result.user, ...(admin ? { role: 'admin' as const } : {}) } }; },
    async authenticate(cookie) { const owner = await base.authenticate(cookie); return owner ? { ...owner, ...(admin ? { role: 'admin' as const } : {}) } : null; },
  };
  const options = { ...f.options, firebase };
  const server = createAccountServer(options);
  const login = await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }));
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await server.waveformPUT(request('waveform', 'PUT', { ...input, adminTesting: true }, cookie))).status, 200);
  const saved = await server.resolveWaveform(request('waveform', 'GET', undefined, cookie));
  assert.equal(saved?.adminTesting, true);
  const fresh = createAccountServer(options);
  assert.equal((await fresh.resolveAdmin(request('account', 'GET', undefined, cookie)))?.testing, true);
  admin = false;
  assert.equal(await fresh.resolveAdmin(request('account', 'GET', undefined, cookie)), null);
  for (const adminTesting of [true, false]) assert.equal((await fresh.waveformPUT(request('waveform', 'PUT', { ...input, adminTesting }, cookie))).status, 403);
  assert.deepEqual(await fresh.resolveWaveform(request('waveform', 'GET', undefined, cookie)), saved);
  admin = true;
  assert.equal((await fresh.waveformPUT(request('waveform', 'PUT', { ...input, adminTesting: false }, cookie))).status, 200);
  assert.equal((await fresh.resolveAdmin(request('account', 'GET', undefined, cookie)))?.testing, false);
  assert.equal((await fresh.resolveWaveform(request('waveform', 'GET', undefined, cookie)))?.id, saved?.id);
  assert.equal((await fresh.waveformPUT(request('waveform', 'PUT', { ...input, adminTesting: 'true' }, cookie))).status, 400);
});

test('new memberships require the shared demo grant even when another test feature is enabled', async () => {
  const { db, rows } = fakeDatabase(); const access = createBetaMembershipAccess(db, () => 100_000), grant = 'a'.repeat(64);
  assert.equal(await access.admit('new-listener'), false);
  rows.set(`voiceDemoAccess/${grant}`, { state: 'active', expiresAt: 200_000 });
  assert.equal(await access.admit('new-listener', grant), true);
  rows.set(`${MEMBERS_COLLECTION}/disabled-listener`, { state: 'disabled' });
  assert.equal(await access.admit('disabled-listener', grant), false);
});

test('production requires explicit HTTPS origin and durable Firebase sessions; fixtures remain local', async () => {
  const { server, options } = firebaseFixture();
  for (const publicOrigin of [undefined, 'http://flowpath.studio', 'https://flowpath.studio/path', 'https://user:pass@flowpath.studio']) {
    assert.equal(configuredPublicOrigin(publicOrigin), undefined);
    const disabled = createAccountServer({ ...options, publicOrigin: () => publicOrigin });
    assert.equal((await disabled.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }))).status, 403);
  }
  const legacy = createAccountServer({ ...options, firebase: { ...options.firebase, sessions: undefined } });
  assert.equal((await (await legacy.accountGET(request())).json()).mode, 'unavailable');
  const local = createAccountServer({ ...options, mode: 'local' });
  assert.equal((await (await local.accountGET(request())).json()).mode, 'unavailable');
  for (const headers of [
    { host: 'attacker.example' }, { origin: 'https://attacker.example' }, { origin: '' },
    { 'sec-fetch-site': 'cross-site' }, { host: 'flowpath.studio:444' },
    { host: 'internal.run.app', 'x-forwarded-host': 'flowpath.studio', 'x-forwarded-proto': 'https' },
  ]) assert.equal((await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }, undefined, headers))).status, 403);
  assert.equal(isAllowedRequest(new Request('http://internal:8080/api/account', {
    headers: { host: 'flowpath.studio', origin },
  }), true, origin), true, 'the trusted incoming Host survives internal URL normalization');
});

test('production forwarding trusts only one pinned transport and one exact public host', async () => {
  const proxyHost = 'synthetic-backend-123456.us-east4.run.app';
  const { options } = firebaseFixture();
  const server = createAccountServer({ ...options, trustedProxyHost: () => proxyHost });
  const proxyHeaders = { host: proxyHost, 'x-forwarded-host': 'flowpath.studio' };
  assert.equal((await server.accountGET(request('account', 'GET', undefined, undefined, proxyHeaders))).status, 200);
  const admitted = await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }, undefined, proxyHeaders));
  assert.equal(admitted.status, 200);
  assert.match(admitted.headers.get('set-cookie')!, /Secure/);
  for (const headers of [
    { host: proxyHost }, { host: 'another.run.app', 'x-forwarded-host': 'flowpath.studio' },
    { ...proxyHeaders, 'x-forwarded-host': 'attacker.example' },
    { ...proxyHeaders, 'x-forwarded-host': 'flowpath.studio, attacker.example' },
    { ...proxyHeaders, 'x-forwarded-host': 'flowpath.studio, flowpath.studio' },
    { ...proxyHeaders, 'x-forwarded-host': 'https://flowpath.studio' },
    { ...proxyHeaders, origin: 'https://attacker.example' }, { ...proxyHeaders, origin: '' },
    { ...proxyHeaders, 'sec-fetch-site': 'cross-site' },
    { host: 'flowpath.studio', 'x-forwarded-host': 'attacker.example' },
    { host: 'flowpath.studio', 'x-forwarded-host': 'flowpath.studio, flowpath.studio' },
  ]) assert.equal((await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }, undefined, headers))).status, 403);
  assert.equal(isAllowedPublicHost(request('account', 'GET', undefined, undefined, proxyHeaders), origin), false);
  assert.equal(isAllowedPublicHost(request('account', 'GET', undefined, undefined, proxyHeaders), 'http://flowpath.studio', proxyHost), false);
  assert.equal(isAllowedPublicHost(request('account', 'GET', undefined, undefined, {
    'x-forwarded-host': 'flowpath.studio',
  }), origin), true, 'a direct canonical Host permits only matching forwarded metadata');
  assert.equal(configuredProxyHost(proxyHost), proxyHost);
  for (const invalid of [undefined, '', '*.run.app', 'proxy.run.app:443', 'https://proxy.run.app',
    'proxy.run.app,another.run.app', ' proxy.run.app ', 'Proxy.run.app', 'a..run.app', 'a'.repeat(64) + '.run.app']) {
    assert.equal(configuredProxyHost(invalid), undefined);
    assert.equal(isAllowedPublicHost(request('account', 'GET', undefined, undefined, proxyHeaders), origin, invalid), false);
  }
});

test('durable Firebase cookies work across app processes and logout revokes them everywhere', async () => {
  const { server, options, signIn, rows } = firebaseFixture();
  const login = await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }));
  assert.match(login.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict; Max-Age=432000; Secure/);
  const cookie = await signIn();
  const rawCookie = decodeURIComponent(cookie.split('=')[1]);
  const id = accountSessionId(rawCookie);
  assert.equal(rows.has(`ownerSessions/${id}`), true);
  assert.equal(JSON.stringify([...rows]).includes(rawCookie), false, 'only the cookie hash is persisted');
  assert.equal((await server.waveformPUT(request('waveform', 'PUT', input, cookie))).status, 200);
  const second = createAccountServer(options);
  assert.equal((await second.resolveOwner(request('account', 'GET', undefined, cookie)))?.uid, user.uid);
  const resolved = await second.resolveVoiceWaveform(request('waveform', 'GET', undefined, cookie));
  assert.equal(resolved?.accountSessionId, id);
  assert.equal(await resolved?.isCurrent(), true);
  const logout = await server.accountDELETE(request('account', 'DELETE', undefined, cookie));
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie')!, /Max-Age=0; Secure/);
  assert.equal(await second.resolveOwner(request('account', 'GET', undefined, cookie)), null);
  assert.equal(await resolved?.isCurrent(), false);
  assert.equal(await createAccountServer(options).resolveOwner(request('account', 'GET', undefined, cookie)), null);
});

test('managed Firebase clients receive only an explicit auto-configuration marker', async () => {
  const { options } = firebaseFixture();
  const server = createAccountServer({ ...options, firebaseAutoConfig: () => true });
  assert.deepEqual(await (await server.accountGET(request())).json(), {
    mode: 'firebase', user: null, autoFirebaseConfig: true,
  });
});

test('durable account changing blocks other processes until conversation cleanup is confirmed', async () => {
  const { options, signIn } = firebaseFixture();
  const cookie = await signIn();
  let started!: () => void, finish!: () => void;
  const cleaning = new Promise<void>(resolve => { started = resolve; });
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const first = createAccountServer({ ...options, beforeAccountChange: async () => { started(); await wait; return true; } });
  const second = createAccountServer(options);
  assert.equal((await first.waveformPUT(request('waveform', 'PUT', input, cookie))).status, 200);
  const lease = await second.resolveVoiceWaveform(request('waveform', 'GET', undefined, cookie));
  const logout = first.accountDELETE(request('account', 'DELETE', undefined, cookie));
  await cleaning;
  assert.equal(await lease?.isCurrent(), false);
  assert.equal(await second.resolveOwner(request('account', 'GET', undefined, cookie)), null);
  assert.equal((await second.waveformPUT(request('waveform', 'PUT', input, cookie))).status, 401);
  assert.equal((await second.accountDELETE(request('account', 'DELETE', undefined, cookie))).status, 503);
  finish();
  assert.equal((await logout).status, 200);
  assert.equal(await second.resolveOwner(request('account', 'GET', undefined, cookie)), null);
});

test('unconfirmed durable cleanup preserves the account cookie and active identity', async () => {
  const { options, signIn } = firebaseFixture();
  const cookie = await signIn();
  const server = createAccountServer({ ...options, beforeAccountChange: async () => false });
  const blocked = await server.accountDELETE(request('account', 'DELETE', undefined, cookie));
  assert.equal(blocked.status, 503);
  assert.equal(blocked.headers.has('set-cookie'), false);
  assert.equal((await server.resolveOwner(request('account', 'GET', undefined, cookie)))?.uid, user.uid);
});

test('durable session expiry, owner checks and abandoned changes fail closed', async () => {
  const { db } = fakeDatabase();
  let now = 100_000;
  const first = createDurableAccountSessions(db, () => now);
  const second = createDurableAccountSessions(db, () => now);
  const cookie = 'synthetic-secret-cookie';
  const id = accountSessionId(cookie);
  await first.create(cookie, user, now + 100_000);
  assert.equal(await second.active(id, user.uid), true);
  assert.equal(await second.active(id, 'another-owner'), false);
  assert.equal(activeAccountSession({ uid: user.uid, state: 'active', expiresAt: 'forever' }, user.uid, now), false);
  const change = await first.beginChange(id, user.uid);
  assert.ok(typeof change === 'object');
  assert.equal(await second.active(id, user.uid), false);
  assert.equal(await second.beginChange(id, user.uid), 'busy');
  now += 30_001;
  assert.equal(await second.active(id, user.uid), false, 'an abandoned change never silently restores admission');
  const takeover = await second.beginChange(id, user.uid);
  assert.ok(typeof takeover === 'object');
  assert.equal(await first.finishChange(id, user.uid, change.changeId, false), false);
  assert.equal(await second.finishChange(id, user.uid, takeover.changeId, false), true);
  assert.equal(await first.active(id, user.uid), true);
  now += 100_000;
  assert.equal(await first.active(id, user.uid), false);
  assert.equal(await first.beginChange(id, user.uid), 'inactive');
});

test('server claims allow Google and verified password sign-in only', () => {
  assert.equal(supportedAccountClaims({ firebase: { sign_in_provider: 'google.com' } }), true);
  assert.equal(supportedAccountClaims({ firebase: { sign_in_provider: 'password' }, email_verified: true }), true);
  for (const claims of [
    { firebase: { sign_in_provider: 'password' } }, { firebase: { sign_in_provider: 'password' }, email_verified: false },
    { firebase: { sign_in_provider: 'password' }, email_verified: 'true' }, { firebase: { sign_in_provider: 'anonymous' }, email_verified: true }, {},
  ]) assert.equal(supportedAccountClaims(claims), false);
});

test('managed Firebase project discovery uses only explicit or App Hosting metadata', () => {
  assert.equal(configuredFirebaseProjectId({ FIREBASE_CONFIG: JSON.stringify({ projectId: 'synthetic-project' }) }), 'synthetic-project');
  assert.equal(configuredFirebaseProjectId({ FLOWPATH_FIREBASE_PROJECT_ID: 'explicit-project', FIREBASE_CONFIG: JSON.stringify({ projectId: 'managed-project' }) }), 'explicit-project');
  for (const environment of [
    {}, { FIREBASE_CONFIG: '{invalid' }, { FIREBASE_CONFIG: JSON.stringify({ projectId: 'bad/path' }) },
    { FLOWPATH_FIREBASE_PROJECT_ID: 'bad/path', FIREBASE_CONFIG: JSON.stringify({ projectId: 'managed-project' }) },
    { GOOGLE_CLOUD_PROJECT: 'unselected-project' },
  ]) assert.equal(configuredFirebaseProjectId(environment), undefined);
});

function actualAdapterFixture(member = true) {
  const { db, rows } = fakeDatabase();
  if (member) rows.set(`${MEMBERS_COLLECTION}/${user.uid}`, { state: 'active', createdAt: Date.now() });
  let claims: Record<string, unknown> = { uid: user.uid, name: user.displayName,
    firebase: { sign_in_provider: 'password' }, email_verified: true, auth_time: Math.floor(Date.now() / 1000) };
  let issued = 0;
  const auth = {
    async verifyIdToken(_token: string, revoked: boolean) { assert.equal(revoked, true); return claims; },
    async createSessionCookie() { issued++; return 'signed.synthetic.jwt'; },
    async verifySessionCookie(token: string, revoked: boolean) {
      assert.equal(token, 'signed.synthetic.jwt'); assert.equal(revoked, true); return claims;
    },
  } as unknown as ReturnType<typeof getFirebaseAccountServices>['auth'];
  const firebase = createFirebaseAccountAdapter('synthetic-project', '(default)', () => ({ auth, db }));
  return { firebase, db, rows, issued: () => issued, setClaims: (next: Record<string, unknown>) => { claims = next; } };
}

test('Firebase token exchange enforces recent verified sign-in and creates distinct application sessions', async () => {
  const { firebase, issued, setClaims } = actualAdapterFixture();
  const valid = { uid: user.uid, firebase: { sign_in_provider: 'password' }, email_verified: true, auth_time: Math.floor(Date.now() / 1000) };
  for (const changed of [
    { email_verified: false }, { email_verified: 'true' }, { auth_time: valid.auth_time - 301 },
    { auth_time: valid.auth_time + 301 }, { firebase: { sign_in_provider: 'anonymous' } },
  ]) {
    setClaims({ ...valid, ...changed });
    await assert.rejects(firebase.signIn('synthetic.id.token'));
  }
  assert.equal(issued(), 0);
  setClaims(valid);
  const first = await firebase.signIn('synthetic.id.token');
  const second = await firebase.signIn('synthetic.id.token');
  assert.notEqual(first.cookie, second.cookie, 'identical Firebase JWTs must not revive a revoked application session');
  assert.equal((await firebase.authenticate(first.cookie))?.uid, user.uid);
  assert.equal(await firebase.authenticate(first.cookie.replace(/^[a-f0-9]+/, 'invalid')), null);
});

test('a settings save already past its route guard cannot commit after durable logout', async () => {
  const { firebase, rows } = actualAdapterFixture();
  let reached!: () => void, resume!: () => void;
  const saving = new Promise<void>(resolve => { reached = resolve; });
  const wait = new Promise<void>(resolve => { resume = resolve; });
  const options = { mode: 'firebase' as const, development: () => false, publicOrigin: () => origin, firebase };
  const first = createAccountServer({ ...options, firebase: { ...firebase, async saveWaveform(...args) {
    reached(); await wait; return firebase.saveWaveform(...args);
  } } });
  const second = createAccountServer(options);
  const login = await first.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }));
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const save = first.waveformPUT(request('waveform', 'PUT', input, cookie));
  await saving;
  assert.equal((await second.accountDELETE(request('account', 'DELETE', undefined, cookie))).status, 200);
  resume();
  assert.equal((await save).status, 401);
  assert.equal(rows.has(`ownerWaveforms/${user.uid}`), false, 'the transaction checks account state before writing');
});

test('the Firebase settings transaction preserves one private waveform under its active session', async () => {
  const { firebase, rows } = actualAdapterFixture();
  const server = createAccountServer({ mode: 'firebase', firebase, development: () => false, publicOrigin: () => origin });
  const login = await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }));
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const first = await server.waveformPUT(request('waveform', 'PUT', input, cookie));
  assert.equal(first.status, 200);
  const waveform = (await first.json()).waveform;
  const edited = await server.waveformPUT(request('waveform', 'PUT', { ...input, name: 'Another name' }, cookie));
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).waveform.id, waveform.id);
  assert.equal(rows.has(`ownerWaveforms/${user.uid}`), true);
  await assert.rejects(firebase.saveWaveform(user.uid, waveform), /no longer active/);
});

test('one shared grant can admit multiple verified UIDs atomically; returning members need no code', async () => {
  const { db, rows } = fakeDatabase(), grant = 'a'.repeat(64);
  rows.set(`voiceDemoAccess/${grant}`, { state: 'active', expiresAt: 200_000 });
  const access = createBetaMembershipAccess(db, () => 100_000);
  assert.deepEqual(await Promise.all(['first', 'second', 'first'].map(uid => access.admit(uid, grant))), [true, true, true]);
  assert.equal(await access.admit('first'), true);
  rows.set(`voiceDemoAccess/${grant}`, { state: 'expired', expiresAt: 99_000 });
  assert.equal(await access.admit('first', grant), true);
  assert.equal(await access.admit('third', grant), false);
  assert.equal(rows.get(`${MEMBERS_COLLECTION}/first`)?.admission, 'beta-code');
});

test('missing, malformed, expired or non-active grants cannot create or restore membership', async () => {
  const { db, rows } = fakeDatabase(), grant = 'b'.repeat(64), access = createBetaMembershipAccess(db, () => 100_000);
  for (const value of [undefined, 'nyc-1776', 'not-a-grant', grant]) assert.equal(await access.admit(user.uid, value), false);
  for (const record of [{ state: 'active', expiresAt: 100_000 }, { state: 'active', expiresAt: Infinity }, { state: 'revoked', expiresAt: 200_000 }, { expiresAt: 200_000 }]) {
    rows.set(`voiceDemoAccess/${grant}`, record); assert.equal(await access.admit(user.uid, grant), false);
  }
  assert.equal(rows.has(`${MEMBERS_COLLECTION}/${user.uid}`), false);
  rows.set(`voiceDemoAccess/${grant}`, { state: 'active', expiresAt: 200_000 });
  rows.set(`${MEMBERS_COLLECTION}/${user.uid}`, { state: 'disabled' });
  assert.equal(await access.admit(user.uid, grant), false);
});

test('full localhost grant namespace is isolated from hosted signup grants', async () => {
  const { db, rows } = fakeDatabase(), grant = 'c'.repeat(64);
  rows.set(`localStudio_voiceDemoAccess/${grant}`, { state: 'active', expiresAt: 200_000 });
  assert.equal(await createBetaMembershipAccess(db, () => 100_000).admit('hosted', grant), false);
  assert.equal(await createBetaMembershipAccess(db, () => 100_000, 'localStudio_voiceDemoAccess').admit('local', grant), true);
});

test('the exact demo code enrolls through its HttpOnly grant; raw browser claims never mint account sessions', async () => {
  const { firebase, rows, issued } = actualAdapterFixture(false);
  const server = createAccountServer({ mode: 'firebase', firebase, membershipGrant: demoGrantId, development: () => false, publicOrigin: () => origin });
  const denied = await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }));
  assert.equal(denied.status, 403); assert.deepEqual(await denied.json(), { code: 'beta-access-required', error: new BetaAccessRequiredError().message });
  assert.equal(issued(), 0); assert.equal(denied.headers.has('set-cookie'), false);
  for (const payload of [{ inviteCode: 'retired' }, { code: 'nyc-1776' }, { demoGrant: 'a'.repeat(64) }, { allowed: true }]) {
    assert.equal((await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token', ...payload }))).status, 400);
  }
  const database = new PaidMemoryDatabase(), gate = createDemoAccess(database, { enabled: () => true, publicOrigin: origin });
  const pair = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];
  const challenge = pair(await gate.GET(request('demo-access')));
  for (const code of ['NYC-1776', 'nyc-1776 ']) assert.equal((await gate.POST(request('demo-access', 'POST', { code }, challenge))).status, 403);
  const accepted = await gate.POST(request('demo-access', 'POST', { code: 'nyc-1776' }, challenge));
  assert.equal(accepted.status, 200); const grantCookie = pair(accepted);
  for (const [path, row] of database.rows) rows.set(path, structuredClone(row));
  const admitted = await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }, grantCookie));
  assert.equal(admitted.status, 200); assert.equal(rows.get(`${MEMBERS_COLLECTION}/${user.uid}`)?.state, 'active');
  const cookie = pair(admitted);
  assert.equal((await server.resolveOwner(request('account', 'GET', undefined, cookie)))?.uid, user.uid);
  assert.equal((await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }, cookie))).status, 200);
});

test('Firebase founder preference is account-wide, preserves legacy data and survives concurrent creation', async () => {
  const { firebase, rows, setClaims } = actualAdapterFixture();
  setClaims({ uid: user.uid, email: 'tomdevito27@gmail.com', email_verified: true,
    firebase: { sign_in_provider: 'google.com' }, auth_time: Math.floor(Date.now() / 1000) });
  const options = { mode: 'firebase' as const, firebase, development: () => false, publicOrigin: () => origin };
  const server = createAccountServer(options);
  const login = await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }));
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const first = { id: randomUUID(), ...input, adminTesting: true, updatedAt: new Date().toISOString() };
  const second = { ...first, id: randomUUID(), name: 'Second', adminTesting: false };
  rows.set(`ownerWaveforms/${user.uid}`, first);
  rows.set(`ownerWaveforms/${user.uid}/waveforms/${second.id}`, second);
  rows.set(`ownerWaveformLists/${user.uid}`, { ids: [second.id] });
  assert.equal((await firebase.readWaveform(user.uid, second.id))?.adminTesting, true, 'legacy first-waveform preference applies account-wide');
  assert.deepEqual(rows.get(`ownerWaveforms/${user.uid}`), first, 'read does not migrate saved content');
  assert.equal((await server.waveformPUT(request(`waveform?id=${second.id}`, 'PUT', { ...input, adminTesting: false }, cookie))).status, 200);
  assert.equal(rows.get(`ownerWaveformLists/${user.uid}`)?.adminTesting, false);
  assert.deepEqual(rows.get(`ownerWaveforms/${user.uid}`), first, 'changing the preference does not rewrite sibling content');
  const fresh = createAccountServer(options);
  for (const id of [first.id, second.id]) assert.equal((await fresh.resolveAdmin(request(`session?waveformId=${id}`, 'GET', undefined, cookie)))?.testing, false);
  const creates = await Promise.all([1, 2].map(i => fresh.waveformPUT(request(`waveform?id=${randomUUID()}`, 'POST', { ...input, name: `New ${i}` }, cookie), true)));
  assert.ok(creates.every(r => r.status === 200));
  assert.equal(rows.get(`ownerWaveformLists/${user.uid}`)?.adminTesting, false, 'creation preserves the account preference');
  assert.equal((await fresh.waveformPUT(request(`waveform?id=${second.id}`, 'PUT', { ...input, adminTesting: true }, cookie))).status, 200);
  const all = await firebase.listWaveforms!(user.uid);
  assert.equal(all.length, 4); assert.ok(all.every(w => w.adminTesting === true));
  assert.equal((await fresh.waveformPUT(request(`waveform?id=${second.id}`, 'PUT', input, cookie))).status, 200);
  assert.ok((await firebase.listWaveforms!(user.uid)).every(w => w.adminTesting === true), 'an ordinary save cannot reset testing');
  const indexPath = `ownerWaveformLists/${user.uid}`, validIndex = structuredClone(rows.get(indexPath)!);
  for (const invalid of ['true', null, 1]) {
    rows.set(indexPath, { ...validIndex, adminTesting: invalid });
    await assert.rejects(firebase.readWaveform(user.uid, second.id), /Invalid account testing preference/);
  }
  rows.set(indexPath, validIndex);
  setClaims({ uid: user.uid, email: 'another@gmail.com', email_verified: true,
    firebase: { sign_in_provider: 'google.com' }, auth_time: Math.floor(Date.now() / 1000) });
  assert.equal(await fresh.resolveAdmin(request(`session?waveformId=${first.id}`, 'GET', undefined, cookie)), null);
  assert.equal((await fresh.waveformPUT(request(`waveform?id=${second.id}`, 'PUT', { ...input, adminTesting: true }, cookie))).status, 403);
});

test('only the verified founder Google claims grant admin, regardless of browser display name', async () => {
  const { accountRole } = await import('../lib/firebase-accounts');
  const claims = { email: 'TomDevito27@gmail.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
  assert.equal(accountRole(claims), 'admin');
  for (const value of [
    { ...claims, email: 'another@gmail.com' }, { ...claims, email: undefined },
    { ...claims, email_verified: false }, { ...claims, email_verified: 'true' },
    { ...claims, firebase: { sign_in_provider: 'password' } }, { ...claims, firebase: undefined },
  ]) assert.equal(accountRole(value), undefined);
});

test('ordinary Firebase member keeps a legacy waveform and atomically caps concurrent creations at ten', async () => {
  const { firebase, rows } = actualAdapterFixture();
  const server = createAccountServer({ mode: 'firebase', firebase, development: () => false, publicOrigin: () => origin });
  const login = await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }));
  assert.equal((await login.clone().json()).user.role, undefined);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  // This legacy record has no voice/appearance, index, or migration marker.
  const legacy = { id: randomUUID(), name: 'Legacy', initialPrompt: 'Existing private instructions.', updatedAt: new Date().toISOString() };
  rows.set(`ownerWaveforms/${user.uid}`, legacy);
  const before = structuredClone(legacy);
  assert.equal((await firebase.listWaveforms!(user.uid)).length, 1);
  assert.deepEqual(rows.get(`ownerWaveforms/${user.uid}`), before, 'listing never rewrites legacy data');
  const ids = Array.from({ length: 12 }, () => randomUUID());
  const replies = await Promise.all(ids.map((id, i) => server.waveformPUT(request(`waveform?id=${id}`, 'POST', { ...input, name: `Wave ${i}` }, cookie), true)));
  assert.equal(replies.filter(r => r.status === 200).length, 9);
  assert.equal(replies.filter(r => r.status === 409).length, 3);
  const saved = (await (await server.waveformGET(request('waveform', 'GET', undefined, cookie))).json()).waveforms;
  assert.equal(saved.length, 10); assert.equal(new Set(saved.map((w: Waveform) => w.id)).size, 10);
  const second = saved[1];
  assert.equal((await server.waveformPUT(request(`waveform?id=${second.id}`, 'PUT', { ...input, voice: 'meridian', accentColor: '#e25555', textPanel: { type: 'text', version: 2 } }, cookie))).status, 200);
  assert.equal((await firebase.readWaveform(user.uid, second.id))?.voice, 'meridian');
  assert.deepEqual(rows.get(`ownerWaveforms/${user.uid}`), before);
  assert.equal(await firebase.readWaveform('another-owner', second.id), null);
  assert.equal((await server.waveformPUT(request(`waveform?id=${randomUUID()}`, 'PUT', input, cookie))).status, 404);
  assert.equal((await server.waveformPUT(request(`waveform?id=${second.id}`, 'POST', input, cookie), true)).status, 409);
  assert.equal((await server.waveformPUT(request(`waveform?id=${second.id}`, 'PUT', { ...input, adminTesting: true }, cookie))).status, 403);
  await server.accountDELETE(request('account', 'DELETE', undefined, cookie));
  await assert.rejects(firebase.saveWaveform(user.uid, { ...input, voice: 'marin', accentColor: '#3a66ff', profilePhoto: null }, accountSessionId(decodeURIComponent(cookie.split('=')[1])), second.id), /no longer active/);
});
