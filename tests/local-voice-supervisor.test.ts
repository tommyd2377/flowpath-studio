import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { superviseLocalVoice } from '../lib/local-voice-supervisor';

const env = { NODE_ENV: 'development' as const, FLOWPATH_LOCAL_APP: '1', FLOWPATH_LOCAL_APP_ORIGIN: 'http://localhost:3220',
  FLOWPATH_ACCOUNT_MODE: 'firebase', FLOWPATH_FIRESTORE_EDITION: 'standard', FLOWPATH_FIREBASE_PROJECT_ID: 'flowpath-studio',
  FLOWPATH_PUBLIC_ORIGIN: '', FLOWPATH_PAID_FIXTURES: '0', FLOWPATH_LIVE_ENABLED: '0' };

for (const trigger of ['disconnect', 'SIGTERM'] as const) test(`independent process persists finalization after parent ${trigger}`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-observer-fixture-'));
  const receipt = join(directory, 'synthetic-receipt.json');
  const worker = fork('tests/fixtures/local-voice-observer.ts', [receipt], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { NODE_ENV: 'test', PATH: process.env.PATH },
  });
  const exited = new Promise(resolve => worker.once('exit', resolve));
  const timeout = setTimeout(() => worker.kill('SIGKILL'), 5_000);
  try {
    await new Promise<void>((resolve, reject) => {
      worker.once('message', message => message === 'ready' ? resolve() : reject(new Error('Unexpected observer message')));
      worker.once('error', reject); worker.once('exit', () => reject(new Error('Observer exited before ready')));
    });
    if (trigger === 'disconnect') worker.disconnect(); else worker.kill(trigger);
    assert.equal(await exited, 0);
    assert.deepEqual(JSON.parse(await readFile(receipt, 'utf8')), { closed: true, seconds: 2.5 });
  } finally { clearTimeout(timeout); worker.kill(); await rm(directory, { recursive: true, force: true }); }
});

test('independent observer handshakes before SDP release and closes once with confirmed usage', async () => {
  const saved = { ...process.env }; Object.assign(process.env, env);
  const worker = new EventEmitter() as EventEmitter & { connected: boolean; disconnect(): void; send(message: unknown, callback: (error?: Error) => void): void; unref(): void };
  let closes = 0, disconnected = 0, started = 0;
  Object.assign(worker, { connected: true, disconnect() { worker.connected = false; disconnected++; }, unref() {},
    send(message: unknown, callback: (error?: Error) => void) { assert.equal(message, 'close'); closes++; callback(); } });
  try {
    const control = superviseLocalVoice(randomUUID(), () => { started++; }, (path, args, options) => {
      assert.ok(path.endsWith('/scripts/local-voice-supervisor.ts')); assert.equal(args.length, 1);
      assert.equal(options.detached, true);
      return worker as unknown as ChildProcess;
    });
    let ready = false; void control.ready.then(() => { ready = true; });
    await Promise.resolve(); assert.equal(ready, false);
    worker.emit('message', 'ready'); await control.ready;
    worker.emit('message', 'started'); assert.equal(started, 1);
    const first = control.close(); assert.equal(control.close(), first);
    await Promise.resolve(); assert.equal(closes, 1);
    worker.emit('message', { closed: true, finalized: true, seconds: 3.25 });
    assert.deepEqual(await first, { finalized: true, seconds: 3.25 });
    worker.emit('exit', 0); assert.equal(disconnected, 1);
  } finally {
    for (const name of Object.keys(env)) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
  }
});

test('worker loss never pretends closure was confirmed; disabled standalone worker exits without provider use', async () => {
  const saved = { ...process.env }; Object.assign(process.env, env);
  try {
    const worker = Object.assign(new EventEmitter(), { connected: true, disconnect() { this.connected = false; }, unref() {} });
    const control = superviseLocalVoice(randomUUID(), () => {}, () => worker as unknown as ChildProcess);
    worker.emit('exit', 1);
    await assert.rejects(control.ready, /supervision ended/);
    assert.deepEqual(await control.closed, { finalized: false });
    const child = fork('scripts/local-voice-supervisor.ts', [randomUUID()], {
      execArgv: ['--import', 'tsx'], stdio: 'ignore', env: { ...env, PATH: process.env.PATH, GOOGLE_APPLICATION_CREDENTIALS: '/dev/null' },
    });
    assert.equal(await new Promise(resolve => child.once('exit', resolve)), 1);
  } finally {
    for (const name of Object.keys(env)) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
  }
});
