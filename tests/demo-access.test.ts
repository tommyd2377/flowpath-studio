import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { createDemoAccess, demoAccessHash, demoGrantId } from '../lib/demo-access';
import { PaidMemoryDatabase } from './paid-fixture';
import { createAccountServer } from '../lib/account-server';

const origin = 'https://voice.example';
const request = (method: string, cookie = '', body?: object, cross = false) => new Request(`${origin}/api/demo-access`, {
  method, headers: { host: 'voice.example', origin: cross ? 'https://evil.example' : origin, cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
});
function fixture() {
  const db = new PaidMemoryDatabase(); let now = 1_000_000;
  const gate = createDemoAccess(db, { enabled: () => true, publicOrigin: origin, now: () => now, codeDigest: demoAccessHash('synthetic-code') });
  return { db, gate, advance: (ms: number) => { now += ms; } };
}
const cookiePair = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];

test('only exact server-validated codes issue opaque expiring grants; granting access uses no voice allowance', async () => {
  const f = fixture(); const challenge = cookiePair(await f.gate.GET(request('GET')));
  for (const code of ['wrong', 'SYNTHETIC-CODE', 'synthetic-code ']) assert.equal((await f.gate.POST(request('POST', challenge, { code }))).status, 403);
  assert.equal((await f.gate.POST(request('POST', challenge, { allowed: true }))).status, 400);
  const accepted = await f.gate.POST(request('POST', challenge, { code: 'synthetic-code' }));
  assert.equal(accepted.status, 200); assert.match(accepted.headers.get('set-cookie')!, /Secure; HttpOnly; SameSite=Strict/);
  const grant = cookiePair(accepted), req = request('GET', grant);
  assert.equal(await f.gate.allowed(req), true);
  assert.equal((await (await f.gate.GET(req)).json()).allowed, true);
  assert.ok(demoGrantId(req)); assert.equal([...f.db.rows.keys()].some(path => path.startsWith('voiceTesterAllowances/')), false);
  f.advance(86_400_001); assert.equal(await f.gate.allowed(req), false);
});

test('shared durable throttles survive processes, reject missing/duplicate cookies and enforce exact origin', async () => {
  const f = fixture(); const challenge = cookiePair(await f.gate.GET(request('GET')));
  await Promise.all(Array.from({ length: 6 }, () => f.gate.POST(request('POST', challenge, { code: 'wrong' }))));
  assert.equal((await f.gate.POST(request('POST', challenge, { code: 'synthetic-code' }))).status, 429);
  assert.equal((await f.gate.POST(request('POST', '', { code: 'synthetic-code' }))).status, 400);
  assert.equal((await f.gate.POST(request('POST', `${challenge}; ${challenge}`, { code: 'synthetic-code' }))).status, 400);
  assert.equal((await f.gate.POST(request('POST', challenge, { code: 'synthetic-code' }, true))).status, 403);
  f.advance(600_001); assert.equal((await f.gate.POST(request('POST', challenge, { code: 'synthetic-code' }))).status, 200);
});

test('fresh anonymous challenges cannot bypass the global attempt ceiling', async () => {
  const f = fixture();
  for (let i = 0; i < 60; i++) {
    const challenge = `__Host-flowpath_demo_attempt=${randomBytes(32).toString('hex')}`;
    assert.equal((await f.gate.POST(request('POST', challenge, { code: 'wrong' }))).status, 403);
  }
  const challenge = cookiePair(await f.gate.GET(request('GET')));
  assert.equal((await f.gate.POST(request('POST', challenge, { code: 'synthetic-code' }))).status, 429);
});

test('direct waveform PUT cannot bypass the additional code gate after account authentication', async () => {
  const server = createAccountServer({ mode: 'local', development: () => true, authorizeWaveformSave: async () => false });
  const host = '127.0.0.1:3220', base = `http://${host}`;
  const login = await server.accountPOST(new Request(`${base}/api/account`, { method: 'POST', headers: { host, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ localAccount: 'owner-a' }) }));
  const result = await server.waveformPUT(new Request(`${base}/api/waveform`, { method: 'PUT', headers: { host, origin: base, cookie: cookiePair(login), 'content-type': 'application/json' }, body: '{}' }));
  assert.equal(result.status, 403); assert.match((await result.json()).error, /demo code/);
});
