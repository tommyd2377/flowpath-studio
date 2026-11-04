import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createReadinessPreparation, READINESS_PREPARATION_TTL_MS, type ReadinessSnapshot } from '../lib/voice-readiness-preparation';

const available: ReadinessSnapshot = { ok: true, body: { enabled: true }, serverTiming: 'fp_scope;dur=5' };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('preparation is single-flight, joins in-flight work, and is consumed once', async () => {
  let time = 20, calls = 0;
  const pending = deferred<ReadinessSnapshot>();
  const cache = createReadinessPreparation(() => time);
  const read = () => { calls++; return pending.promise; };
  cache.prepare('private', read);
  cache.prepare('private', read);
  const result = cache.take('private', read, new AbortController().signal);
  assert.equal(calls, 1);
  time = 50;
  pending.resolve(available);
  assert.deepEqual(await result, { result: available, source: 'pending', startedAt: 20, completedAt: 50 });
  const next = await cache.take('private', async () => { calls++; return available; }, new AbortController().signal);
  assert.equal(next.source, 'cold');
  assert.equal(calls, 2);
});

test('a settled successful preparation is used once before its request-start TTL', async () => {
  let time = 10, calls = 0;
  const cache = createReadinessPreparation(() => time);
  cache.prepare('private', async () => { calls++; return available; });
  await flush();
  time = 10 + READINESS_PREPARATION_TTL_MS - 1;
  const result = await cache.take('private', async () => { calls++; return available; }, new AbortController().signal);
  assert.equal(result.source, 'ready');
  assert.equal(result.startedAt, 10);
  assert.equal(result.completedAt, 10);
  assert.equal(calls, 1);
});

test('a preparation expires based on start time and is not extended by completion', async () => {
  let time = 0, calls = 0;
  const pending = deferred<ReadinessSnapshot>();
  const cache = createReadinessPreparation(() => time);
  cache.prepare('private', () => { calls++; return pending.promise; });
  time = READINESS_PREPARATION_TTL_MS - 1;
  pending.resolve(available);
  await flush();
  time = READINESS_PREPARATION_TTL_MS;
  const result = await cache.take('private', async () => { calls++; return available; }, new AbortController().signal);
  assert.equal(result.source, 'cold');
  assert.equal(calls, 2);
});

test('disabled and failed background results do not suppress a fresh click check', async () => {
  for (const result of [{ ok: false, body: { enabled: true }, serverTiming: null },
    { ok: true, body: { enabled: false }, serverTiming: null }, { ok: true, body: null, serverTiming: null }]) {
    let calls = 0;
    const cache = createReadinessPreparation();
    cache.prepare('private', async () => { calls++; return result; });
    await flush();
    const attempt = await cache.take('private', async () => { calls++; return available; }, new AbortController().signal);
    assert.equal(attempt.source, 'cold');
    assert.equal(calls, 2);
  }
  const cache = createReadinessPreparation();
  cache.prepare('private', async () => { throw new Error('synthetic read failure'); });
  await flush();
  const attempt = await cache.take('private', async () => available, new AbortController().signal);
  assert.equal(attempt.source, 'cold');
});

test('a disabled result already joined by a click is delivered to that click only', async () => {
  const cache = createReadinessPreparation();
  const pending = deferred<ReadinessSnapshot>();
  const disabled: ReadinessSnapshot = { ok: true, body: { enabled: false }, serverTiming: null };
  cache.prepare('private', () => pending.promise);
  const attempt = cache.take('private', async () => available, new AbortController().signal);
  pending.resolve(disabled);
  assert.equal((await attempt).result, disabled);
  assert.equal((await cache.take('private', async () => available, new AbortController().signal)).source, 'cold');
});

test('scope replacement aborts old work and late results cannot replace the new entry', async () => {
  const cache = createReadinessPreparation();
  const old = deferred<ReadinessSnapshot>();
  const next = deferred<ReadinessSnapshot>();
  let oldSignal!: AbortSignal;
  cache.prepare('old', signal => { oldSignal = signal; return old.promise; });
  cache.prepare('new', () => next.promise);
  assert.equal(oldSignal.aborted, true);
  old.resolve(available);
  next.resolve(available);
  await flush();
  const result = await cache.take('new', async () => { throw new Error('unexpected read'); }, new AbortController().signal);
  assert.equal(result.source, 'ready');
});

test('clear and caller cancellation abort pending reads even if callbacks ignore abort', async () => {
  for (const cancel of ['clear', 'caller'] as const) {
    const cache = createReadinessPreparation();
    const never = deferred<ReadinessSnapshot>();
    const user = new AbortController();
    let readSignal!: AbortSignal;
    cache.prepare('private', signal => { readSignal = signal; return never.promise; });
    const attempt = cache.take('private', async () => available, user.signal);
    if (cancel === 'clear') cache.clear(); else user.abort();
    await assert.rejects(attempt, { name: 'AbortError' });
    assert.equal(readSignal.aborted, true);
    never.resolve(available);
    await flush();
    assert.equal((await cache.take('private', async () => available, new AbortController().signal)).source, 'cold');
  }
});

test('an already-canceled click does not start any readiness read', async () => {
  const cache = createReadinessPreparation();
  const user = new AbortController();
  user.abort();
  let calls = 0;
  await assert.rejects(cache.take('private', async () => { calls++; return available; }, user.signal), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('disabled and failed preparations are throttled while a deliberate click retries', async () => {
  for (const outcome of ['disabled', 'failure'] as const) {
    let now = 0, calls = 0;
    const cache = createReadinessPreparation(() => now);
    const read = async () => {
      calls++;
      if (outcome === 'failure') throw new Error('synthetic failure');
      return { ok: true, body: { enabled: false }, serverTiming: null };
    };
    cache.prepare('private', read);
    await flush();
    cache.prepare('private', read);
    await flush();
    assert.equal(calls, 1);
    assert.equal((await cache.take('private', async () => { calls++; return available; }, new AbortController().signal)).source, 'cold');
    assert.equal(calls, 2);
    cache.prepare('private', read);
    assert.equal(calls, 2);
    now = READINESS_PREPARATION_TTL_MS;
    cache.prepare('private', read);
    await flush();
    assert.equal(calls, 3);
  }
});

test('throttles preparation separately by scope and clear resets the cooldown', async () => {
  let calls = 0;
  const cache = createReadinessPreparation(() => 0);
  const read = async () => { calls++; return { ok: false, body: null, serverTiming: null }; };
  cache.prepare('a', read);
  await flush();
  cache.prepare('b', read);
  await flush();
  cache.prepare('a', read);
  assert.equal(calls, 2);
  cache.clear();
  cache.prepare('a', read);
  assert.equal(calls, 3);
});

test('hover or focus preparation cannot cancel a pending click-owned request', async () => {
  const cache = createReadinessPreparation();
  const pending = deferred<ReadinessSnapshot>();
  let readSignal!: AbortSignal;
  const attempt = cache.take('a', signal => { readSignal = signal; return pending.promise; }, new AbortController().signal);
  let extraCalls = 0;
  cache.prepare('a', async () => { extraCalls++; return available; });
  cache.prepare('b', async () => { extraCalls++; return available; });
  assert.equal(extraCalls, 0);
  assert.equal(readSignal.aborted, false);
  pending.resolve(available);
  assert.equal((await attempt).source, 'cold');
});


test('a failed pending preparation retries once as a fresh click request', async () => {
  const cache = createReadinessPreparation();
  const pending = deferred<ReadinessSnapshot>();
  cache.prepare('private', () => pending.promise);
  let coldCalls = 0;
  const attempt = cache.take('private', async () => { coldCalls++; return available; }, new AbortController().signal);
  pending.reject(new Error('synthetic preparation failure'));
  const result = await attempt;
  assert.equal(result.source, 'cold');
  assert.equal(result.result, available);
  assert.equal(coldCalls, 1);
});

test('a failing cold request is never retried after a failed preparation', async () => {
  const cache = createReadinessPreparation();
  const pending = deferred<ReadinessSnapshot>();
  cache.prepare('private', () => pending.promise);
  let coldCalls = 0;
  const attempt = cache.take('private', async () => { coldCalls++; throw new Error('synthetic cold failure'); }, new AbortController().signal);
  pending.reject(new Error('synthetic preparation failure'));
  await assert.rejects(attempt, /synthetic cold failure/);
  assert.equal(coldCalls, 1);
});

test('explicit cancellation of a joined preparation never falls back', async () => {
  for (const cancellation of ['caller', 'clear'] as const) {
    const cache = createReadinessPreparation();
    const pending = deferred<ReadinessSnapshot>();
    cache.prepare('private', () => pending.promise);
    const controller = new AbortController();
    let coldCalls = 0;
    const attempt = cache.take('private', async () => { coldCalls++; return available; }, controller.signal);
    if (cancellation === 'caller') controller.abort(); else cache.clear();
    await assert.rejects(attempt, { name: 'AbortError' });
    pending.reject(new Error('late failure'));
    await flush();
    assert.equal(coldCalls, 0);
  }
});
