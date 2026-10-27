import assert from 'node:assert/strict';
import test from 'node:test';
import { createCuratedDemo } from '../lib/curated-demo';
import { FRANKLIN_DEMO_ID, PUBLIC_VOICE_COOKIE, publicVoiceOwner } from '../lib/public-voice-identity';
import { creationContentDigest, CreationSafetyError } from '../lib/creation-safety';
import { PaidMemoryDatabase } from './paid-fixture';
import type { Waveform } from '../lib/account-model';

function fixture() {
  const db = new PaidMemoryDatabase(); let revoked = false;
  const waveform: Waveform = { id: FRANKLIN_DEMO_ID, name: 'Benjamin Franklin', initialPrompt: 'Private approved instructions', voice: 'marin', accentColor: '#3a66ff', profilePhoto: null, updatedAt: new Date(0).toISOString() };
  db.rows.set('ownerWaveforms/founder', waveform); db.rows.set('waveformMembers/founder', { state: 'active' });
  const demo = createCuratedDemo(db, { now: () => 1000, findOwner: async () => 'founder', requireAllowed: async (_tx, uid, candidate) => {
    assert.equal(uid, 'founder'); if (revoked || creationContentDigest(candidate) !== creationContentDigest(waveform)) throw new CreationSafetyError('Approval missing or revoked');
  } });
  const visitor = publicVoiceOwner(new Request('https://voice.example/api/session', { headers: { cookie: `${PUBLIC_VOICE_COOKIE}=${'a'.repeat(64)}` } }), FRANKLIN_DEMO_ID)!;
  const owner = { ...visitor, contentDigest: creationContentDigest(waveform), demoSource: { ownerUid: 'founder' } };
  return { db, demo, waveform, owner, revoke: () => { revoked = true; } };
}
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
