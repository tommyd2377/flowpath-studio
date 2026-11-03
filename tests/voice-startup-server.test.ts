import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';
import { createVoiceServer } from '../lib/voice-server';

const origin = 'http://localhost:3220';
const waveformId = 'ff000000-0000-4000-8000-000000000000';
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';
function request(method: string, timing = false, body?: object) {
  return new Request(`${origin}/api/session?waveformId=${waveformId}`, { method,
    headers: { host: 'localhost:3220', origin, 'content-type': 'application/json', ...(timing ? { 'X-FlowPath-Startup-Timing': '1' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}
const waveform = { ownerUid: 'fixture-owner', waveform: { name: 'Fixture', initialPrompt: 'Fixture' }, isCurrent: () => true };

test('independent authorization lookups overlap while a revoked waveform is still rejected', async () => {
  const started = new Set<string>();
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const lookup = async (name: string) => { started.add(name); await barrier; };
  const server = createVoiceServer({ enabled: () => true, apiKey: () => 'synthetic',
    resolveAdmin: async () => { await lookup('admin'); return null; },
    resolvePublicVisitor: async () => { await lookup('visitor'); return null; },
    resolveWaveform: async () => { await lookup('waveform'); return { ...waveform, isCurrent: () => false }; },
    requestProvider: () => { throw new Error('No provider call is permitted'); },
  });
  const pending = server.POST(request('POST', true, { sessionId: randomUUID(), sdp }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([...started].sort(), ['admin', 'visitor', 'waveform']);
  release();
  const response = await pending;
  assert.equal(response.status, 403);
  assert.match(response.headers.get('Server-Timing') ?? '', /^fp_scope;dur=\d+\.\d$/);
});

test('startup timing is opt-in, numeric only, and does not expose session details', async () => {
  class FakeSocket extends EventEmitter {
    readyState: 0 | 1 | 2 | 3 = WebSocket.OPEN;
    constructor() { super(); queueMicrotask(() => this.emit('open')); }
    send(text: string) {
      if (JSON.parse(text).type === 'session.close') queueMicrotask(() => this.emit('message', JSON.stringify({
        type: 'session.closed', session: { id: 'synthetic-provider' }, usage: { seconds: 1 },
      })));
    }
    terminate() { this.readyState = WebSocket.CLOSED; this.emit('close'); }
  }
  const server = createVoiceServer({ enabled: () => true, apiKey: () => 'synthetic', resolveWaveform: async () => waveform,
    requestProvider: (async () => Response.json({ session: { id: 'synthetic-provider' }, transport: { sdp } })) as typeof fetch,
    socketFactory: () => new FakeSocket(),
  });
  const noTiming = await server.GET(request('GET'));
  assert.equal(noTiming.headers.get('Server-Timing'), null);
  const sessionId = randomUUID();
  const response = await server.POST(request('POST', true, { sessionId, sdp }));
  assert.equal(response.status, 201);
  const timing = response.headers.get('Server-Timing') ?? '';
  const metrics = timing.split(', ');
  assert.deepEqual(metrics.map(metric => metric.split(';')[0]), ['fp_scope', 'fp_provider', 'fp_supervision']);
  for (const metric of metrics) assert.match(metric, /^fp_(scope|provider|supervision);dur=\d+\.\d$/);
  assert.ok(!timing.includes(sessionId) && !timing.includes('fixture') && !timing.includes('synthetic'));
  assert.equal((await server.DELETE(request('DELETE', false, { sessionId }))).status, 200);
});
