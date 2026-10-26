import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { createAccountServer, type FirebaseAccountAdapter } from '../lib/account-server';
import type { Waveform } from '../lib/account-model';
import { configuredFirebaseProjectId, createFirebaseAccountAdapter, getFirebaseAccountServices, supportedAccountClaims } from '../lib/firebase-accounts';
import { accountSessionId, activeAccountSession, createDurableAccountSessions } from '../lib/production-account-session';
import { configuredProxyHost, configuredPublicOrigin, isAllowedPublicHost, isAllowedRequest } from '../lib/request-origin';
import { INVITATIONS_COLLECTION, MEMBERS_COLLECTION, InvitationRequiredError, createInvitationAccess, generateInvitationCode, invitationCodeHash } from '../lib/invitations';

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
  const db = {
    collection: (collection: string) => ({ doc: (id: string) => ({
      path: `${collection}/${id}`,
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

test('paid test registration admits verified new accounts without invitations while disabled memberships remain blocked', async () => {
  const { db, rows } = fakeDatabase();
  const closed = createInvitationAccess(db, () => 100_000);
  assert.equal(await closed.admit('new-listener'), false);
  const open = createInvitationAccess(db, () => 100_000, true);
  assert.equal(await open.admit('new-listener'), true);
  assert.equal(await open.isMember('new-listener'), true);
  rows.set(`${MEMBERS_COLLECTION}/disabled-listener`, { state: 'disabled' });
  assert.equal(await open.admit('disabled-listener'), false);
  assert.equal(await open.admit('another-listener', 'invalid-invitation'), false);
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

test('invitation codes use one bounded canonical format and only hashes identify stored codes', async () => {
  const codes = Array.from({ length: 25 }, generateInvitationCode);
  assert.equal(new Set(codes).size, 25);
  for (const code of codes) {
    assert.match(code, /^FP-[A-F0-9]{24}$/);
    const hash = invitationCodeHash(code)!;
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(invitationCodeHash(` ${code.toLowerCase()} `), hash);
    assert.equal(hash.includes(code), false);
  }
  for (const code of [undefined, '', 'FP-short', 'https://example.com', 'FP-' + 'a'.repeat(25)]) {
    assert.equal(invitationCodeHash(code), null);
  }
});

test('a single invitation atomically admits one account and returning members need no code', async () => {
  const { db, rows } = fakeDatabase();
  const code = generateInvitationCode();
  const hash = invitationCodeHash(code)!;
  rows.set(`${INVITATIONS_COLLECTION}/${hash}`, { expiresAt: 200_000, usedBy: null, usedAt: null });
  const access = createInvitationAccess(db, () => 100_000);
  const results = await Promise.all(['first-owner', 'second-owner'].map(uid => access.admit(uid, code)));
  assert.deepEqual(results, [true, false]);
  assert.equal(await access.isMember('first-owner'), true);
  assert.equal(await access.isMember('second-owner'), false);
  assert.equal(await access.admit('first-owner'), true);
  assert.equal(await access.admit('first-owner', 'invalid'), true);
  assert.equal(await access.admit('third-owner', code), false);
  assert.equal(rows.get(`${INVITATIONS_COLLECTION}/${hash}`)?.usedBy, 'first-owner');
  assert.equal(JSON.stringify([...rows]).includes(code), false);
});

test('missing, expired, invalid and previously used invitations fail without creating membership', async () => {
  const { db, rows } = fakeDatabase();
  const access = createInvitationAccess(db, () => 100_000);
  for (const value of [undefined, 'invalid', generateInvitationCode()]) assert.equal(await access.admit(user.uid, value), false);
  for (const record of [
    { expiresAt: 100_000, usedBy: null, usedAt: null },
    { expiresAt: Infinity, usedBy: null, usedAt: null },
    { expiresAt: 200_000, usedBy: 'someone-else', usedAt: 1 },
    { expiresAt: 200_000 },
  ]) {
    const code = generateInvitationCode();
    rows.set(`${INVITATIONS_COLLECTION}/${invitationCodeHash(code)}`, record);
    assert.equal(await access.admit(user.uid, code), false);
  }
  assert.equal(rows.has(`${MEMBERS_COLLECTION}/${user.uid}`), false);
  const valid = generateInvitationCode();
  rows.set(`${INVITATIONS_COLLECTION}/${invitationCodeHash(valid)}`, { expiresAt: 200_000, usedBy: null, usedAt: null });
  rows.set(`${MEMBERS_COLLECTION}/${user.uid}`, { state: 'disabled' });
  assert.equal(await access.admit(user.uid, valid), false, 'another invitation cannot override a disabled membership');
});

test('verified Firebase identities cannot receive an application cookie before invitation admission', async () => {
  const { firebase, rows, issued } = actualAdapterFixture(false);
  const server = createAccountServer({ mode: 'firebase', firebase, development: () => false, publicOrigin: () => origin });
  for (const inviteCode of [undefined, 'invalid', generateInvitationCode()]) {
    const denied = await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token', inviteCode }));
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { code: 'invitation-required', error: new InvitationRequiredError().message });
    assert.equal(denied.headers.has('set-cookie'), false);
  }
  assert.equal(issued(), 0, 'no provider session cookie is minted for an uninvited identity');
  const code = generateInvitationCode();
  rows.set(`${INVITATIONS_COLLECTION}/${invitationCodeHash(code)}`, { expiresAt: Date.now() + 60_000, usedBy: null, usedAt: null });
  const admitted = await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token', inviteCode: code }));
  assert.equal(admitted.status, 200);
  assert.equal(rows.get(`${MEMBERS_COLLECTION}/${user.uid}`)?.state, 'active');
  const cookie = admitted.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await server.resolveOwner(request('account', 'GET', undefined, cookie)))?.uid, user.uid);
  const returning = await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token' }, cookie));
  assert.equal(returning.status, 200, 'membership persists after the invitation is consumed');
  for (const value of [null, 2, {}, 'x'.repeat(65)]) {
    assert.equal((await server.accountPOST(request('account', 'POST', { idToken: 'synthetic.id.token', inviteCode: value }))).status, 400);
  }
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
