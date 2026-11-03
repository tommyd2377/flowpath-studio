import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginAccess, PluginAccessError, projectPluginPrompt, type PluginAccessScope, type ProtectedPlugin } from '../lib/plugin-access';
import { PaidMemoryDatabase } from './paid-fixture';
import { voiceSessionConfig } from '../lib/voice-config';
import { visualFixture } from './visual-display-fixture';

const code = 'synthetic-code-only';
const scope: PluginAccessScope = { ownerUid: 'owner-a', accountUid: 'owner-a', waveformId: 'fixture-waveform-a', sessionId: 'fixture-session-a' };
const status = (expected: number) => (error: unknown) => error instanceof PluginAccessError && error.status === expected;
function fixture() {
  const db = new PaidMemoryDatabase();
  let time = 1_000_000, activeVoice = false, safetyAllowed = true;
  const revoked = new Set<string>();
  const access = createPluginAccess(db, {
    now: () => time,
    authorize: async (_tx, actor, management) => {
      if (revoked.has(actor.sessionId) || actor.waveformId === 'foreign-waveform'
        || !management && !safetyAllowed) throw new PluginAccessError('Unavailable.');
    },
    assertPolicyMutable: async () => { if (activeVoice) throw new PluginAccessError('End the conversation first.', 409); },
  });
  const protect = (ids: ProtectedPlugin[] = ['text', 'knowledge', 'visual']) => access.configure(scope, { revision: 'off', protectedPlugins: ids, code });
  return { access, db, protect, revoked, advance: (ms: number) => { time += ms; }, voice: (active: boolean) => { activeVoice = active; },
    safety: (allowed: boolean) => { safetyAllowed = allowed; } };
}

test('legacy data defaults off without writes or a generated code', async () => {
  const f = fixture();
  assert.deepEqual(await f.access.settings(scope), { revision: 'off', protectedPlugins: [], codeConfigured: false });
  assert.equal(await f.access.check(scope, ['text', 'knowledge', 'visual']), 'off');
  assert.equal(f.db.rows.size, 0);
});

test('only salted scrypt hashes persist; response projections contain no code, salt or digest', async () => {
  const f = fixture();
  const saved = await f.protect();
  const row = [...f.db.rows.values()][0];
  assert.deepEqual(Object.keys(saved).sort(), ['codeConfigured', 'protectedPlugins', 'revision']);
  assert.match(String(row.salt), /^[a-f0-9]{32}$/);
  assert.match(String(row.digest), /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify([...f.db.rows]).includes(code), false);
  const other = { ...scope, waveformId: 'fixture-waveform-b' };
  await f.access.configure(other, { revision: 'off', protectedPlugins: ['text'], code });
  const next = [...f.db.rows.values()][1];
  assert.notEqual(next.salt, row.salt); assert.notEqual(next.digest, row.digest);
});

test('wrong code, forged token and direct missing-grant reads fail before performing work', async () => {
  const f = fixture(); await f.protect();
  await assert.rejects(f.access.unlock(scope, 'synthetic-wrong-code', ['text']), status(403));
  for (const token of [undefined, 'true', 'a'.repeat(64)]) {
    let called = false;
    await assert.rejects(f.access.read(scope, ['visual'], token, async () => { called = true; return 'protected'; }), status(403));
    assert.equal(called, false);
  }
});

test('one shared code issues opaque grants only for the selected subset; composed reads require every plugin', async () => {
  const f = fixture(); await f.protect();
  const { token } = await f.access.unlock(scope, code, ['knowledge']);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify([...f.db.rows]).includes(token), false);
  await f.access.check(scope, ['knowledge'], token);
  await assert.rejects(f.access.check(scope, ['text'], token), status(403));
  await assert.rejects(f.access.check(scope, ['visual'], token), status(403));
  await assert.rejects(f.access.read(scope, ['knowledge', 'text'], token, async () => 'passage in notes'), status(403));
  const both = await f.access.unlock(scope, code, ['knowledge', 'text']);
  assert.equal(await f.access.read(scope, ['knowledge', 'text'], both.token, async () => 'synthetic passage'), 'synthetic passage');
});

test('grants bind to waveform, owner, account and session; only the owner can configure', async () => {
  const f = fixture(); await f.protect();
  const { token } = await f.access.unlock(scope, code, ['visual']);
  for (const changed of [{ sessionId: 'other-session' }, { accountUid: 'other-account' }, { accountUid: undefined }]) {
    await assert.rejects(f.access.check({ ...scope, ...changed }, ['visual'], token), status(403));
  }
  for (const changed of [{ ownerUid: 'owner-b', accountUid: 'owner-b' }, { waveformId: 'fixture-waveform-b' }]) {
    const other = { ...scope, ...changed };
    await f.access.configure(other, { revision: 'off', protectedPlugins: ['visual'], code });
    await assert.rejects(f.access.check(other, ['visual'], token), status(403));
  }
  await assert.rejects(f.access.configure({ ...scope, accountUid: 'other-account' }, { revision: 'off', protectedPlugins: [] }), status(403));
  await assert.rejects(f.access.check({ ...scope, waveformId: 'foreign-waveform' }, [], token), status(403));
});

test('anonymous grants are separate from account grants and cannot grant Knowledge ownership', async () => {
  const f = fixture(); await f.protect(['text']);
  const anonymous = { ...scope, accountUid: undefined, sessionId: 'fixture-visitor-a' };
  const { token } = await f.access.unlock(anonymous, code, ['text']);
  await f.access.check(anonymous, ['text'], token);
  await assert.rejects(f.access.check({ ...anonymous, accountUid: 'owner-a' }, ['text'], token), status(403));
  // The server authorizer retains ownership/privacy authority independently of a code.
  await assert.rejects(f.access.unlock({ ...anonymous, waveformId: 'foreign-waveform' }, code, ['knowledge']), status(403));
});

test('concurrent wrong attempts are bounded before expensive verification; fresh instances share the bound', async () => {
  const f = fixture(); await f.protect(['text']);
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => f.access.unlock(scope, 'synthetic-wrong-code', ['text'])));
  assert.equal(attempts.filter(result => result.status === 'rejected' && result.reason.status === 403).length, 5);
  assert.equal(attempts.filter(result => result.status === 'rejected' && result.reason.status === 429).length, 3);
  await assert.rejects(f.access.unlock(scope, code, ['text']), status(429));
  f.advance(60_000);
  assert.ok((await f.access.unlock(scope, code, ['text'])).token);
});

test('new sessions cannot bypass the waveform-wide attempt ceiling', async () => {
  const f = fixture(); await f.protect(['text']);
  for (let i = 0; i < 20; i++) await assert.rejects(f.access.unlock({ ...scope, sessionId: `fixture-session-${i}` }, 'synthetic-wrong-code', ['text']), status(403));
  await assert.rejects(f.access.unlock({ ...scope, sessionId: 'fresh-session' }, code, ['text']), status(429));
});

test('expiry is checked from shared storage on reload, with no client unlock flag', async () => {
  const f = fixture(); await f.protect(['text']);
  const { token, expiresAt } = await f.access.unlock(scope, code, ['text']);
  assert.equal(expiresAt, 1_000_000 + 30 * 60_000);
  await f.access.check(scope, ['text'], token);
  f.advance(30 * 60_000);
  await assert.rejects(f.access.check(scope, ['text'], token), status(403));
});

test('code changes and subset changes revoke old grants; turning off retains legacy behavior', async () => {
  const f = fixture(); let saved = await f.protect(['text', 'visual']);
  let unlocked = await f.access.unlock(scope, code, ['text']);
  saved = await f.access.configure(scope, { revision: saved.revision, protectedPlugins: ['text', 'visual'], code: 'synthetic-new-code' });
  await assert.rejects(f.access.check(scope, ['text'], unlocked.token), status(403));
  await assert.rejects(f.access.unlock(scope, code, ['text']), status(403));
  unlocked = await f.access.unlock(scope, 'synthetic-new-code', ['text']);
  saved = await f.access.configure(scope, { revision: saved.revision, protectedPlugins: ['text'] });
  await assert.rejects(f.access.check(scope, ['text'], unlocked.token), status(403));
  await f.access.check(scope, ['visual']);
  saved = await f.access.configure(scope, { revision: saved.revision, protectedPlugins: [] });
  assert.equal(saved.codeConfigured, false);
  await f.access.check(scope, ['text']);
  await assert.rejects(f.access.configure(scope, { revision: saved.revision, protectedPlugins: ['text'] }), status(400));
});

test('revoked sessions and new safety refusals withhold in-flight results', async () => {
  for (const change of ['identity', 'safety', 'expiry'] as const) {
    const f = fixture(); await f.protect(['knowledge']);
    const { token } = await f.access.unlock(scope, code, ['knowledge']);
    await assert.rejects(f.access.read(scope, ['knowledge'], token, async () => {
      if (change === 'identity') f.revoked.add(scope.sessionId);
      if (change === 'safety') f.safety(false);
      if (change === 'expiry') f.advance(30 * 60_000);
      return 'must not escape';
    }), status(403));
  }
});

test('a policy edit during an in-flight read withholds the stale result, even when protection is disabled', async () => {
  const f = fixture(); const saved = await f.protect(['visual']);
  const { token } = await f.access.unlock(scope, code, ['visual']);
  await assert.rejects(f.access.read(scope, ['visual'], token, async () => {
    await f.access.configure(scope, { revision: saved.revision, protectedPlugins: [] });
    return 'old protected picture';
  }), status(409));
});

test('policy edits cannot cross open or uncertain voice calls, and stale settings cannot overwrite newer policy', async () => {
  const f = fixture(); const saved = await f.protect(['text']);
  f.voice(true);
  await assert.rejects(f.access.configure(scope, { revision: saved.revision, protectedPlugins: [] }), status(409));
  assert.equal((await f.access.settings(scope)).revision, saved.revision);
  f.voice(false);
  await f.access.configure(scope, { revision: saved.revision, protectedPlugins: [], code });
  await assert.rejects(f.access.configure(scope, { revision: saved.revision, protectedPlugins: [] }), status(409));
});

test('input bounds, unknown plugins and malformed saved policies fail closed', async () => {
  const f = fixture();
  for (const invalid of ['', 'short', 'a'.repeat(129), 'valid-code\n']) {
    await assert.rejects(f.access.configure(scope, { revision: 'off', protectedPlugins: ['text'], code: invalid }), status(400));
  }
  await assert.rejects(f.access.configure(scope, { revision: 'off', protectedPlugins: ['bogus' as ProtectedPlugin], code }), status(400));
  await assert.rejects(f.access.check(scope, ['text', 'text']), status(400));
  await f.protect(['text']);
  const key = [...f.db.rows.keys()].find(key => key.startsWith('pluginAccessPolicies/'))!;
  f.db.rows.set(key, { ...f.db.rows.get(key), plugins: [] });
  await assert.rejects(f.access.check(scope, []), status(503));
});

test('aborted reads withhold results without performing another operation', async () => {
  const f = fixture(); const controller = new AbortController();
  await assert.rejects(f.access.read(scope, [], undefined, async () => { controller.abort(); return 'late'; }, controller.signal), { name: 'AbortError' });
  let called = false;
  await assert.rejects(f.access.read(scope, [], undefined, async () => { called = true; }, controller.signal), { name: 'AbortError' });
  assert.equal(called, false);
});

test('locked plugin data and tools are absent from initial voice and delegation context; unlocks remain independent', async () => {
  const waveform = { name: 'Synthetic voice', initialPrompt: 'Fixture persona', textPanel: { type: 'text' as const, version: 1 as const, text: 'protected legacy text' },
    knowledge: true, visualDisplay: await visualFixture() };
  const locked = projectPluginPrompt(waveform, []);
  const config = voiceSessionConfig(locked);
  assert.equal(JSON.stringify(config).includes('Town map'), false);
  assert.equal(JSON.stringify(locked).includes('protected legacy text'), false);
  assert.deepEqual(config.delegation.responses.tools, []);
  const knowledgeOnly = voiceSessionConfig(projectPluginPrompt(waveform, ['knowledge']));
  assert.deepEqual(knowledgeOnly.delegation.responses.tools.map(tool => tool.name), ['search_waveform_knowledge']);
  assert.equal(JSON.stringify(knowledgeOnly).includes('Town map'), false);
  const visualOnly = voiceSessionConfig(projectPluginPrompt(waveform, ['visual']));
  assert.deepEqual(visualOnly.delegation.responses.tools.map(tool => tool.name), ['update_visual_display']);
  assert.equal(JSON.stringify(visualOnly).includes('Town map'), true);
  assert.equal(voiceSessionConfig(waveform).delegation.responses.tools.length, 2);
});

test('the access core permits an explicit unlock while voice remains active; only policy edits are held', async () => {
  const f = fixture(); const saved = await f.protect(['visual']); f.voice(true);
  const { token } = await f.access.unlock(scope, code, ['visual']);
  assert.equal(await f.access.read(scope, ['visual'], token, async () => 'synthetic picture'), 'synthetic picture');
  await assert.rejects(f.access.configure(scope, { revision: saved.revision, protectedPlugins: [] }), status(409));
});

test('a fresh server instance uses the same persisted grants and attempts', async () => {
  const f = fixture(); await f.protect(['text']);
  const { token } = await f.access.unlock(scope, code, ['text']);
  const second = createPluginAccess(f.db, { now: () => 1_000_000, authorize: async () => {}, assertPolicyMutable: async () => {} });
  await second.check(scope, ['text'], token);
  for (let i = 0; i < 4; i++) await assert.rejects(second.unlock(scope, 'synthetic-wrong-code', ['text']), status(403));
  await assert.rejects(f.access.unlock(scope, code, ['text']), status(429));
});

test('a voice call appearing during password hashing prevents committing the policy', async () => {
  const db = new PaidMemoryDatabase(); let mutableChecks = 0;
  const access = createPluginAccess(db, { authorize: async () => {}, assertPolicyMutable: async () => {
    if (++mutableChecks === 2) throw new PluginAccessError('A conversation started.', 409);
  } });
  await assert.rejects(access.configure(scope, { revision: 'off', protectedPlugins: ['visual'], code }), status(409));
  assert.equal(mutableChecks, 2); assert.equal(db.rows.size, 0);
});

test('simultaneous policy saves cannot silently overwrite one another', async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.access.configure(scope, { revision: 'off', protectedPlugins: ['text'], code }),
    f.access.configure(scope, { revision: 'off', protectedPlugins: ['visual'], code }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
});

test('unlocking a second plugin retains only current previously granted plugins for the same session', async () => {
  const f = fixture();
  await f.protect();
  const first = await f.access.unlock(scope, code, ['text']);
  const second = await f.access.unlock(scope, code, ['visual'], first.token);
  assert.deepEqual((await f.access.playback(scope, second.token)).locked, ['knowledge']);
  const other = { ...scope, sessionId: 'fixture-other-session' };
  const unrelated = await f.access.unlock(other, code, ['knowledge'], second.token);
  assert.deepEqual((await f.access.playback(other, unrelated.token)).locked, ['text', 'visual']);
});

test('locked sessions reserve tool event subscriptions without sending tools or protected catalogues', async () => {
  const waveform = { name: 'Synthetic voice', initialPrompt: 'Synthetic persona', visualDisplay: await visualFixture() };
  const projected = projectPluginPrompt(waveform, []);
  const config = voiceSessionConfig(projected, false, false, true);
  assert.deepEqual(config.delegation.responses.tools, []);
  assert.equal(JSON.stringify(config).includes('Town map'), false);
  assert.ok(config.client.data_channel.allowed_client_events.includes('response.item.create'));
  assert.ok(config.client.data_channel.allowed_server_events.some(event => event.type === 'response.event'));
  assert.ok(config.client.data_channel.allowed_server_events.some(event => event.type === 'session.input_transcript.delta'));
});
