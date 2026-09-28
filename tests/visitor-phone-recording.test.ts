import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPhoneRecordingPairings, phoneRecordingLimits, phoneRecordingOrigin, phoneRecordingRequest } from '../lib/visitor-phone-recording';
import { createTestRecordingStore, localRecordingRequest, requestTestRecorder } from '../lib/visitor-test-recording-store';
import { LOCAL_TEST_HEADER, PHONE_RECORDING_HEADER, RECORDING_HEADER, sanitizeTestObservation, recordBrowserTestEvent, setBrowserTestRecorder } from '../lib/visitor-test-events';
import { POST as phoneRecordingPost } from '../app/api/dev/recordings/phone/route';
import { POST as localRecordingPost } from '../app/api/dev/recordings/route';

const origin = 'https://192.168.1.250:3220', publisher = 'synthetic-products';
const invitationId = '00000000-0000-4000-8000-000000000081', recordingId = '00000000-0000-4000-8000-000000000082';
const invitationToken = 'i'.repeat(43), grantToken = 'g'.repeat(43);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const request = (action: string, body: object = {}, token = grantToken, custom: Record<string, string> = {}, path = '/api/dev/recordings/phone') => new Request(`${origin}${path}`, {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json', [LOCAL_TEST_HEADER]: '1', [RECORDING_HEADER]: recordingId, [PHONE_RECORDING_HEADER]: token, ...custom }, body: JSON.stringify({ action, ...body }),
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'phone-recorder-')), store = createTestRecordingStore(directory);
  let clock = Date.now();
  const pairing = createPhoneRecordingPairings(directory, store, { now: () => clock, newToken: () => grantToken });
  const invitation = { version: 1, id: invitationId, recordingId, origin, slug: publisher, tokenHash: digest(invitationToken), createdAt: clock, expiresAt: clock + phoneRecordingLimits.invitationMs };
  await writeFile(join(directory, `phone-pairing-${invitationId}.json`), JSON.stringify(invitation), { mode: 0o600 });
  return { directory, store, pairing, invitation, advance(ms: number) { clock += ms; }, async cleanup() { pairing.revoke(recordingId); await store.stop(recordingId); await rm(directory, { recursive: true, force: true }); } };
}

test('phone gate is development-only and exact HTTPS private-origin; loopback history stays closed', () => {
  assert.equal(phoneRecordingRequest(request('append'), 'development'), true);
  for (const mode of ['test', 'production'] as const) assert.equal(phoneRecordingRequest(request('append'), mode), false);
  const cases: Record<string, string>[] = [{ origin: 'https://192.168.1.251:3220' }, { host: 'other.test:3220' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }, { [LOCAL_TEST_HEADER]: '' }];
  for (const headers of cases) assert.equal(phoneRecordingRequest(request('append', {}, grantToken, headers), 'development'), false);
  assert.equal(localRecordingRequest(request('list'), 'development'), false);
  for (const value of ['http://192.168.1.250:3220', 'https://example.com', `${origin}/`, `${origin}?key=x`, 'https://user:pass@192.168.1.250:3220']) assert.equal(phoneRecordingOrigin(value), false);
});

test('one-use invitation rotates credentials, binds publisher/origin/recording, and only captures after consent', async () => {
  const fixture = await setup(), { pairing, store } = fixture;
  try {
    assert.equal(store.active(recordingId), false);
    await assert.rejects(pairing.accept(request('accept', {}, 'x'.repeat(43)), invitationId, publisher, {}, 'development'));
    await assert.rejects(pairing.accept(request('accept', {}, invitationToken), invitationId, 'other-publisher', {}, 'development'));
    assert.equal(store.active(recordingId), false);
    const paired = await pairing.accept(request('accept', {}, invitationToken), invitationId, publisher, { test: true }, 'development');
    assert.equal(paired.id, recordingId); assert.equal(paired.token, grantToken);
    assert.equal(pairing.authorize(request('append'), recordingId, publisher, 'development')?.id, recordingId);
    assert.equal(pairing.authorize(request('append', {}, invitationToken), recordingId, publisher, 'development'), undefined);
    assert.equal(pairing.authorize(request('append'), recordingId, 'other-publisher', 'development'), undefined);
    assert.equal(pairing.authorize(request('append'), invitationId, publisher, 'development'), undefined);
    assert.equal(pairing.authorize(request('append', {}, grantToken, { origin: 'https://192.168.1.250:3221' }), recordingId, publisher, 'development'), undefined);
    await assert.rejects(pairing.accept(request('accept', {}, invitationToken), invitationId, publisher, {}, 'development'));
    const restarted = createPhoneRecordingPairings(fixture.directory, store);
    await assert.rejects(restarted.accept(request('accept', {}, invitationToken), invitationId, publisher, {}, 'development'));
    const saved = await readFile(join(fixture.directory, `${recordingId}.jsonl`), 'utf8');
    assert.doesNotMatch(saved, new RegExp(`${invitationToken}|${grantToken}`));
  } finally { await fixture.cleanup(); }
});

test('expired invitations do not start capture; revoked/expired grants cannot extend capture', async () => {
  const expired = await setup();
  try { expired.advance(phoneRecordingLimits.invitationMs); await assert.rejects(expired.pairing.accept(request('accept', {}, invitationToken), invitationId, publisher, {}, 'development')); assert.equal(expired.store.active(recordingId), false); }
  finally { await expired.cleanup(); }
  const active = await setup();
  try {
    await active.pairing.accept(request('accept', {}, invitationToken), invitationId, publisher, {}, 'development');
    active.advance(phoneRecordingLimits.durationMs);
    assert.equal(active.pairing.authorize(request('append'), recordingId, publisher, 'development'), undefined);
    assert.equal(active.store.active(recordingId), false);
  } finally { await active.cleanup(); }
});

test('phone route supports only its chosen append/attach/stop and rejects all history actions', async () => {
  const fixture = await setup(), environment = process.env as Record<string, string | undefined>, previousMode = environment.NODE_ENV;
  const globals = globalThis as typeof globalThis & { visitorTestRecordings?: typeof fixture.store; visitorPhoneRecordingPairings?: typeof fixture.pairing };
  const previousStore = globals.visitorTestRecordings, previousPairing = globals.visitorPhoneRecordingPairings;
  try {
    environment.NODE_ENV = 'development'; globals.visitorTestRecordings = fixture.store; globals.visitorPhoneRecordingPairings = fixture.pairing;
    const accepted = await phoneRecordingPost(request('accept', { invitationId, slug: publisher }, invitationToken)); assert.equal(accepted.status, 200);
    for (const action of ['start', 'list', 'read', 'export', 'delete']) assert.equal((await phoneRecordingPost(request(action, { id: recordingId, slug: publisher }))).status, 400);
    assert.equal((await localRecordingPost(request('read', { id: recordingId }, grantToken, {}, '/api/dev/recordings'))).status, 404);
    const event = { type: 'test.observed', data: { transcript: 'Show the blue bowl', token: 'synthetic-secret', audio: 'synthetic-audio' }, source: 'browser', at: Date.now(), monotonicMs: 2, sequence: 1 };
    assert.equal((await phoneRecordingPost(request('append', { id: recordingId, slug: publisher, events: [event] }))).status, 200);
    assert.equal((await phoneRecordingPost(request('append', { id: recordingId, slug: 'other-publisher', events: [event] }))).status, 400);
    const observer = requestTestRecorder(request('chat', {}, grantToken, {}, `/api/visitor/${publisher}`));
    observer?.({ type: 'model.observed', data: { text: 'Published answer' } }); assert.equal(observer?.recordingId, recordingId);
    assert.equal(requestTestRecorder(request('chat', {}, grantToken, {}, '/api/visitor/other-publisher')), undefined);
    assert.equal((await phoneRecordingPost(request('stop', { id: recordingId, slug: publisher }))).status, 200);
    observer?.({ type: 'after.stop', data: 'Must not capture' });
    assert.equal((await phoneRecordingPost(request('append', { id: recordingId, slug: publisher, events: [] }))).status, 400);
    const saved = JSON.stringify(await fixture.store.read(recordingId));
    assert.match(saved, /Show the blue bowl/); assert.match(saved, /Published answer/);
    assert.doesNotMatch(saved, /synthetic-secret|synthetic-audio|Must not capture/);
    environment.NODE_ENV = 'production';
    assert.equal((await phoneRecordingPost(request('accept', { invitationId, slug: publisher }, invitationToken))).status, 404);
    assert.equal(requestTestRecorder(request('chat', {}, grantToken, {}, `/api/visitor/${publisher}`)), undefined);
  } finally { if (previousMode === undefined) delete environment.NODE_ENV; else environment.NODE_ENV = previousMode; globals.visitorTestRecordings = previousStore; globals.visitorPhoneRecordingPairings = previousPairing; await fixture.cleanup(); }
});

test('pairing fields and fragment URLs are redacted in any observation', () => {
  const saved = JSON.stringify(sanitizeTestObservation({ type: 'pairing.test', data: { pairingToken: invitationToken, recordingGrant: grantToken, [PHONE_RECORDING_HEADER]: grantToken, link: `${origin}/s/${publisher}#flowpath-recording=${invitationId}.${invitationToken}` } }));
  assert.doesNotMatch(saved, new RegExp(`${invitationToken}|${grantToken}`));
});

for (const captureOrigin of [origin, 'https://localhost:3220', 'https://127.0.0.1:3220', 'https://[::1]:3220']) test(`phone browser consent, redirect rejection and scoped lifecycle on ${captureOrigin}`, async () => {
  const client = await import('../lib/visitor-test-recording-client');
  const environment = process.env as Record<string, string | undefined>, previousMode = environment.NODE_ENV;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const setGlobal = (key: string, value: unknown) => { descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  const url = new URL(`${captureOrigin}/s/${publisher}#flowpath-recording=${invitationId}.${invitationToken}`), storage = new Map<string, string>();
  const calls: { path: string; action?: string; headers: Headers; body: Record<string, unknown> }[] = [];
  let serverActive = false, redirectFixture = false, unregister = () => {};
  try {
    environment.NODE_ENV = 'development';
    setGlobal('window', { location: url }); setGlobal('location', url);
    setGlobal('history', { state: null, replaceState(_state: unknown, _title: string, path: string) { url.href = new URL(path, url).href; } });
    setGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    setGlobal('navigator', { userAgent: 'Synthetic phone' }); setGlobal('innerWidth', 390); setGlobal('innerHeight', 844); setGlobal('matchMedia', () => ({ matches: false }));
    setGlobal('fetch', async (input: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>, headers = new Headers(init?.headers);
      calls.push({ path: String(input), action: body.action as string | undefined, headers, body });
      if (headers.has(PHONE_RECORDING_HEADER)) assert.equal(init?.redirect, 'error', 'Invitation/grant requests must never follow redirects');
      if (redirectFixture) throw new TypeError('Synthetic rejected redirect');
      if (input !== '/api/dev/recordings/phone') return Response.json({ ok: true });
      if (body.action === 'accept') { serverActive = true; return Response.json({ id: recordingId, slug: publisher, token: grantToken, expiresAt: Date.now() + phoneRecordingLimits.durationMs }); }
      if (body.action === 'stop') { serverActive = false; return Response.json({ stopped: true }); }
      if (body.action === 'attach-voice') return Response.json({ attached: true });
      assert.equal(body.action, 'append', 'Phone never reads or lists recordings');
      return Response.json({ active: serverActive, dropped: 0 });
    });
    assert.equal(client.localTestRecordingAvailable(), false, 'HTTPS, including loopback, requires explicit pairing');
    if (captureOrigin !== origin) { url.protocol = 'http:'; assert.equal(client.localTestRecordingAvailable(), true, 'Ordinary HTTP loopback recording stays available'); url.protocol = 'https:'; }
    unregister = client.registerRecordingVoice(publisher, { id: invitationId, token: 'v'.repeat(43) });
    await client.resumeTestRecording();
    assert.equal(url.hash, ''); assert.equal(client.testRecordingSnapshot().pairing, true);
    assert.equal(client.testRecordingSnapshot().active, false); assert.equal(calls.length, 0, 'Invitation and passive voice registration make no requests');
    await client.startTestRecording();
    assert.equal(client.testRecordingSnapshot().active, true); assert.equal(client.testRecordingSnapshot().voiceCapture, 'attached');
    assert.deepEqual(calls.map(call => call.action), ['accept', 'attach-voice']);
    assert.equal(calls[0].headers.get(PHONE_RECORDING_HEADER), invitationToken);
    assert.equal(calls[1].headers.get(PHONE_RECORDING_HEADER), grantToken);
    await assert.rejects(client.recordingApi({ action: 'list' }));
    recordBrowserTestEvent('chat.submitted', { text: 'Show the blue bowl', pairingToken: invitationToken });
    assert.equal(await client.markTestProblem('Synthetic phone issue'), true);
    const captured = JSON.stringify(calls.filter(call => call.action === 'append').map(call => call.body));
    assert.match(captured, /Show the blue bowl/); assert.doesNotMatch(captured, new RegExp(invitationToken));
    await client.recordedVisitorFetch(`/api/visitor/${publisher}/tasks`, { method: 'POST', body: '{}', redirect: 'follow' });
    assert.equal(calls.at(-1)?.headers.get(PHONE_RECORDING_HEADER), grantToken);
    redirectFixture = true;
    const beforeRedirect = calls.length;
    await assert.rejects(client.recordedVisitorFetch(`/api/visitor/${publisher}/tasks`, { method: 'POST', body: '{}' }), /rejected redirect/);
    assert.equal(calls.length, beforeRedirect + 1, 'A rejected redirect never retries'); redirectFixture = false;
    await client.recordedVisitorFetch('/api/visitor/another-publisher/tasks', { method: 'POST', body: '{}' });
    assert.equal(calls.at(-1)?.headers.has(PHONE_RECORDING_HEADER), false);
    const saved = storage.get('flowpath-phone-recording')!;
    await client.stopTestRecording();
    assert.equal(serverActive, false); assert.equal(storage.has('flowpath-phone-recording'), false);
    assert.equal(client.testRecordingSnapshot().active, false);
    // Simulate reloading the explicitly opted-in tab with an active server.
    serverActive = true; storage.set('flowpath-phone-recording', saved); calls.length = 0;
    await client.resumeTestRecording();
    assert.equal(client.testRecordingSnapshot().active, true);
    assert.deepEqual(calls.map(call => call.action), ['append', 'attach-voice']);
    assert.deepEqual(calls[0].body.events, []);
    url.pathname = '/s/another-publisher'; await client.resumeTestRecording();
    assert.equal(client.testRecordingSnapshot().active, false); assert.equal(serverActive, false);
    assert.equal(storage.has('flowpath-phone-recording'), false);
    await client.recordedVisitorFetch('/api/visitor/another-publisher/tasks', { method: 'POST', body: '{}' });
    assert.equal(calls.at(-1)?.headers.has(PHONE_RECORDING_HEADER), false);
    const count = calls.length; environment.NODE_ENV = 'production';
    url.pathname = `/s/${publisher}`; url.hash = `flowpath-recording=${invitationId}.${invitationToken}`;
    await client.resumeTestRecording(); assert.equal(calls.length, count); assert.equal(client.testRecordingSnapshot().active, false);
  } finally {
    if (client.testRecordingSnapshot().active) await client.stopTestRecording();
    unregister(); setBrowserTestRecorder();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    if (previousMode === undefined) delete environment.NODE_ENV; else environment.NODE_ENV = previousMode;
  }
});
