import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createVoiceDeadline, voiceDeadlineConfig } from '../lib/voice-deadline';

const now = Date.parse('2026-10-18T12:00:00Z');
const env = {
  FLOWPATH_PUBLIC_ORIGIN: 'https://waveform.example', FLOWPATH_FIREBASE_PROJECT_ID: 'example-voice',
  FLOWPATH_VOICE_TASKS_LOCATION: 'us-east4', FLOWPATH_VOICE_TASKS_QUEUE: 'voice-expiry',
  FLOWPATH_VOICE_TASKS_SERVICE_ACCOUNT: 'voice-expiry@example-voice.iam.gserviceaccount.com',
};
const config = voiceDeadlineConfig(env)!;
const identity = { aud: config.endpoint, email: config.serviceAccount, email_verified: true };
const token = 'header.payload.signature';
function request(body: unknown = { sessionId: randomUUID() }, options: { headers?: Record<string, string>; raw?: string; url?: string } = {}) {
  return new Request(options.url ?? config.endpoint, {
    method: 'POST', headers: { host: 'waveform.example', authorization: `Bearer ${token}`, 'content-type': 'application/json', ...options.headers },
    body: options.raw ?? JSON.stringify(body),
  });
}

test('deadline configuration requires an explicit HTTPS origin, project, queue and same-project identity', () => {
  assert.ok(config);
  assert.equal(config.endpoint, 'https://waveform.example/api/voice-expiry');
  for (const field of Object.keys(env)) assert.equal(voiceDeadlineConfig({ ...env, [field]: undefined }), null);
  assert.equal(voiceDeadlineConfig({ ...env, FLOWPATH_PUBLIC_ORIGIN: 'http://waveform.example' }), null);
  assert.equal(voiceDeadlineConfig({ ...env, FLOWPATH_PUBLIC_ORIGIN: 'https://waveform.example/something' }), null);
  assert.equal(voiceDeadlineConfig({ ...env, FLOWPATH_VOICE_TASKS_LOCATION: '../us-east4' }), null);
  assert.equal(voiceDeadlineConfig({ ...env, FLOWPATH_VOICE_TASKS_QUEUE: 'x/tasks/y' }), null);
  assert.equal(voiceDeadlineConfig({ ...env, FLOWPATH_VOICE_TASKS_SERVICE_ACCOUNT: 'voice@other-project.iam.gserviceaccount.com' }), null);
  for (const proxyHost of ['', 'https://proxy.example', 'proxy.example:443', '*.example', 'proxy.example, attacker.example']) {
    assert.equal(voiceDeadlineConfig({ ...env, FLOWPATH_TRUSTED_PROXY_HOST: proxyHost }), null);
  }
  assert.ok(voiceDeadlineConfig({ ...env, FLOWPATH_FIREBASE_PROJECT_ID: undefined, FIREBASE_CONFIG: JSON.stringify({ projectId: 'example-voice' }) }));
});

test('a deterministic authenticated task is scheduled at the 15-minute deadline using injected transport', async () => {
  const id = randomUUID();
  let calls = 0;
  const deadline = createVoiceDeadline(config, {
    now: () => now,
    verifyIdentity: async () => { throw new Error('Scheduling must not verify tokens'); },
    async createTask(url, body) {
      calls++;
      assert.equal(url, 'https://cloudtasks.googleapis.com/v2/projects/example-voice/locations/us-east4/queues/voice-expiry/tasks');
      assert.equal(body.task.name, `${config.queuePath}/tasks/voice-${id}`);
      assert.equal(body.task.scheduleTime, '2026-10-18T12:15:00.000Z');
      assert.equal(body.task.dispatchDeadline, '30s');
      assert.deepEqual(body.task.httpRequest.oidcToken, { audience: config.endpoint, serviceAccountEmail: config.serviceAccount });
      assert.equal(body.task.httpRequest.url, config.endpoint);
      assert.equal(body.task.httpRequest.httpMethod, 'POST');
      assert.deepEqual(JSON.parse(Buffer.from(body.task.httpRequest.body, 'base64').toString()), { sessionId: id });
    },
  });
  await deadline.schedule(id, now + 900_000);
  assert.equal(calls, 1);
  for (const [badId, expiry] of [[id, now], [id, now + 900_001], [id, Infinity], ['provider-id', now + 900_000]] as const) {
    await assert.rejects(deadline.schedule(badId, expiry));
  }
  assert.equal(calls, 1);
  const unavailable = createVoiceDeadline(null, { createTask: async () => { calls++; }, verifyIdentity: async () => identity });
  await assert.rejects(unavailable.schedule(id, now + 900_000));
  assert.equal(calls, 1);
});

test('a scheduling transport failure propagates without a retry or provider call', async () => {
  let calls = 0;
  const deadline = createVoiceDeadline(config, {
    now: () => now, verifyIdentity: async () => identity,
    async createTask() { calls++; throw new Error('Unavailable'); },
  });
  await assert.rejects(deadline.schedule(randomUUID(), now + 900_000));
  assert.equal(calls, 1);
});

test('expiry requires verified Google audience and service identity before touching a reservation', async () => {
  let verified = 0, expired = 0;
  let claim: typeof identity | undefined = identity;
  const deadline = createVoiceDeadline(config, {
    createTask: async () => { throw new Error('Expiry must not schedule another task'); },
    async verifyIdentity(value, audience) { verified++; assert.equal(value, token); assert.equal(audience, config.endpoint); return claim; },
  });
  const expire = async () => { expired++; return true; };
  const invalidHeaders: Record<string, string>[] = [{ authorization: '' }, { authorization: 'Bearer invalid', 'x-cloudtasks-taskname': 'trusted' },
    { host: 'attacker.example', 'x-forwarded-host': 'waveform.example' }];
  for (const headers of invalidHeaders) {
    assert.ok([401, 403].includes((await deadline.handle(request(undefined, { headers }), expire)).status));
  }
  assert.equal(verified, 0);
  for (claim of [undefined, { ...identity, aud: 'https://other.example/api/voice-expiry' },
    { ...identity, email: 'other@example-voice.iam.gserviceaccount.com' }, { ...identity, email_verified: false }]) {
    assert.equal((await deadline.handle(request(), expire)).status, 401);
  }
  assert.equal(expired, 0);
  const invalidSignature = createVoiceDeadline(config, {
    createTask: async () => {}, verifyIdentity: async () => { throw new Error('Bad signature'); },
  });
  assert.equal((await invalidSignature.handle(request(), expire)).status, 401);
  assert.equal(expired, 0);
  claim = identity;
  const id = randomUUID();
  assert.equal((await deadline.handle(request({ sessionId: id }, { url: 'http://internal:8080/api/voice-expiry' }), async value => {
    expired++; assert.equal(value, id); return true;
  })).status, 200);
  assert.equal(expired, 1);
});

test('authenticated expiry accepts only a bounded UUID body and returns retryable uncertainty', async () => {
  let expired = 0;
  const deadline = createVoiceDeadline(config, { createTask: async () => {}, verifyIdentity: async () => identity });
  const expire = async () => { expired++; return true; };
  const id = randomUUID();
  for (const body of [{}, null, [], { sessionId: 'provider-id' }, { sessionId: id, providerId: 'forbidden' }]) {
    assert.equal((await deadline.handle(request(body), expire)).status, 400);
  }
  for (const raw of ['{', ' '.repeat(129)]) assert.equal((await deadline.handle(request(undefined, { raw }), expire)).status, 400);
  const invalidHeaders: Record<string, string>[] = [{ 'content-type': 'text/plain' }, { 'content-length': '129' }, { 'content-length': 'invalid' }];
  for (const headers of invalidHeaders) {
    assert.equal((await deadline.handle(request({ sessionId: id }, { headers }), expire)).status, 400);
  }
  assert.equal(expired, 0);
  assert.equal((await deadline.handle(request({ sessionId: id }), async () => false)).status, 503);
  assert.equal((await deadline.handle(request({ sessionId: id }), async () => { throw new Error('Unconfirmed closure'); })).status, 503);
  assert.equal((await deadline.handle(request({ sessionId: id }), expire)).status, 200);
  assert.equal(expired, 1);
});

test('expiry accepts the exact configured proxy and canonical forwarded host while retaining OIDC checks', async () => {
  const proxyHost = 'example-voice-123456789.us-east4.run.app';
  const proxiedConfig = voiceDeadlineConfig({ ...env, FLOWPATH_TRUSTED_PROXY_HOST: proxyHost })!;
  assert.equal(proxiedConfig.trustedProxyHost, proxyHost);
  let verified = 0, expired = 0;
  const deadline = createVoiceDeadline(proxiedConfig, {
    createTask: async () => { throw new Error('Expiry must not create tasks'); },
    async verifyIdentity(value, audience) {
      verified++;
      assert.equal(value, token);
      assert.equal(audience, config.endpoint);
      return identity;
    },
  });
  const expire = async () => { expired++; return true; };
  const headers = { host: proxyHost, 'x-forwarded-host': 'waveform.example' };
  assert.equal((await deadline.handle(request(undefined, { headers, url: 'http://internal:8080/api/voice-expiry' }), expire)).status, 200);
  assert.equal(verified, 1);
  assert.equal(expired, 1);
  const rejected: Record<string, string>[] = [
    { host: 'another-voice-123456789.us-east4.run.app', 'x-forwarded-host': 'waveform.example' },
    { host: proxyHost, 'x-forwarded-host': 'other.example' },
    { host: proxyHost, 'x-forwarded-host': 'waveform.example, attacker.example' },
    { host: `${proxyHost}, attacker.example`, 'x-forwarded-host': 'waveform.example' },
    { host: proxyHost, 'x-forwarded-host': 'https://waveform.example' },
    { host: proxyHost, 'x-forwarded-host': 'waveform.example:443' },
    { host: proxyHost },
  ];
  for (const headers of rejected) assert.equal((await deadline.handle(request(undefined, { headers }), expire)).status, 403);
  assert.equal(verified, 1);
  assert.equal(expired, 1);
  assert.equal((await deadline.handle(request(undefined, { headers: { ...headers, authorization: '' } }), expire)).status, 401);
  assert.equal(verified, 1);
  assert.equal(expired, 1);
});
