import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_VOICE_COOKIE, PUBLIC_WAVEFORM_ID, isPublicVoiceOwner, publicVoiceOwner, withPublicVoiceVisitor, type PublicVoiceOwner } from '../lib/public-voice-identity';

const origin = 'https://voice.example';
const cookie = `${PUBLIC_VOICE_COOKIE}=${'a'.repeat(64)}`;
const request = (headers: Record<string, string> = {}, path = '/api/session', method = 'GET') => new Request(`http://internal${path}`, {
  method, headers: { host: 'voice.example', ...headers },
});
const options = { enabled: true, publicOrigin: origin };

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
