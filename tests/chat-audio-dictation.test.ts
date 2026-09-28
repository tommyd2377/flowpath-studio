import assert from 'node:assert/strict';
import test from 'node:test';
import { browserChatAudioEnvironment, createChatAudioDictation, type ChatAudioEnvironment, type ChatTranscribe } from '../lib/chat-audio-dictation';
import type { ChatDictationState } from '../lib/chat-dictation';
import { MAX_PCM_BYTES, PCM_RATE } from '../lib/visitor-model';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

class FakeTrack {
  stops = 0;
  onended: (() => void) | null = null;
  stop() { this.stops++; }
}
class FakeStream {
  track = new FakeTrack();
  getTracks() { return [this.track]; }
}
class FakeRecorder {
  state: RecordingState = 'inactive';
  mimeType = 'audio/webm';
  starts = 0;
  stops = 0;
  timeslice?: number;
  finalChunk = new Blob(['synthetic encoded recording'], { type: 'audio/webm' });
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start(timeslice?: number) { this.starts++; this.timeslice = timeslice; this.state = 'recording'; }
  stop() {
    this.stops++; this.state = 'inactive';
    queueMicrotask(() => { this.ondataavailable?.({ data: this.finalChunk }); this.onstop?.(); });
  }
}
function decodedAudio(seconds = 0.5, sampleRate = 48_000, channelValues = [0.4, 0.2]) {
  const channels = channelValues.map(value => new Float32Array(Math.floor(seconds * sampleRate)).fill(value));
  return { sampleRate, numberOfChannels: channels.length, length: channels[0].length, getChannelData: (channel: number) => channels[channel] } as AudioBuffer;
}
class FakeContext {
  state: AudioContextState = 'suspended';
  closes = 0;
  decodes = 0;
  decode = async () => decodedAudio();
  decodeAudioData() { this.decodes++; return this.decode(); }
  async close() { this.closes++; this.state = 'closed'; }
}
function harness(initialText = '') {
  const stream = new FakeStream();
  const recorders: FakeRecorder[] = [], contexts: FakeContext[] = [], states: ChatDictationState[] = [];
  const uploads: { audio: string; signal: AbortSignal }[] = [];
  let text = initialText, permissions = 0;
  const behavior = {
    permission: async () => stream as unknown as MediaStream,
    decode: async () => decodedAudio(),
    transcribe: async () => 'spoken words',
  };
  const environment: ChatAudioEnvironment = {
    getUserMedia: () => { permissions++; return behavior.permission(); },
    createRecorder: () => { const recorder = new FakeRecorder(); recorders.push(recorder); return recorder as unknown as MediaRecorder; },
    createContext: () => { const context = new FakeContext(); context.decode = behavior.decode; contexts.push(context); return context as unknown as AudioContext; },
  };
  const transcribe: ChatTranscribe = (audio, signal) => { uploads.push({ audio, signal }); return behavior.transcribe(); };
  const controller = createChatAudioDictation({
    getEnvironment: () => environment,
    getText: () => text,
    onText: value => { text = value; },
    onState: value => states.push(value),
  });
  return { controller, stream, recorders, contexts, states, uploads, behavior, transcribe, permissions: () => permissions, text: () => text, edit: (value: string) => { text = value; } };
}

test('recording needs a deliberate start and does not depend on speech recognition', async t => {
  assert.equal(browserChatAudioEnvironment(), undefined, 'server rendering cannot request microphone access');
  const h = harness(); t.after(h.controller.dispose);
  assert.equal(h.permissions(), 0); assert.equal(h.contexts.length, 0);
  h.controller.start({ transcribe: h.transcribe }); h.controller.start({ transcribe: h.transcribe });
  assert.equal(h.permissions(), 1); assert.equal(h.states.at(-1)?.status, 'starting');
  await flush();
  assert.equal(h.states.at(-1)?.status, 'listening'); assert.equal(h.recorders[0].starts, 1);
  assert.equal(h.recorders[0].timeslice, 250); assert.equal(h.uploads.length, 0);
});

test('finish releases the microphone and decoder before one bounded PCM upload', async t => {
  const h = harness('Typed\n'), response = deferred<string>(); t.after(h.controller.dispose);
  h.behavior.transcribe = () => {
    assert.equal(h.stream.track.stops, 1); assert.equal(h.contexts[0].closes, 1);
    return response.promise;
  };
  h.controller.start({ transcribe: h.transcribe }); await flush();
  const lateStop = h.recorders[0].onstop!;
  h.controller.finish(); h.controller.finish();
  assert.equal(h.states.at(-1)?.status, 'transcribing'); assert.equal(h.stream.track.stops, 1);
  await flush(); lateStop(); lateStop(); await flush();
  assert.equal(h.uploads.length, 1);
  assert.equal(h.recorders[0].stops, 1);
  response.resolve('finished words'); await flush(); assert.equal(h.text(), 'Typed\nfinished words');
});

test('a completed recording downmixes to mono, appends once and remains editable', async t => {
  const h = harness('Typed\n'); t.after(h.controller.dispose); h.controller.start({ transcribe: h.transcribe }); await flush();
  h.controller.finish(); await flush();
  assert.equal(h.uploads.length, 1); assert.equal(h.contexts[0].closes, 1); assert.equal(h.stream.track.stops, 1);
  const pcm = Buffer.from(h.uploads[0].audio, 'base64');
  assert.equal(pcm.length, PCM_RATE, 'half a second of mono PCM16 at 24kHz');
  assert.ok(Math.abs(pcm.readInt16LE(0) - Math.trunc(0.3 * 32767)) <= 1, 'both input channels are mixed');
  assert.equal(h.text(), 'Typed\nspoken words'); assert.equal(h.states.at(-1)?.status, 'idle');
  h.edit('My edited message'); h.controller.syncText(h.text()); assert.equal(h.text(), 'My edited message');
});

test('cancel or finish during permission prompt releases any subsequently granted stream', async t => {
  for (const action of ['stop', 'finish', 'dispose'] as const) {
    const h = harness('Keep draft'), permission = deferred<MediaStream>(); t.after(h.controller.dispose);
    h.behavior.permission = () => permission.promise;
    h.controller.start({ transcribe: h.transcribe }); h.controller[action]();
    const count = h.states.length;
    permission.resolve(h.stream as unknown as MediaStream); await flush();
    assert.equal(h.stream.track.stops, 1); assert.equal(h.recorders.length, 0); assert.equal(h.uploads.length, 0);
    assert.equal(h.text(), 'Keep draft'); assert.equal(h.states.length, count);
  }
});

test('permission rejection is friendly and never opens a decoder or retries', async t => {
  const h = harness(); t.after(h.controller.dispose);
  h.behavior.permission = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  h.controller.start({ transcribe: h.transcribe }); await flush();
  assert.equal(h.states.at(-1)?.status, 'error'); assert.match(h.states.at(-1)!.message, /Microphone access was blocked/);
  assert.equal(h.permissions(), 1); assert.equal(h.contexts.length, 0); assert.equal(h.uploads.length, 0);
});

test('manual edits and cancellation discard captured audio and stale recorder events', async t => {
  for (const sync of [false, true]) {
    const h = harness('Original'); t.after(h.controller.dispose); h.controller.start({ transcribe: h.transcribe }); await flush();
    const oldData = h.recorders[0].ondataavailable!, oldError = h.recorders[0].onerror!;
    h.edit('My correction'); if (sync) h.controller.syncText(h.text());
    oldData({ data: new Blob(['late audio']) }); oldError(); await flush();
    assert.equal(h.text(), 'My correction'); assert.equal(h.stream.track.stops, 1);
    assert.equal(h.uploads.length, 0); assert.equal(h.states.at(-1)?.status, 'idle');
  }
});

test('cancellation during decoding closes its context and prevents upload', async t => {
  const h = harness('Draft'), decoded = deferred<AudioBuffer>(); t.after(h.controller.dispose);
  h.behavior.decode = () => decoded.promise; h.controller.start({ transcribe: h.transcribe }); await flush();
  h.controller.finish(); await flush(); assert.equal(h.contexts.length, 1);
  h.controller.stop(); const count = h.states.length; assert.equal(h.contexts[0].closes, 1);
  decoded.resolve(decodedAudio()); await flush();
  assert.equal(h.uploads.length, 0); assert.equal(h.states.length, count); assert.equal(h.text(), 'Draft');
});

test('pending transcription aborts on edits or disposal and late replies cannot change the draft', async t => {
  for (const failure of [false, true]) {
    const h = harness('Draft'), response = deferred<string>(); t.after(h.controller.dispose);
    h.behavior.transcribe = () => response.promise;
    h.controller.start({ transcribe: h.transcribe }); await flush(); h.controller.finish(); await flush();
    assert.equal(h.uploads.length, 1); assert.equal(h.contexts[0].closes, 1);
    if (failure) h.controller.dispose();
    else { h.edit('Changed while waiting'); h.controller.syncText(h.text()); }
    assert.equal(h.uploads[0].signal.aborted, true); const count = h.states.length;
    if (failure) response.reject(new Error('Late failure')); else response.resolve('late words');
    await flush(); assert.equal(h.states.length, count); assert.equal(h.uploads.length, 1);
    assert.equal(h.text(), failure ? 'Draft' : 'Changed while waiting');
  }
});

test('recording bytes, empty audio and decoding failures stop before any paid call', async t => {
  for (const scenario of ['large', 'empty', 'decode'] as const) {
    const h = harness('Draft'); t.after(h.controller.dispose);
    if (scenario === 'decode') h.behavior.decode = async () => { throw new DOMException('Invalid audio', 'EncodingError'); };
    h.controller.start({ transcribe: h.transcribe }); await flush();
    if (scenario === 'large') h.recorders[0].ondataavailable?.({ data: new Blob([new Uint8Array(2_000_001)]) });
    else { if (scenario === 'empty') h.recorders[0].finalChunk = new Blob([]); h.controller.finish(); }
    await flush();
    assert.equal(h.uploads.length, 0); assert.equal(h.stream.track.stops, 1); assert.equal(h.text(), 'Draft');
    assert.equal(h.states.at(-1)?.status, 'error');
    if (scenario === 'decode') assert.equal(h.contexts[0].closes, 1);
  }
});

test('device loss, recorder errors and unexpected stops release the microphone without uploading', async t => {
  for (const source of ['device', 'recorder', 'end'] as const) {
    const h = harness('Draft'); t.after(h.controller.dispose); h.controller.start({ transcribe: h.transcribe }); await flush();
    if (source === 'device') h.stream.track.onended?.();
    else if (source === 'recorder') h.recorders[0].onerror?.();
    else { h.recorders[0].state = 'inactive'; h.recorders[0].onstop?.(); }
    await flush(); assert.equal(h.stream.track.stops, 1); assert.equal(h.uploads.length, 0);
    assert.equal(h.states.at(-1)?.status, 'error'); assert.equal(h.text(), 'Draft');
  }
});

test('duration cap finalizes once and decoded PCM cannot exceed twenty seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); t.after(h.controller.dispose); h.behavior.decode = async () => decodedAudio(21);
  h.controller.start({ transcribe: h.transcribe }); await flush(); t.mock.timers.tick(20_000); await flush();
  assert.equal(h.uploads.length, 1); assert.equal(Buffer.from(h.uploads[0].audio, 'base64').length, MAX_PCM_BYTES);
  t.mock.timers.tick(120_000); await flush(); assert.equal(h.uploads.length, 1); assert.equal(h.permissions(), 1);
});

test('permission and transcription timeouts cancel the attempt without retries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(), permission = deferred<MediaStream>(); t.after(h.controller.dispose);
  h.behavior.permission = () => permission.promise; h.controller.start({ transcribe: h.transcribe });
  t.mock.timers.tick(30_000); assert.equal(h.states.at(-1)?.status, 'error');
  permission.resolve(h.stream as unknown as MediaStream); await flush(); assert.equal(h.stream.track.stops, 1);
  const response = deferred<string>(); h.behavior.transcribe = () => response.promise;
  h.controller.start({ transcribe: h.transcribe }); await flush(); h.controller.finish(); await flush();
  t.mock.timers.tick(30_000); assert.equal(h.uploads[0].signal.aborted, true); assert.match(h.states.at(-1)!.message, /timed out/);
  response.resolve('too late'); await flush(); assert.equal(h.text(), ''); assert.equal(h.uploads.length, 1);
});

test('transcription failures, empty speech and full drafts never trigger automatic retries', async t => {
  for (const result of ['', 'error', 'spoken words']) {
    const h = harness('Typed'); t.after(h.controller.dispose);
    h.behavior.transcribe = async () => { if (result === 'error') throw new Error('Dictation has reached its daily limit.'); return result; };
    h.controller.start({ transcribe: h.transcribe, maxLength: 10 }); await flush(); h.controller.finish(); await flush();
    assert.equal(h.uploads.length, 1);
    if (result === 'spoken words') { assert.equal(h.text(), 'Typed spok'); assert.match(h.states.at(-1)!.message, /message is full/); }
    else { assert.equal(h.text(), 'Typed'); assert.equal(h.states.at(-1)?.status, 'error'); }
    if (result === 'error') assert.match(h.states.at(-1)!.message, /daily limit/);
  }
  const full = harness('already full'); t.after(full.controller.dispose);
  full.controller.start({ transcribe: full.transcribe, maxLength: 10 }); assert.equal(full.permissions(), 0); assert.equal(full.text(), 'already full');
});
