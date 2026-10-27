import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePublishedPreview, requirePublishedPreview } from '../lib/published-preview';
import { creationContentDigest } from '../lib/creation-safety';
import { paidFixture } from './paid-fixture';

test('unmetered founder published preview resolves the frozen snapshot, not newer private content or Knowledge', async () => {
  const f = paidFixture(); await f.credit(); await f.publish();
  await f.store.saveWaveform(f.owner, { ...f.wave, name: 'Private new draft' });
  let testing = true;
  const options = { resolveAdmin: async () => ({ uid: f.owner.uid!, accountSessionId: 'fixture', testing, isCurrent: () => true }),
    approvedPublication: f.store.approvedPublication };
  const view = await resolvePublishedPreview(new Request('http://localhost/'), f.wave.id, options);
  assert.equal(view!.waveform.name, f.wave.name);
  assert.equal(view!.waveform.knowledge, false);
  const owner = { ownerUid: f.owner.uid!, waveformId: f.wave.id, accountSessionId: 'fixture',
    publishedRevision: view!.publishedRevision, contentDigest: creationContentDigest(view!.waveform),
    admin: { uid: f.owner.uid!, accountSessionId: 'fixture', override: true, deadline: f.now() + 1000 } };
  let proofs = 0;
  const proof = async () => { proofs++; };
  await f.db.transaction(tx => requirePublishedPreview(tx, owner, proof, creationContentDigest));
  assert.equal(proofs, 1);
  await assert.rejects(f.db.transaction(tx => requirePublishedPreview(tx, { ...owner, ownerUid: 'foreign-owner' }, proof, creationContentDigest)));
  testing = false;
  assert.equal(await view!.isCurrent(), false);
  assert.equal(await resolvePublishedPreview(new Request('http://localhost/'), f.wave.id, options), null);
  await f.store.publish(f.owner, { ...f.wave, name: 'New published version' }, (await f.store.publication(f.wave.id))!.settings, true);
  await assert.rejects(f.db.transaction(tx => requirePublishedPreview(tx, owner, proof, creationContentDigest)));
});
