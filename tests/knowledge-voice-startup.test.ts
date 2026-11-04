import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { creationContentDigest } from '../lib/creation-safety';
import { voiceSessionConfig } from '../lib/voice-config';
import type { KnowledgeScope } from '../lib/knowledge-store';

test('only voice creation checks selected Knowledge; readiness and cleanup do not reconcile it', async t => {
  // Synthetic fixtures are selected only inside this test process; no provider is called.
  Object.assign(process.env, { NODE_ENV: 'development', FLOWPATH_ACCOUNT_MODE: 'local', FLOWPATH_KNOWLEDGE_FIXTURES: '1' });
  const { accountServer } = await import('../lib/account-runtime');
  const { withWaveformKnowledge, knowledgeStore } = await import('../lib/knowledge-runtime');
  // Knowledge captured fixture mode on import. Keep this resolver test independent of the local password layer.
  process.env.FLOWPATH_ACCOUNT_MODE = 'unavailable';
  t.after(() => { process.env.FLOWPATH_ACCOUNT_MODE = 'local'; });
  const id = randomUUID();
  const waveform = { id, name: 'Fixture', initialPrompt: 'Help visitors.', voice: 'marin' as const,
    accentColor: '#3a66ff', profilePhoto: null, updatedAt: new Date().toISOString() };
  t.mock.method(accountServer, 'resolveVoiceWaveform', async () => ({ ownerUid: 'fixture-owner', waveform,
    accountSessionId: 'fixture-session', isCurrent: () => true }));
  let reads = 0;
  t.mock.method(knowledgeStore, 'enabled', async (scope: KnowledgeScope) => {
    reads++;
    assert.equal(scope.uid, 'fixture-owner');
    assert.equal(scope.waveformId, id);
    return true; // Selected Knowledge, as established by the Knowledge store tests.
  });
  const resolve = (method: string) => withWaveformKnowledge(new Request(`http://localhost:3220/api/session?waveformId=${id}`, { method }), id);
  for (const method of ['GET', 'DELETE', 'PATCH']) {
    const value = await resolve(method);
    assert.equal(value?.waveform.knowledge, false);
    assert.equal(creationContentDigest(value!.waveform), creationContentDigest(waveform));
    assert.equal(reads, 0, `${method} must not read or reconcile Knowledge`);
  }
  const started = await resolve('POST');
  assert.equal(started?.waveform.knowledge, true);
  assert.equal(reads, 1);
  assert.ok(voiceSessionConfig(started!.waveform).delegation.responses.tools.some(tool => tool.name === 'search_waveform_knowledge'));
  assert.equal(creationContentDigest(started!.waveform), creationContentDigest(waveform));
});

test('only a preparation GET uses read-only curated lookup, including its current check', async t => {
  const { accountServer } = await import('../lib/account-runtime');
  const { withWaveformKnowledge } = await import('../lib/knowledge-runtime');
  const { curatedDemo } = await import('../lib/curated-demo-runtime');
  const { FRANKLIN_DEMO_ID, PUBLIC_VOICE_COOKIE } = await import('../lib/public-voice-identity');
  t.mock.method(accountServer, 'resolveVoiceWaveform', async () => null);
  t.mock.method(accountServer, 'resolveIdentity', async () => null);
  const waveform = { id: FRANKLIN_DEMO_ID, name: 'Fixture', initialPrompt: 'Help visitors.', voice: 'marin' as const,
    accentColor: '#3a66ff', profilePhoto: null, updatedAt: new Date().toISOString() };
  const calls: (boolean | undefined)[] = [];
  t.mock.method(curatedDemo, 'published', async (readOnly?: boolean) => {
    calls.push(readOnly);
    return { waveform, ownerUid: 'fixture-owner', contentDigest: creationContentDigest(waveform), publishedAt: 1000 };
  });
  const resolve = (method: string, preparation: boolean) => withWaveformKnowledge(new Request(`http://localhost:3220/api/session?waveformId=${FRANKLIN_DEMO_ID}`, {
    method, headers: { cookie: `${PUBLIC_VOICE_COOKIE}=${'a'.repeat(64)}`, ...(preparation ? { 'X-FlowPath-Prepare': '1' } : {}) },
  }), FRANKLIN_DEMO_ID);
  const prepared = await resolve('GET', true);
  assert.equal(await prepared?.isCurrent(), true);
  assert.deepEqual(calls.splice(0), [true, true]);
  const normal = await resolve('GET', false);
  assert.equal(await normal?.isCurrent(), true);
  assert.deepEqual(calls.splice(0), [false, false]);
  const post = await resolve('POST', true);
  assert.equal(await post?.isCurrent(), true);
  assert.deepEqual(calls.splice(0), [false, false]);
});
