import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AppError } from '../lib/errors';
import { sampleContent } from '../lib/site-model';
import { DEFAULT_VISITOR_SETTINGS, GLOBAL_VISITOR_LIMITS, type VisitorAvailability } from '../lib/visitor-model';
import { availability, currentLedger, reserveDictation, reserveReply, VisitorLimitError } from '../lib/visitor-quota';
import { dictationPcm, transcribeVisitorDictation, visitorDictation, visitorDictationSchema } from '../lib/visitor-dictation';
import type { PlatformEventInput } from '../lib/platform-events';
import type { TestObservation } from '../lib/visitor-test-events';

const pcm = Buffer.alloc(9600, 3), audio = pcm.toString('base64');
const signal = () => new AbortController().signal;
const noBudget = async () => undefined;

test('dictation accepts only bounded canonical mono PCM16 bytes and a strict request', () => {
  assert.deepEqual(dictationPcm(audio), pcm);
  assert.equal(dictationPcm(Buffer.alloc(960000).toString('base64')).length, 960000);
  for (const encoded of ['', `${audio}\n`, audio.slice(1), `_${audio.slice(1)}`, 'A===', Buffer.alloc(9598).toString('base64'), Buffer.alloc(9601).toString('base64'), Buffer.alloc(960002).toString('base64')]) assert.throws(() => dictationPcm(encoded), AppError);
  const padded = Buffer.alloc(9602).toString('base64');
  assert.throws(() => dictationPcm(`${padded.slice(0, -2)}B=`), AppError, 'Noncanonical padding bits are rejected');
  assert.equal(visitorDictationSchema.safeParse({ requestId: randomUUID(), audio }).success, true);
  for (const input of [{ requestId: 'arbitrary', audio }, { requestId: randomUUID(), audio, model: 'untrusted' }, { requestId: randomUUID(), audio, duration: 1 }]) assert.equal(visitorDictationSchema.safeParse(input).success, false);
});

test('dictation reserves its own capped allowance and duplicate key while leaving chat and voice turns untouched', () => {
  const settings = { ...DEFAULT_VISITOR_SETTINGS, chatDailyLimit: 2 }, ledger = currentLedger(undefined);
  for (const requestId of ['recording-1', 'recording-2']) {
    const result = reserveDictation(ledger, 'site', requestId, settings, true);
    assert.equal(result.chatRemaining, 2); assert.equal(result.voiceRemaining, settings.voiceDailyLimit);
  }
  assert.deepEqual(ledger.totals, { chat: 0, voice: 0 }); assert.deepEqual(ledger.sites, {});
  assert.deepEqual(ledger.dictation, { total: 2, sites: { site: 2 } });
  assert.throws(() => reserveDictation(ledger, 'site', 'recording-1', settings, true), /already received/);
  assert.throws(() => reserveDictation(ledger, 'site', 'recording-3', settings, true), VisitorLimitError);
  assert.equal(ledger.requests['recording-3'], undefined);
  assert.equal(reserveReply(ledger, 'site', 'actual-send', 'chat', settings, true).chatRemaining, 1);
  assert.equal(reserveDictation(ledger, 'other-site', 'other-recording', settings, true).chatRemaining, 2);
});

test('dictation honors global, chat, enablement and live gates and malformed optional counters fail closed', () => {
  const ledger = currentLedger(undefined), settings = { ...DEFAULT_VISITOR_SETTINGS, chatDailyLimit: 100 };
  for (let index = 0; index < GLOBAL_VISITOR_LIMITS.chat; index++) reserveDictation(ledger, 'site', `dictation-${index}`, settings, true);
  assert.throws(() => reserveDictation(ledger, 'other', 'global-limit', settings, true), VisitorLimitError);
  assert.equal(ledger.requests['global-limit'], undefined);
  for (const [state, live] of [[{ ...settings, enabled: false }, true], [settings, false]] as const) assert.throws(() => reserveDictation(currentLedger(undefined), 'site', 'blocked', state, live), AppError);
  const exhausted = currentLedger(undefined); exhausted.totals.chat = GLOBAL_VISITOR_LIMITS.chat;
  assert.throws(() => reserveDictation(exhausted, 'site', 'chat-limit', settings, true), VisitorLimitError);
  assert.equal(exhausted.dictation, undefined);
  assert.equal(reserveDictation(currentLedger(undefined), 'site', 'chat-only', { ...settings, mode: 'chat' }, true).chatRemaining, 100);
  assert.throws(() => currentLedger({ ...ledger, dictation: { total: -1, sites: {} } }), /temporarily unavailable/);
  assert.equal(currentLedger(ledger, Date.parse(`${ledger.day}T00:00:00Z`) + 86400000).dictation, undefined);
});

test('one provider request sends an in-memory PCM WAV only after budget reservation and returns editable text', async () => {
  const order: string[] = [], events: TestObservation[] = [];
  const reply = await transcribeVisitorDictation(pcm, signal(), { apiKey: 'synthetic-offline-key', slug: 'dictation-fixture', record: event => events.push(event),
    reserve: async (bytes, scope) => { order.push('reserve'); assert.equal(bytes, pcm.length); assert.equal(scope?.slug, 'dictation-fixture'); return { settle: async payload => { order.push('settle'); assert.equal(payload.text, '  Synthetic dictation.  '); } }; },
    fetch: async (url, init) => {
      order.push('fetch'); assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions'); assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error');
      const form = init?.body as FormData;
      assert.deepEqual([...form.keys()], ['model', 'response_format', 'file']); assert.equal(form.get('model'), 'gpt-transcribe'); assert.equal(form.get('response_format'), 'json');
      assert.equal(new Headers(init?.headers).has('Content-Type'), false, 'Fetch owns the multipart boundary');
      const file = form.get('file') as File, wav = Buffer.from(await file.arrayBuffer());
      assert.equal(file.name, 'dictation.wav'); assert.equal(file.type, 'audio/wav'); assert.equal(wav.length, pcm.length + 44);
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
      assert.equal(wav.readUInt16LE(20), 1); assert.equal(wav.readUInt16LE(22), 1); assert.equal(wav.readUInt32LE(24), 24000); assert.equal(wav.readUInt16LE(34), 16);
      assert.deepEqual(wav.subarray(44), pcm);
      return Response.json({ text: '  Synthetic dictation.  ', usage: { type: 'duration', seconds: .2 } });
    } });
  assert.deepEqual(order, ['reserve', 'fetch', 'settle']); assert.deepEqual(reply, { text: 'Synthetic dictation.', usage: { voiceSeconds: .2, finalized: true } });
  const saved = JSON.stringify(events); assert.equal(saved.includes(audio), false); assert.doesNotMatch(saved, /synthetic-offline-key|Synthetic dictation/);
  assert.equal(events[0].type, 'dictation.provider.started'); assert.equal(events.at(-1)?.type, 'dictation.provider.completed');
});

test('dictation preserves unknown usage and validates transcript output without retries or provider error leakage', async () => {
  for (const [payload, expected] of [[{ text: '' }, 422], [{ text: 'x'.repeat(2001) }, 502], [{ text: 3 }, 502]] as const) {
    let calls = 0;
    await assert.rejects(transcribeVisitorDictation(pcm, signal(), { apiKey: 'synthetic', reserve: noBudget, fetch: async () => { calls++; return Response.json(payload); } }), (error: AppError) => error.status === expected);
    assert.equal(calls, 1);
  }
  const reply = await transcribeVisitorDictation(pcm, signal(), { apiKey: 'synthetic', reserve: noBudget, fetch: async () => Response.json({ text: 'Synthetic words.', usage: { type: 'duration', seconds: -1 } }) });
  assert.equal(reply.usage, undefined);
  let calls = 0;
  await assert.rejects(transcribeVisitorDictation(pcm, signal(), { apiKey: 'synthetic', reserve: noBudget, fetch: async () => { calls++; return new Response('Private provider failure', { status: 500 }); } }), (error: AppError) => error.status === 502 && !error.message.includes('Private provider failure'));
  assert.equal(calls, 1);
});

test('budget refusal and pre-abort make no provider call; in-flight cancellation and the 20-second timeout stop once', async context => {
  let calls = 0;
  const forbidden: typeof fetch = async () => { calls++; throw new Error('Unexpected network'); };
  await assert.rejects(transcribeVisitorDictation(pcm, signal(), { apiKey: 'synthetic', reserve: async () => { throw new AppError('Synthetic budget denial', 429); }, fetch: forbidden }), /budget denial/);
  await assert.rejects(transcribeVisitorDictation(pcm, AbortSignal.abort(), { apiKey: 'synthetic', reserve: noBudget, fetch: forbidden }), (error: AppError) => error.status === 499);
  const reservedAbort = new AbortController();
  await assert.rejects(transcribeVisitorDictation(pcm, reservedAbort.signal, { apiKey: 'synthetic', reserve: async () => { reservedAbort.abort(); return undefined; }, fetch: forbidden }), (error: AppError) => error.status === 499);
  assert.equal(calls, 0);
  const cancel = new AbortController();
  const work = transcribeVisitorDictation(pcm, cancel.signal, { apiKey: 'synthetic', reserve: noBudget, fetch: async (_url, init) => {
    calls++; queueMicrotask(() => cancel.abort());
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
  } });
  await assert.rejects(work, (error: AppError) => error.status === 499); assert.equal(calls, 1);
  const timeout = new AbortController();
  context.mock.method(AbortSignal, 'timeout', (ms: number) => { assert.equal(ms, 20000); return timeout.signal; });
  await assert.rejects(transcribeVisitorDictation(pcm, signal(), { apiKey: 'synthetic', reserve: noBudget, fetch: async (_url, init) => {
    calls++; queueMicrotask(() => timeout.abort(new DOMException('Synthetic timeout', 'TimeoutError')));
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
  } }), (error: AppError) => error.status === 504);
  assert.equal(calls, 2);
});

test('dictation timeout remains attached while reading the provider response body', async context => {
  const timeout = new AbortController();
  context.mock.method(AbortSignal, 'timeout', (ms: number) => { assert.equal(ms, 20000); return timeout.signal; });
  let calls = 0;
  await assert.rejects(transcribeVisitorDictation(pcm, signal(), { apiKey: 'synthetic', reserve: noBudget, fetch: async (_url, init) => {
    calls++;
    return new Response(new ReadableStream({ start(body) {
      body.enqueue(new TextEncoder().encode('{"text":"unfinished'));
      init?.signal?.addEventListener('abort', () => body.error(init.signal?.reason), { once: true });
      queueMicrotask(() => timeout.abort(new DOMException('Synthetic stalled body', 'TimeoutError')));
    } }), { headers: { 'content-type': 'application/json' } });
  } }), (error: AppError) => error.status === 504);
  assert.equal(calls, 1);
});

function accessFixture(overrides: Partial<VisitorAvailability> = {}) {
  const siteId = randomUUID(), content = { ...sampleContent('general'), visitor: { ...DEFAULT_VISITOR_SETTINGS } }, ledger = currentLedger(undefined), order: string[] = [];
  const events: PlatformEventInput[] = [];
  const access = async (_slug: string, request?: { requestId: string; kind: 'chat' | 'voice' | 'search' | 'dictation' }) => {
    order.push(request ? 'reserve' : 'access');
    if (request) { assert.equal(request.kind, 'dictation'); reserveDictation(ledger, siteId, request.requestId, content.visitor, true); }
    return { siteId, content, availability: { ...availability(ledger, siteId, content.visitor, true), searchRemaining: 0, ...overrides } };
  };
  return { siteId, content, ledger, order, events, access,
    billingGuard: async () => { order.push('billing'); },
    transcribe: async () => { order.push('transcribe'); return { text: 'Draft words only.', usage: undefined }; },
    observe: async (_siteId: string, event: PlatformEventInput) => { order.push('observe'); events.push(event); },
  };
}

test('published dictation checks access and billing before reserving, returns no reply plan, and never consumes chat', async () => {
  const fixture = accessFixture(), requestId = randomUUID();
  const result = await visitorDictation('fixture', { requestId, audio }, signal(), undefined, fixture);
  assert.deepEqual(Object.keys(result), ['text', 'availability']); assert.equal(result.text, 'Draft words only.');
  assert.equal(result.availability.chatRemaining, DEFAULT_VISITOR_SETTINGS.chatDailyLimit);
  assert.deepEqual(fixture.order, ['access', 'billing', 'reserve', 'transcribe', 'observe', 'access', 'billing']);
  assert.equal(fixture.ledger.dictation?.total, 1); assert.equal(fixture.ledger.totals.chat, 0); assert.equal(fixture.ledger.totals.voice, 0);
  assert.equal(fixture.events[0].status, 'unknown'); assert.equal(fixture.events[0].usage, undefined);
  await assert.rejects(visitorDictation('fixture', { requestId, audio }, signal(), undefined, fixture), /already received/);
  assert.equal(fixture.order.filter(value => value === 'transcribe').length, 1);
});

test('chat-only publishers and exhausted continuous voice still permit dictation while chat remains', async () => {
  for (const mode of ['chat', 'voice'] as const) {
    const fixture = accessFixture({ mode, voiceRemaining: 0 });
    fixture.content.visitor.mode = mode; fixture.content.visitor.voiceDailyLimit = 0;
    const result = await visitorDictation('fixture', { requestId: randomUUID(), audio }, signal(), undefined, fixture);
    assert.equal(result.text, 'Draft words only.'); assert.equal(result.availability.voiceRemaining, 0);
    assert.equal(result.availability.chatRemaining, DEFAULT_VISITOR_SETTINGS.chatDailyLimit);
    assert.equal(fixture.ledger.dictation?.total, 1); assert.equal(fixture.ledger.totals.chat, 0);
  }
});

test('disabled, offline, exhausted, billing-blocked and changed publications never reach transcription', async () => {
  for (const overrides of [{ enabled: false }, { live: false }, { chatRemaining: 0 }]) {
    const fixture = accessFixture(overrides);
    await assert.rejects(visitorDictation('fixture', { requestId: randomUUID(), audio }, signal(), undefined, fixture), AppError);
    assert.deepEqual(fixture.order, ['access']); assert.equal(fixture.ledger.dictation, undefined);
  }
  const blocked = accessFixture();
  blocked.billingGuard = async () => { throw new AppError('Synthetic Stripe test guard', 503); };
  await assert.rejects(visitorDictation('fixture', { requestId: randomUUID(), audio }, signal(), undefined, blocked), /Stripe test guard/);
  assert.equal(blocked.ledger.dictation, undefined); assert.equal(blocked.order.includes('transcribe'), false);
  const changed = accessFixture(), access = changed.access;
  changed.access = async (slug, request) => { const result = await access(slug, request); return request ? { ...result, content: { ...result.content, name: 'Changed publication' } } : result; };
  await assert.rejects(visitorDictation('fixture', { requestId: randomUUID(), audio }, signal(), undefined, changed), (error: AppError) => error.status === 409);
  assert.equal(changed.order.includes('transcribe'), false);
});
