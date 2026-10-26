import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_VOICE_COOKIE, PUBLIC_WAVEFORM_ID, isPublicVoiceOwner, publicVoiceOwner, withPublicVoiceVisitor, type PublicVoiceOwner } from '../lib/public-voice-identity';

const origin = 'https://voice.example';
const cookie = `${PUBLIC_VOICE_COOKIE}=${'a'.repeat(64)}`;
const request = (headers: Record<string, string> = {}, path = '/api/session', method = 'GET') => new Request(`http://internal${path}`, {
  method, headers: { host: 'voice.example', ...headers },
});
const options = { enabled: true, publicOrigin: origin };
const pageA = '11111111-1111-4111-8111-111111111111';
const pageB = '22222222-2222-4222-8222-222222222222';

test('public visitor identity hashes a single cookie and grants no account or private waveform identity', () => {
  const visitor = publicVoiceOwner(request({ cookie }));
  assert.ok(isPublicVoiceOwner(visitor));
  assert.equal(visitor.waveformId, PUBLIC_WAVEFORM_ID);
  assert.notEqual(visitor.accountSessionId, 'a'.repeat(64));
  assert.equal(visitor.ownerUid, `visitor:${visitor.accountSessionId}`);
  assert.deepEqual(publicVoiceOwner(request({ cookie })), visitor);
  assert.notDeepEqual(publicVoiceOwner(request({ cookie: `${PUBLIC_VOICE_COOKIE}=${'b'.repeat(64)}` })), visitor);
  for (const value of ['', `${PUBLIC_VOICE_COOKIE}=short`, `${PUBLIC_VOICE_COOKIE}=${'A'.repeat(64)}`, `${cookie}; ${cookie}`,
    `flowpath_account=${'a'.repeat(64)}`, `${PUBLIC_VOICE_COOKIE}; ${cookie}`]) {
    assert.equal(publicVoiceOwner(request({ cookie: value })), null);
  }
  for (const changed of [{ kind: undefined }, { ownerUid: 'member' }, { waveformId: 'private-waveform' }, { accountSessionId: 'invalid' }]) {
    assert.equal(isPublicVoiceOwner({ ...visitor, ...changed }), false);
  }
});

test('a public page keeps its identity through readiness, creation and cleanup while a refresh gets a new one', () => {
  const legacy = publicVoiceOwner(request({ cookie }));
  const page = publicVoiceOwner(request({ cookie, 'X-FlowPath-Demo': pageA }));
  assert.ok(isPublicVoiceOwner(page));
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.deepEqual(publicVoiceOwner(request({ cookie, 'X-FlowPath-Demo': pageA }, '/api/session', method)), page);
  }
  assert.notDeepEqual(publicVoiceOwner(request({ cookie, 'X-FlowPath-Demo': pageB })), page);
  assert.notDeepEqual(page, legacy);
  assert.deepEqual(publicVoiceOwner(request({ cookie })), legacy, 'clients without the page header retain their original cleanup identity');
  assert.notDeepEqual(publicVoiceOwner(request({ cookie: `${PUBLIC_VOICE_COOKIE}=${'b'.repeat(64)}`, 'X-FlowPath-Demo': pageA })), page);
});

test('invalid or combined duplicate page headers fail closed without minting or rotating a cookie', async () => {
  for (const value of ['', 'not-a-uuid', pageA.replace('-4111-', '-1111-'), `${pageA}, ${pageB}`, `${pageA}, ${pageA}`]) {
    for (const currentCookie of ['', cookie]) {
      const req = request({ cookie: currentCookie, 'X-FlowPath-Demo': value });
      assert.equal(publicVoiceOwner(req), null);
      const response = await withPublicVoiceVisitor(req, async prepared => {
        assert.equal(publicVoiceOwner(prepared), null);
        assert.equal(prepared.headers.get('cookie'), currentCookie);
        return Response.json({ enabled: false });
      }, options);
      assert.equal(response.headers.get('set-cookie'), null);
    }
  }
  const duplicate = request({ cookie, 'X-FlowPath-Demo': pageA });
  duplicate.headers.append('x-flowpath-demo', pageB);
  assert.equal(publicVoiceOwner(duplicate), null);
});

test('public readiness mints a private cookie once and never exposes its value in JSON', async () => {
  let visitor: PublicVoiceOwner | null = null;
  const response = await withPublicVoiceVisitor(request({ cookie: 'unrelated=synthetic' }), async prepared => {
    visitor = publicVoiceOwner(prepared);
    assert.match(prepared.headers.get('cookie')!, /unrelated=synthetic/);
    return Response.json({ enabled: true });
  }, options);
  assert.ok(isPublicVoiceOwner(visitor));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const setCookie = response.headers.get('set-cookie')!;
  assert.match(setCookie, /^__Host-flowpath_demo=[0-9a-f]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000$/);
  assert.deepEqual(await response.json(), { enabled: true });
  const next = await withPublicVoiceVisitor(request({ cookie: setCookie.split(';')[0] }), async prepared => {
    assert.deepEqual(publicVoiceOwner(prepared), visitor);
    return Response.json({ enabled: true });
  }, options);
  assert.equal(next.headers.get('set-cookie'), null);
});

test('a fresh page changes its allowance identity without changing the shared visitor cookie', async () => {
  let first: PublicVoiceOwner | null = null;
  const minted = await withPublicVoiceVisitor(request({ 'X-FlowPath-Demo': pageA }), async prepared => {
    first = publicVoiceOwner(prepared);
    return Response.json({ enabled: true });
  }, options);
  assert.ok(isPublicVoiceOwner(first));
  const sharedCookie = minted.headers.get('set-cookie')!.split(';')[0];
  for (const id of [pageA, pageB]) {
    const response = await withPublicVoiceVisitor(request({ cookie: sharedCookie, 'X-FlowPath-Demo': id }), async prepared => {
      assert.equal(prepared.headers.get('cookie'), sharedCookie);
      if (id === pageA) assert.deepEqual(publicVoiceOwner(prepared), first);
      else assert.notDeepEqual(publicVoiceOwner(prepared), first);
      return Response.json({ enabled: true });
    }, options);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('cookie issuance is limited to enabled, same-origin, public readiness through the configured proxy', async () => {
  for (const [req, config] of [
    [request(), { ...options, enabled: false }],
    [request({ origin: 'https://untrusted.example' }), options],
    [request({ 'sec-fetch-site': 'cross-site' }), options],
    [request({ host: 'untrusted.example' }), options],
    [request({}, '/api/session?waveformId=private'), options],
    [request({}, '/api/session?unexpected=1'), options],
    [request({}, '/api/account'), options],
    [request({}, '/api/session', 'POST'), options],
  ] as const) {
    const result = await withPublicVoiceVisitor(req, async prepared => {
      assert.equal(publicVoiceOwner(prepared), null);
      return Response.json({ enabled: false });
    }, config);
    assert.equal(result.headers.get('set-cookie'), null);
  }
  const proxied = request({ host: 'synthetic.run.app', 'x-forwarded-host': 'voice.example' });
  const result = await withPublicVoiceVisitor(proxied, async prepared => {
    assert.ok(isPublicVoiceOwner(publicVoiceOwner(prepared)));
    return Response.json({ enabled: true });
  }, { ...options, trustedProxyHost: 'synthetic.run.app' });
  assert.ok(result.headers.get('set-cookie'));
});

test('explicit full local runtime issues the same visitor identity only on loopback readiness', async () => {
  const req = new Request('http://localhost:3220/api/session', { headers: { host: 'localhost:3220' } });
  const response = await withPublicVoiceVisitor(req, async prepared => {
    assert.ok(isPublicVoiceOwner(publicVoiceOwner(prepared)));
    return Response.json({ enabled: true });
  }, { enabled: true, local: true });
  assert.ok(response.headers.get('set-cookie')?.includes('HttpOnly'));
  const remote = new Request('http://evil.example:3220/api/session', { headers: { host: 'evil.example:3220' } });
  const rejected = await withPublicVoiceVisitor(remote, async prepared => {
    assert.equal(publicVoiceOwner(prepared), null);
    return Response.json({ enabled: false });
  }, { enabled: true, local: true });
  assert.equal(rejected.headers.get('set-cookie'), null);
});
