import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { scheduleLocalVoiceDeadline } from '../lib/local-voice-deadline';

const env = { NODE_ENV: 'development' as const, FLOWPATH_LOCAL_APP: '1', FLOWPATH_LOCAL_APP_ORIGIN: 'http://localhost:3220',
  FLOWPATH_ACCOUNT_MODE: 'firebase', FLOWPATH_FIRESTORE_EDITION: 'standard', FLOWPATH_FIREBASE_PROJECT_ID: 'flowpath-studio',
  FLOWPATH_PUBLIC_ORIGIN: '', FLOWPATH_PAID_FIXTURES: '0', GOOGLE_APPLICATION_CREDENTIALS: '/dev/null' };

test('the independent local deadline worker must acknowledge readiness before a provider may start', async () => {
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  let worker: ChildProcess | undefined;
  try {
    await scheduleLocalVoiceDeadline(randomUUID(), Date.now() + 60_000, (path, args, options) => {
      assert.equal(options.detached, true);
      // No provider key or usable credential is supplied; this test kills the worker before its deadline.
      worker = fork(path, args, { ...options, env: { ...env, PATH: process.env.PATH } });
      return worker;
    });
    assert.ok(worker && !worker.killed);
    worker.kill();
    await assert.rejects(scheduleLocalVoiceDeadline(randomUUID(), Date.now() + 60_000, (path, _args, options) =>
      fork(path, ['invalid', String(Date.now() + 60_000)], { ...options, env: { ...env, PATH: process.env.PATH } })), /worker exited/);
    await assert.rejects(scheduleLocalVoiceDeadline(randomUUID(), Date.now() + 901_000), /Invalid local deadline/);
  } finally {
    worker?.kill();
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
