import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createPluginAccess, PluginAccessError, type PluginAccessScope, type ProtectedPlugin } from '../lib/plugin-access';
import { clearPluginGrantCookies, createPluginAccessServer, pluginAccessToken } from '../lib/plugin-access-server';
import { PaidMemoryDatabase } from './paid-fixture';

const origin = 'https://voice.example';
const code = 'synthetic-code-only';
const scope: PluginAccessScope = { ownerUid: 'owner-a', accountUid: 'owner-a', waveformId: 'fixture-waveform-a', sessionId: 'fixture-session-a' };
function fixture() {
  const db = new PaidMemoryDatabase(); let current = true, updateFails = false;
  const updates: { sessionId?: string; plugins: ProtectedPlugin[] }[] = [];
  const access = createPluginAccess(db, { authorize: async () => { if (!current) throw new PluginAccessError('Sign in again.'); }, assertPolicyMutable: async () => {} });
  const server = createPluginAccessServer({ access, publicOrigin: origin,
    resolve: async request => request.headers.get('X-Synthetic-Owner') === 'owner-a' ? { identity: scope, installed: ['text', 'visual'] } : null,
    activate: async (_request, _scope, _token, plugins, sessionId) => { if (updateFails) throw new Error('synthetic provider failure'); updates.push({ sessionId, plugins }); },
  });
  const request = (method: string, body?: object, cookie = '', owner = 'owner-a', cross = false) => new Request(`${origin}/api/plugin-access?waveformId=fixture-waveform-a`, {
    method, headers: { host: 'voice.example', origin: cross ? 'https://evil.example' : origin, 'content-type': 'application/json', cookie, 'X-Synthetic-Owner': owner },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const protect = () => server.PUT(request('PUT', { revision: 'off', protectedPlugins: ['text', 'visual'], code }));
  return { access, db, server, request, protect, updates, revoke: () => { current = false; }, failUpdate: () => { updateFails = true; } };
}

test('HTTP settings default off; direct owner and origin bypasses cannot read/write policy', async () => {
  const f = fixture();
  assert.deepEqual(await (await f.server.GET(f.request('GET'))).json(), { revision: 'off', protectedPlugins: [], codeConfigured: false });
  assert.equal((await f.server.GET(f.request('GET', undefined, '', 'owner-b'))).status, 403);
  assert.equal((await f.server.PUT(f.request('PUT', { revision: 'off', protectedPlugins: ['text'], code }, '', 'owner-a', true))).status, 403);
  assert.equal(f.db.rows.size, 0);
});

test('HTTP unlock uses an opaque HttpOnly cookie; a selected plugin cannot expose another or alter voice automatically', async () => {
  const f = fixture(); assert.equal((await f.protect()).status, 200);
  const result = await f.server.POST(f.request('POST', { code, plugins: ['text'] }));
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.deepEqual(Object.keys(body).sort(), ['allowedPlugins', 'expiresAt']);
  const cookie = result.headers.get('set-cookie')!;
  assert.match(cookie, /^__Host-flowpath_plugin_/); assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=1800; Secure$/);
  const token = pluginAccessToken(f.request('GET', undefined, cookie.split(';')[0]), scope.waveformId, true)!;
  await f.access.check(scope, ['text'], token);
  await assert.rejects(f.access.check(scope, ['visual'], token), (error: unknown) => error instanceof PluginAccessError && error.status === 403);
  assert.equal(f.updates[0].sessionId, undefined);
  assert.equal(cookie.includes(code), false); assert.equal(JSON.stringify(body).includes(token), false);
  assert.equal(pluginAccessToken(f.request('GET', undefined, cookie.split(';')[0]), 'other-waveform', true), undefined);
  assert.equal(pluginAccessToken(f.request('GET', undefined, `${cookie.split(';')[0]}; ${cookie.split(';')[0]}`), scope.waveformId, true), undefined);
});

test('HTTP unlock forwards only a validated existing session ID to the required server update path', async () => {
  const f = fixture(); await f.protect(); const sessionId = randomUUID();
  const response = await f.server.POST(f.request('POST', { code, plugins: ['visual'], sessionId }));
  assert.equal(response.status, 200); assert.deepEqual(f.updates, [{ sessionId, plugins: ['visual'] }]);
  const invalid = await f.server.POST(f.request('POST', { code, plugins: ['visual'], sessionId: 'provider-session-id' }));
  assert.equal(invalid.status, 400); assert.equal(f.updates.length, 1);
});

test('failed running-call activation issues no unlock cookie or successful response', async () => {
  const f = fixture(); await f.protect(); f.failUpdate();
  const response = await f.server.POST(f.request('POST', { code, plugins: ['visual'], sessionId: randomUUID() }));
  assert.equal(response.status, 503); assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), { error: 'Plugin access is temporarily unavailable.' });
});

test('wrong codes, unauthenticated requests, plugin escalation and oversize bodies never activate plugins', async () => {
  const f = fixture(); await f.protect();
  assert.equal((await f.server.POST(f.request('POST', { code: 'synthetic-wrong-code', plugins: ['text'] }))).status, 403);
  assert.equal((await f.server.POST(f.request('POST', { code, plugins: ['text'] }, '', 'stranger'))).status, 403);
  for (const body of [{ code, plugins: ['knowledge'] }, { code, plugins: ['text'], allowed: true }, { code: 'a'.repeat(2048), plugins: ['text'] }]) {
    assert.equal((await f.server.POST(f.request('POST', body))).status, 400);
  }
  assert.deepEqual(f.updates, []);
  assert.equal((await f.server.PUT(f.request('PUT', { revision: 'off', protectedPlugins: ['knowledge'], code }))).status, 400);
});

test('HTTP throttling provides retry guidance and no cookie; revoked accounts stay denied', async () => {
  const f = fixture(); await f.protect();
  for (let i = 0; i < 5; i++) await f.server.POST(f.request('POST', { code: 'synthetic-wrong-code', plugins: ['text'] }));
  const result = await f.server.POST(f.request('POST', { code, plugins: ['text'] }));
  assert.equal(result.status, 429); assert.equal(result.headers.get('retry-after'), '60'); assert.equal(result.headers.get('set-cookie'), null);
  f.revoke(); assert.equal((await f.server.GET(f.request('GET'))).status, 403);
});

test('successful account changes expire only the scoped plugin cookies', () => {
  const secure = '__Host-flowpath_plugin_0123456789abcdef01234567';
  const local = 'flowpath_local_plugin_0123456789abcdef01234567';
  const req = new Request(origin, { headers: { Cookie: `${secure}=synthetic; ${local}=synthetic; flowpath_account=old` } });
  const account = Response.json({ mode: 'local' }, { headers: { 'Set-Cookie': 'flowpath_account=updated; HttpOnly' } });
  assert.deepEqual(clearPluginGrantCookies(req, account).headers.getSetCookie(), [
    'flowpath_account=updated; HttpOnly',
    `${secure}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`,
    `${local}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
  ]);
  const rejected = new Response(null, { status: 409 });
  assert.equal(clearPluginGrantCookies(req, rejected), rejected);
});
