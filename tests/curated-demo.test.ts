import assert from 'node:assert/strict';
import test from 'node:test';
import { createCuratedDemo, curatedVisitorDisplay, curatedVisitorVoice } from '../lib/curated-demo';
import { FRANKLIN_DEMO_ID, PUBLIC_VOICE_COOKIE, publicVoiceOwner } from '../lib/public-voice-identity';
import { creationContentDigest, CreationSafetyError } from '../lib/creation-safety';
import { PaidMemoryDatabase } from './paid-fixture';
import type { Waveform } from '../lib/account-model';

function fixture(visualDisplay?: Waveform['visualDisplay']) {
  const db = new PaidMemoryDatabase(); let revoked = false, lookups = 0, followUps = 0;
  const waveform: Waveform = { id: FRANKLIN_DEMO_ID, name: 'Benjamin Franklin', initialPrompt: 'Private approved instructions', voice: 'marin', accentColor: '#3a66ff', profilePhoto: null, updatedAt: new Date(0).toISOString(), ...(visualDisplay ? { visualDisplay } : {}) };
  db.rows.set('ownerWaveforms/founder', waveform); db.rows.set('waveformMembers/founder', { state: 'active' });
  const demo = createCuratedDemo(db, { now: () => 1000, findOwner: async () => { lookups++; return 'founder'; },
    followUp: async () => { followUps++; }, requireAllowed: async (_tx, uid, candidate) => {
    assert.equal(uid, 'founder'); if (revoked || creationContentDigest(candidate) !== creationContentDigest(waveform)) throw new CreationSafetyError('Approval missing or revoked');
  } });
  const visitor = publicVoiceOwner(new Request('https://voice.example/api/session', { headers: { cookie: `${PUBLIC_VOICE_COOKIE}=${'a'.repeat(64)}` } }), FRANKLIN_DEMO_ID)!;
  const owner = { ...visitor, contentDigest: creationContentDigest(waveform), demoSource: { ownerUid: 'founder' } };
  return { db, demo, waveform, owner, lookups: () => lookups, followUps: () => followUps, revoke: () => { revoked = true; } };
}
test('read-only preparation never bootstraps or enqueues, and rechecks snapshot authority', async () => {
  const f = fixture();
  const before = structuredClone(f.db.rows);
  assert.equal(await f.demo.published(true), null);
  assert.equal(f.lookups(), 0);
  assert.equal(f.followUps(), 0);
  assert.deepEqual(f.db.rows, before);
  const snapshot = await f.demo.published();
  assert.ok(snapshot);
  assert.equal(f.lookups(), 1);
  assert.equal(f.followUps(), 1);
  const published = structuredClone(f.db.rows);
  assert.deepEqual(await f.demo.published(true), snapshot);
  assert.equal(f.lookups(), 1);
  assert.equal(f.followUps(), 1);
  assert.deepEqual(f.db.rows, published);
  f.revoke();
  await assert.rejects(f.demo.published(true), /revoked/);
  f.db.rows.set('waveformMembers/founder', { state: 'revoked' });
  await assert.rejects(f.demo.published(true), /unavailable/);
  assert.equal(f.followUps(), 1);
});
test('one explicitly approved snapshot stays public when private drafts change; arbitrary waveforms never acquire visitor identity', async () => {
  const f = fixture(); const [a, b] = await Promise.all([f.demo.published(), f.demo.published()]);
  assert.deepEqual(a, b);
  f.db.rows.set('ownerWaveforms/founder', { ...f.waveform, initialPrompt: 'Later private edit' });
  assert.equal((await f.demo.published())?.waveform.initialPrompt, f.waveform.initialPrompt);
  await f.db.transaction(tx => f.demo.requireVoice(tx, f.owner));
  await assert.rejects(f.db.transaction(tx => f.demo.requireVoice(tx, { ...f.owner, contentDigest: 'forged' })), /changed/);
  assert.equal(publicVoiceOwner(new Request('https://voice.example'), 'private-waveform'), null);
});
test('revocation and membership removal fail closed for admission; existing cleanup keeps its snapshot', async () => {
  const f = fixture(); await f.demo.published(); f.revoke();
  await assert.rejects(f.demo.published(), /revoked/);
  await assert.rejects(f.db.transaction(tx => f.demo.requireVoice(tx, f.owner)), /revoked/);
  assert.equal((await f.demo.cleanupSnapshot())?.waveform.id, FRANKLIN_DEMO_ID);
  const g = fixture(); g.db.rows.set('waveformMembers/founder', { state: 'revoked' });
  await assert.rejects(g.demo.published(), /unavailable/);
  assert.equal(g.db.rows.has(`publicDemoWaveforms/${FRANKLIN_DEMO_ID}`), false);
});


test('curated snapshot containing Visual never exposes its images/catalogue/tool to visitors; private owner remains enabled', async () => {
  const { visualFixture } = await import('./visual-display-fixture');
  const { voiceSessionConfig } = await import('../lib/voice-config');
  const visualDisplay = await visualFixture(), f = fixture(visualDisplay);
  const row = (await f.demo.published())!;
  const dto = curatedVisitorDisplay(row.waveform), voice = curatedVisitorVoice(row.waveform);
  assert.equal('visualDisplay' in dto, false); assert.equal(JSON.stringify(dto).includes(visualDisplay.images[0].src), false);
  assert.equal(voice.visualDisplay, null);
  const visitor = voiceSessionConfig(voice);
  assert.equal(visitor.delegation.responses.tools.some(t => t.name === 'update_visual_display'), false);
  assert.equal(JSON.stringify(visitor).includes(visualDisplay.images[0].title), false);
  assert.equal(voiceSessionConfig(f.waveform).delegation.responses.tools.some(t => t.name === 'update_visual_display'), true);
  assert.deepEqual(row.waveform.visualDisplay, visualDisplay);
  assert.equal(row.contentDigest, creationContentDigest(f.waveform));
  await f.db.transaction(tx => f.demo.requireVoice(tx, f.owner));
  f.revoke(); await assert.rejects(f.demo.published(), /revoked/);
});
