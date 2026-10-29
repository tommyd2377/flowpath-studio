import assert from 'node:assert/strict';
import test from 'node:test';
import { createCreationReviewStore, type CreationActor, type CreationReviewOptions, type CreationReviewProof } from '../lib/creation-review';
import {
  canonicalCreationCandidate, CREATION_SAFETY_CATEGORIES, CreationSafetyError, creationContentDigest,
  creationPolicyDigest, evaluateCreationReview, type CreationCandidate, type CreationReviewerResult, type CreationSafetyPolicy,
} from '../lib/creation-safety';
import { createFixtureCreationReviewer } from '../lib/creation-safety-fixtures';
import { CONSERVATIVE_CREATION_POLICY } from '../lib/creation-policy';
import type { VoiceDatabase, VoiceTransaction } from '../lib/production-voice-store';

class MemoryDatabase implements VoiceDatabase {
  rows = new Map<string, Record<string, unknown>>();
  private pending = Promise.resolve();
  async transaction<T>(work: (tx: VoiceTransaction) => Promise<T>): Promise<T> {
    const previous = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const next = new Map(structuredClone([...this.rows]));
    let writing = false;
    try {
      const result = await work({
        get: async path => { assert.equal(writing, false, 'Firestore requires all reads before writes'); return structuredClone(next.get(path) ?? null); },
        set: (path, value) => { writing = true; next.set(path, structuredClone(value) as Record<string, unknown>); },
      });
      this.rows = next;
      return result;
    } finally { release(); }
  }
}
const owner: CreationActor = { uid: 'owner-a', accountSessionId: 'owner-a-session' };
const other: CreationActor = { uid: 'owner-b', accountSessionId: 'owner-b-session' };
const admin: CreationActor = { uid: 'admin', accountSessionId: 'admin-session' };
const candidate: CreationCandidate = { name: 'Example', initialPrompt: 'A synthetic test persona.' };
const policy = (): CreationSafetyPolicy => ({ version: 'fixture-v1', categories: {
  ...Object.fromEntries(CREATION_SAFETY_CATEGORIES.map(key => [key, 'block'])) as CreationSafetyPolicy['categories'],
  'extremist-impersonation': 'block', 'violent-extremism': 'block', 'sexual-content-minors': 'block',
  'hateful-abuse': 'manual-review', 'credible-harm': 'block', 'fraud-impersonation': 'manual-review', 'privacy-abuse': 'manual-review',
} });
const evidence = (changes: Partial<CreationReviewerResult['findings']> = {}): CreationReviewerResult => ({ findings: {
  ...Object.fromEntries(CREATION_SAFETY_CATEGORIES.map(key => [key, 'clear'])), ...changes,
} as CreationReviewerResult['findings'] });
const reviewer = (review: NonNullable<CreationReviewOptions['reviewer']>['review'] = async () => evidence()) =>
  createFixtureCreationReviewer({ nodeEnv: 'development', enabled: true }, review);
function setup(overrides: Partial<CreationReviewOptions> = {}) {
  const db = new MemoryDatabase();
  let selected: CreationSafetyPolicy | null = policy();
  db.rows.set('sessions/owner-a-session', { uid: owner.uid, active: true });
  db.rows.set('sessions/owner-b-session', { uid: other.uid, active: true });
  db.rows.set('sessions/admin-session', { uid: admin.uid, active: true, creationReviewAdmin: true });
  const verifyOwner: CreationReviewOptions['verifyOwner'] = async (tx, actor) => {
    const session = await tx.get(`sessions/${actor.accountSessionId}`);
    if (!session?.active || session.uid !== actor.uid) throw new CreationSafetyError('Invalid owner.', 403);
  };
  const verifyAdmin: CreationReviewOptions['verifyAdmin'] = async (tx, actor) => {
    await verifyOwner(tx, actor);
    if (!(await tx.get(`sessions/${actor.accountSessionId}`))?.creationReviewAdmin) throw new CreationSafetyError('Admin required.', 403);
  };
  const options: CreationReviewOptions = { mode: 'fixture', policy: () => selected, verifyOwner, verifyAdmin,
    reviewer: reviewer(), now: () => 1000, ...overrides };
  return { db, store: createCreationReviewStore(db, options), options,
    setPolicy: (next: CreationSafetyPolicy | null) => { selected = next; } };
}
const denied = (status = 409) => (error: unknown) => error instanceof CreationSafetyError && error.status === status;
const allowed = async (s: ReturnType<typeof setup>, input = candidate) => {
  const requested = await s.store.request(owner, input);
  return s.store.runReview(requested.record);
};

test('queue validation failures do not silently discard active reviews', async () => {
  let unavailable = false;
  const s = setup({ validateCandidate: async () => { if (unavailable) throw new Error('Database unavailable'); } });
  const requested = await s.store.request(owner, candidate);
  unavailable = true;
  await assert.rejects(s.store.listManual(admin), /Database unavailable/);
  unavailable = false;
  assert.deepEqual((await s.store.listManual(admin)).map(row => row.reviewId), [requested.record.reviewId]);
});

test('automatic blocks remain inspectable by the founder without granting approval or use', async () => {
  const s = setup({ policy: () => CONSERVATIVE_CREATION_POLICY,
    reviewer: reviewer(async () => evidence({ 'fraud-impersonation': 'violation', 'portrait-provenance': 'uncertain' })) });
  const reviewed = await allowed(s);
  assert.equal(reviewed.status, 'blocked');
  assert.deepEqual((await s.store.listManual(admin)).map(row => row.reviewId), [reviewed.reviewId]);
  assert.deepEqual((await s.store.getForAdmin(admin, reviewed.reviewId)).categories, ['fraud-impersonation', 'portrait-provenance']);
  await assert.rejects(s.store.listManual(owner), denied(403));
  await assert.rejects(s.store.getForAdmin(owner, reviewed.reviewId), denied(403));
  await assert.rejects(s.store.decide(admin, { ...reviewed, decision: 'allowed' }), denied());
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate)), denied());
  const next = await s.store.request(owner, { ...candidate, initialPrompt: 'Changed instructions.' });
  assert.deepEqual((await s.store.listManual(admin)).map(row => row.reviewId), [next.record.reviewId]);
  await assert.rejects(s.store.getForAdmin(admin, reviewed.reviewId), denied());
});

test('requesting an older automatic block restores its queue entry once without another reviewer call', async () => {
  let calls = 0;
  const s = setup({ reviewer: reviewer(async () => { calls++; return evidence({ 'extremist-impersonation': 'violation' }); }) });
  const reviewed = await allowed(s);
  s.db.rows.set('creationSafetyQueue/manual', { reviewIds: [] });
  for (let attempt = 0; attempt < 2; attempt++) {
    const requested = await s.store.request(owner, candidate);
    assert.equal(requested.needsReview, false);
    assert.equal(requested.record.status, 'blocked');
    assert.equal(requested.record.reviewId, reviewed.reviewId);
    assert.deepEqual((await s.store.listManual(admin)).map(row => row.reviewId), [reviewed.reviewId]);
  }
  assert.equal(calls, 1);
});

test('only completed low-risk findings allow immediate use; serious uncertainty and missing coverage stay held', () => {
  for (const category of CREATION_SAFETY_CATEGORIES) {
    const lowRisk = category === 'portrait-provenance' || category === 'controversial-identity';
    assert.equal(evaluateCreationReview(evidence({ [category]: 'uncertain' }), CONSERVATIVE_CREATION_POLICY).status, lowRisk ? 'allowed' : 'manual-review');
    assert.equal(evaluateCreationReview(evidence({ [category]: 'violation' }), CONSERVATIVE_CREATION_POLICY).status, lowRisk ? 'allowed' : 'blocked');
    if (!lowRisk) assert.throws(() => creationPolicyDigest({ ...CONSERVATIVE_CREATION_POLICY,
      categories: { ...CONSERVATIVE_CREATION_POLICY.categories, [category]: 'allow-and-review' } }), denied(503));
  }
  assert.equal(evaluateCreationReview(evidence({ 'portrait-provenance': 'uncertain', 'living-person': 'uncertain' }), CONSERVATIVE_CREATION_POLICY).status, 'manual-review');
  assert.equal(evaluateCreationReview({ findings: {} }, CONSERVATIVE_CREATION_POLICY).status, 'manual-review');
});

test('queued low-risk approval is usable immediately and revocation invalidates current and published proof without replaying AI', async () => {
  let calls = 0;
  const s = setup({ policy: () => CONSERVATIVE_CREATION_POLICY,
    reviewer: reviewer(async () => { calls++; return evidence({ 'portrait-provenance': 'uncertain' }); }) });
  const reviewed = await allowed(s, { ...candidate, name: 'Benjamin Franklin' });
  assert.equal(reviewed.status, 'allowed');
  assert.equal((await s.store.listManual(admin))[0].reviewId, reviewed.reviewId);
  await s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, reviewed.candidate));
  await s.db.transaction(tx => s.store.requireSnapshotAllowed(tx, owner.uid, reviewed.candidate));
  const revoke = { ...reviewed, decision: 'revoked' as const };
  await assert.rejects(s.store.decide(other, revoke), denied(403));
  await assert.rejects(s.store.decide(admin, { ...revoke, digest: '0'.repeat(64) }), denied());
  const revoked = await s.store.decide(admin, revoke);
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.decision?.actorUid, admin.uid);
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, reviewed.candidate)), denied());
  await assert.rejects(s.db.transaction(tx => s.store.requireSnapshotAllowed(tx, owner.uid, reviewed.candidate)), denied());
  const duplicate = await s.store.request(owner, reviewed.candidate);
  assert.equal(duplicate.needsReview, false); assert.equal(duplicate.record.status, 'revoked'); assert.equal(calls, 1);
  await allowed(s, { ...candidate, initialPrompt: 'A different safe version.' });
  await assert.rejects(s.store.request(owner, reviewed.candidate), /no longer valid/);
  assert.equal(calls, 2, 'editing away and back cannot re-review a revoked version');
});

test('a changed draft cannot hide a queued published approval from revocation', async () => {
  const s = setup({ policy: () => CONSERVATIVE_CREATION_POLICY,
    reviewer: reviewer(async () => evidence({ 'controversial-identity': 'uncertain' })) });
  const first = await allowed(s), next = { ...candidate, initialPrompt: 'A changed safe draft.' };
  await allowed(s, next);
  await s.db.transaction(tx => s.store.requireSnapshotAllowed(tx, owner.uid, candidate));
  assert.equal((await s.store.listManual(admin)).length, 2);
  await s.store.decide(admin, { ...first, decision: 'revoked' });
  await assert.rejects(s.db.transaction(tx => s.store.requireSnapshotAllowed(tx, owner.uid, candidate)), denied());
  await s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, next));
});

test('discarding an unsafe draft restores only an identical completed approval without another reviewer call', async () => {
  let calls = 0;
  const s = setup({ reviewer: reviewer(async value => { calls++; return evidence(value.initialPrompt === candidate.initialPrompt ? {} : { 'self-harm': 'violation' }); }) });
  const original = await allowed(s);
  const unsafe = { ...candidate, initialPrompt: 'Synthetic prohibited draft.' };
  assert.equal((await allowed(s, unsafe)).status, 'blocked');
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate)), denied());
  const restored = await s.store.request(owner, candidate);
  assert.equal(restored.needsReview, false); assert.equal(restored.record.reviewId, original.reviewId);
  await s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate));
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, unsafe)), denied());
  assert.equal(calls, 2);
  assert.equal((await s.store.request(owner, { ...candidate, initialPrompt: 'A material edit.' })).needsReview, true);
});

test('historical approval reuse cannot cross owners, policy changes or revoked records', async () => {
  const s = setup(); const original = await allowed(s);
  await s.store.request(owner, { ...candidate, name: 'New draft' });
  assert.equal((await s.store.request(other, candidate)).needsReview, true);
  s.setPolicy({ ...policy(), version: 'changed-policy' });
  assert.equal((await s.store.request(owner, candidate)).needsReview, true);
  s.setPolicy(policy());
  s.db.rows.set(`creationSafetyReviews/${original.reviewId}`, { ...original, status: 'blocked' });
  await assert.rejects(s.store.request(owner, candidate), denied());
});

test('portrait edits invalidate approval and document heads cannot replace waveform authority', async () => {
  const s = setup(); await allowed(s);
  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, { ...candidate, profilePhoto: photo })), denied());
  const doc = { ...candidate, document: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', digest: 'a'.repeat(64), filename: 'reference.txt' } };
  await allowed(s, doc);
  assert.equal((await s.store.get(owner))?.candidate.document, undefined);
  assert.equal((await s.store.get(owner, doc.document.id))?.status, 'allowed');
  await s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate));
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, { ...doc, document: { ...doc.document, digest: 'b'.repeat(64) } })), denied());
});

test('removed document cannot complete, receive a founder decision or reuse approval', async () => {
  let present = true;
  const s = setup({ validateCandidate: async (_tx, _uid, value) => { if (value.document && !present) throw new CreationSafetyError('Removed'); },
    reviewer: reviewer(async () => evidence({ 'incomplete-coverage': 'uncertain' })) });
  const doc = { ...candidate, document: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', digest: 'a'.repeat(64), filename: 'reference.docx' } };
  const record = await allowed(s, doc); assert.equal(record.status, 'manual-review');
  present = false;
  await assert.rejects(s.store.decide(admin, { ...record, decision: 'allowed' }), denied());
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, doc)), denied());
});

test('a confirmed death under five years blocks use and cannot be overridden through the founder queue', async () => {
  const s = setup({ reviewer: reviewer(async () => evidence({ 'recently-deceased-person': 'violation' })) });
  const record = await allowed(s);
  assert.equal(record.status, 'blocked');
  await assert.rejects(s.store.decide(admin, { ...record, decision: 'allowed' }), denied());
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate)), denied());
});

test('abandoned pending work enters the founder queue without retrying the model', async () => {
  let time = 1000; const s = setup({ now: () => time });
  await s.store.request(owner, candidate); time += 120001;
  const queue = await s.store.listManual(admin);
  assert.equal(queue[0].status, 'manual-review'); assert.equal(queue[0].issue, 'abandoned');
});

test('a policy change removes obsolete queue actions while retaining exact-version decision enforcement', async () => {
  let calls = 0;
  const s = setup({ reviewer: reviewer(async () => { calls++; return evidence({ 'privacy-abuse': 'uncertain' }); }) });
  const old = await allowed(s); assert.equal(old.status, 'manual-review');
  assert.equal((await s.store.listManual(admin)).length, 1);
  s.setPolicy({ ...policy(), version: 'updated-policy' });
  assert.equal((await s.store.listManual(admin)).length, 0);
  await assert.rejects(s.store.decide(admin, { ...old, decision: 'allowed' }), denied());
  assert.equal(calls, 1, 'queue refresh never replays a paid review');
  assert.equal((await s.store.request(owner, candidate)).needsReview, true);
});

test('canonical name/prompt match saved trim rules; text is exact, bounded and never clipped', () => {
  const canonical = canonicalCreationCandidate({ ...candidate, name: '  Example ', initialPrompt: ' A synthetic test persona.\n',
    textPanel: { type: 'text', version: 1, text: '  <script>escaped by renderer</script>\n' }, allowed: true });
  assert.equal(canonical.name, candidate.name);
  assert.equal(canonical.initialPrompt, candidate.initialPrompt);
  assert.equal(canonical.textPanel?.text, '  <script>escaped by renderer</script>\n');
  assert.equal(creationContentDigest(candidate), creationContentDigest({ ...candidate, name: ' Example ' }));
  assert.notEqual(creationContentDigest(candidate), creationContentDigest({ ...candidate, textPanel: { type: 'text', version: 1, text: '' } }));
  for (const input of [
    { ...candidate, name: 'a'.repeat(81) }, { ...candidate, initialPrompt: 'a'.repeat(15001) },
    { ...candidate, name: 'bad\nname' }, { ...candidate, initialPrompt: '\u0000' },
    { ...candidate, textPanel: { type: 'text', version: 1, text: 'a'.repeat(4001) } },
    { ...candidate, textPanel: { type: 'html', version: 1, text: 'x' } },
    { ...candidate, textPanel: { type: 'text', version: 1, text: 'x', html: true } },
  ]) assert.throws(() => canonicalCreationCandidate(input), denied(400));
});

test('policy explicitly covers every category and always blocks extremist impersonation', () => {
  const original = policy(), changed = policy();
  changed.categories['privacy-abuse'] = 'block';
  assert.notEqual(creationPolicyDigest(original), creationPolicyDigest(changed));
  assert.throws(() => creationPolicyDigest({ ...original, categories: { ...original.categories, 'extremist-impersonation': 'manual-review' } }), denied(503));
  assert.throws(() => creationPolicyDigest({ ...original, categories: {} as CreationSafetyPolicy['categories'] }), denied(503));
  assert.equal(evaluateCreationReview(evidence({ 'extremist-impersonation': 'violation' }), original).status, 'blocked');
  assert.equal(evaluateCreationReview(evidence({ 'privacy-abuse': 'violation' }), original).status, 'manual-review');
  assert.equal(evaluateCreationReview(evidence({ 'credible-harm': 'uncertain' }), original).status, 'manual-review');
  assert.equal(evaluateCreationReview({ findings: {} }, original).status, 'manual-review');
});

test('identical requests and Create reuse one allowed server review without another reviewer call', async () => {
  let calls = 0;
  const s = setup({ reviewer: reviewer(async () => { calls++; return evidence(); }) });
  const first = await s.store.request(owner, candidate);
  assert.equal(first.record.status, 'pending');
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate)), denied());
  const duplicate = await s.store.request(owner, candidate);
  assert.equal(duplicate.needsReview, false);
  assert.equal(duplicate.record.reviewId, first.record.reviewId);
  const completed = await s.store.runReview(first.record);
  assert.equal(completed.status, 'allowed');
  await s.store.runReview(first.record);
  const create = await s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate, completed));
  assert.equal(create.reviewId, completed.reviewId);
  assert.equal((await s.store.request(owner, candidate)).needsReview, false);
  assert.equal(calls, 1);
  assert.equal((await s.store.listManual(admin)).length, 0);
});

test('material name, instruction and text edits stale an approval; client status or adminTesting cannot bypass it', async () => {
  const s = setup();
  const approved = await allowed(s);
  for (const edit of [
    { ...candidate, name: 'Changed' }, { ...candidate, initialPrompt: 'Changed' },
    { ...candidate, textPanel: { type: 'text' as const, version: 1 as const, text: 'New material text' } },
    { ...candidate, name: 'Changed', status: 'allowed', adminTesting: true },
  ]) await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, edit, approved)), denied());
  const withText = { ...candidate, textPanel: { type: 'text' as const, version: 1 as const, text: 'Original' } };
  await allowed(s, withText);
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid,
    { ...withText, textPanel: { ...withText.textPanel, text: 'Original ' } })), denied());
});

test('policy version and same-version category changes stale an approval; no policy fails closed', async () => {
  const s = setup();
  await allowed(s);
  s.setPolicy({ ...policy(), version: 'fixture-v2' });
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate)), denied());
  await allowed(s);
  const changed = { ...policy(), version: 'fixture-v2' };
  changed.categories['privacy-abuse'] = 'block';
  s.setPolicy(changed);
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate)), denied());
  s.setPolicy(null);
  await assert.rejects(s.store.request(owner, candidate), denied(503));
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate)), denied(503));
});

test('missing reviewer, rejected provider and production fixture injection fail closed without retries', async () => {
  for (const options of [
    { reviewer: null },
    { reviewer: reviewer(async () => { throw new Error('Synthetic reviewer outage'); }) },
    { mode: 'production' as const, reviewer: reviewer(async () => { assert.fail('Production invoked a fake reviewer'); }) },
  ]) {
    const s = setup(options), pending = await s.store.request(owner, candidate);
    const reviewed = await s.store.runReview(pending.record);
    assert.equal(reviewed.status, 'manual-review');
    assert.equal(reviewed.reason, 'review-unavailable');
    assert.equal((await s.store.runReview(pending.record)).status, 'manual-review');
    await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate)), denied());
    assert.equal((await s.store.listManual(admin))[0].reviewId, pending.record.reviewId);
  }
  assert.throws(() => createFixtureCreationReviewer({ nodeEnv: 'production', enabled: true }, async () => evidence()));
  assert.throws(() => createFixtureCreationReviewer({ nodeEnv: 'development', enabled: false }, async () => evidence()));
});

test('forged owner/session or review proof cannot read, replace, run or reuse another owner review', async () => {
  const s = setup(), approved = await allowed(s);
  const forged = { ...owner, uid: other.uid };
  const before = structuredClone([...s.db.rows]);
  await assert.rejects(s.store.get(forged), denied(403));
  await assert.rejects(s.store.request(forged, candidate), denied(403));
  await assert.rejects(s.store.runReview({ ...approved, ownerUid: other.uid }), denied());
  await assert.rejects(s.store.runReview({ ...approved, digest: 'f'.repeat(64) }), denied());
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, other.uid, candidate, approved)), denied());
  assert.deepEqual([...s.db.rows], before);
  assert.equal(await s.store.get(other), null);
});

test('a delayed old review cannot authorize a newer draft or replace its blocked result', async () => {
  let release!: (value: CreationReviewerResult) => void;
  let started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const delayed = new Promise<CreationReviewerResult>(resolve => { release = resolve; });
  const s = setup({ reviewer: reviewer(async input => {
    if (input.name === candidate.name) { started(); return delayed; }
    return evidence({ 'extremist-impersonation': 'violation' });
  }) });
  const old = await s.store.request(owner, candidate);
  const pending = s.store.runReview(old.record);
  await began;
  const changed = { ...candidate, name: 'Changed' };
  const next = await s.store.request(owner, changed);
  assert.equal((await s.store.runReview(next.record)).status, 'blocked');
  release(evidence());
  await assert.rejects(pending, denied());
  assert.equal((await s.store.get(owner))?.reviewId, next.record.reviewId);
  assert.equal((await s.store.get(owner))?.status, 'blocked');
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, changed)), denied());
});

test('parallel workers claim a pending review once; policy changes during work reject completion', async () => {
  let calls = 0, release!: (value: CreationReviewerResult) => void, started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const wait = new Promise<CreationReviewerResult>(resolve => { release = resolve; });
  const s = setup({ reviewer: reviewer(async () => { calls++; started(); return wait; }) });
  const second = createCreationReviewStore(s.db, s.options), requested = await s.store.request(owner, candidate);
  const firstRun = s.store.runReview(requested.record);
  await began;
  assert.equal((await second.runReview(requested.record)).status, 'pending');
  s.setPolicy({ ...policy(), version: 'fixture-v2' });
  release(evidence());
  await assert.rejects(firstRun, denied());
  assert.equal(calls, 1);
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate)), denied());
});

test('a concurrent edit wins before Create and rejection rolls back the entire mutation transaction', async () => {
  const s = setup(), approved = await allowed(s);
  const edit = s.store.request(owner, { ...candidate, initialPrompt: 'New content' });
  const create = s.db.transaction(async tx => {
    await s.store.requireAllowed(tx, owner.uid, candidate, approved);
    tx.set('created/example', { saved: true });
  });
  await edit;
  await assert.rejects(create, denied());
  assert.equal(s.db.rows.has('created/example'), false);
});

test('manual review requires verified admin and exact proof; explicit approval is auditable and reusable', async () => {
  const s = setup({ reviewer: null });
  const pending = await s.store.request(owner, candidate);
  const manual = await s.store.runReview(pending.record);
  const request = { ...manual, decision: 'allowed' as const };
  await assert.rejects(s.store.listManual(owner), denied(403));
  await assert.rejects(s.store.decide(owner, request), denied(403));
  await assert.rejects(s.store.decide({ ...owner, uid: admin.uid }, request), denied(403));
  await assert.rejects(s.store.decide(admin, { ...request, digest: 'f'.repeat(64) }), denied());
  await assert.rejects(s.store.decide(admin, { ...request, ownerUid: other.uid }), denied());
  const reviewed = await s.store.decide(admin, request);
  assert.equal(reviewed.status, 'allowed');
  assert.deepEqual(reviewed.decision, { actorUid: admin.uid, decision: 'allowed', decidedAt: 1000 });
  await s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate, reviewed));
  assert.equal((await s.store.listManual(admin))[0].status, 'allowed');
  await assert.rejects(s.store.decide(admin, { ...request, decision: 'blocked' }), denied());
});

test('manual rejection stays blocked and cannot override a category block or pending review', async () => {
  const s = setup({ reviewer: null }), pending = await s.store.request(owner, candidate);
  await assert.rejects(s.store.decide(admin, { ...pending.record, decision: 'allowed' }), denied());
  const manual = await s.store.runReview(pending.record);
  assert.equal((await s.store.decide(admin, { ...manual, decision: 'blocked' })).status, 'blocked');
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate)), denied());
  const blocked = setup({ reviewer: reviewer(async () => evidence({ 'extremist-impersonation': 'violation' })) });
  const record = await allowed(blocked);
  assert.equal(record.status, 'blocked');
  await assert.rejects(blocked.store.decide(admin, { ...record, decision: 'allowed' }), denied());
});

test('manual decisions stale on an edit or policy change; superseded records leave the queue', async () => {
  const s = setup({ reviewer: null }), initial = await s.store.request(owner, candidate);
  const manual = await s.store.runReview(initial.record);
  const updated = await s.store.request(owner, { ...candidate, name: 'Changed' });
  await assert.rejects(s.store.decide(admin, { ...manual, decision: 'allowed' }), denied());
  assert.deepEqual((await s.store.listManual(admin)).map(row => row.reviewId), [updated.record.reviewId]);
  const newest = await s.store.runReview(updated.record);
  s.setPolicy({ ...policy(), version: 'fixture-v2' });
  await assert.rejects(s.store.decide(admin, { ...newest, decision: 'allowed' }), denied());
});

test('malformed stored content fails closed and missing legacy approval is never inferred', async () => {
  const s = setup();
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate)), denied());
  const reviewed = await allowed(s);
  s.db.rows.set(`creationSafetyReviews/${reviewed.reviewId}`, { ...reviewed, candidate: { ...candidate, name: 'Changed without review' } });
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate)), denied(503));
});

test('expected binding cannot substitute another policy or digest during guarded mutation', async () => {
  const s = setup(), reviewed = await allowed(s);
  for (const binding of [
    { ...reviewed, digest: 'f'.repeat(64) }, { ...reviewed, policyVersion: 'forged' },
    { ...reviewed, policyDigest: 'f'.repeat(64) },
  ] satisfies CreationReviewProof[]) await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate, binding)), denied());
});

test('an exact published approval survives unrelated draft reviews, but draft enforcement and policy changes stay strict', async () => {
  const s = setup();
  const original = await allowed(s);
  await allowed(s, { ...candidate, name: 'Different draft' });
  await assert.rejects(s.db.transaction(tx => s.store.requireAllowed(tx, owner.uid, candidate)), denied());
  const proof = await s.db.transaction(tx => s.store.requireSnapshotAllowed(tx, owner.uid, candidate));
  assert.equal(proof.reviewId, original.reviewId);
  await assert.rejects(s.db.transaction(tx => s.store.requireSnapshotAllowed(tx, other.uid, candidate)), denied());
  await assert.rejects(s.db.transaction(tx => s.store.requireSnapshotAllowed(tx, owner.uid, { ...candidate, name: 'Never reviewed' })), denied());
  s.setPolicy({ ...policy(), version: 'new-policy' });
  await assert.rejects(s.db.transaction(tx => s.store.requireSnapshotAllowed(tx, owner.uid, candidate)), denied());
});

test('v4 retains exact genuine v3 approvals without re-review, but never changed, revoked or unknown-policy proofs', async () => {
  const { PREVIOUS_CREATION_POLICY } = await import('../lib/creation-policy');
  const s = setup({ policy: () => PREVIOUS_CREATION_POLICY });
  const prior = await allowed(s);
  s.db.rows.set(`creationSafetyReviews/${prior.reviewId}`, { ...prior, reason: 'manual-decision' });
  const next = createCreationReviewStore(s.db, { ...s.options, policy: () => CONSERVATIVE_CREATION_POLICY });
  assert.equal((await s.db.transaction(tx => next.requireAllowed(tx, owner.uid, candidate))).reviewId, prior.reviewId);
  assert.equal((await next.request(owner, candidate)).needsReview, false);
  await assert.rejects(s.db.transaction(tx => next.requireAllowed(tx, owner.uid, { ...candidate, initialPrompt: 'changed' })), denied());
  await next.request(owner, { ...candidate, initialPrompt: 'A new private draft.' });
  assert.equal((await s.db.transaction(tx => next.requireSnapshotAllowed(tx, owner.uid, candidate))).reviewId, prior.reviewId);
  await next.followUp(owner.uid, candidate);
  await next.decide(admin, { ...prior, decision: 'revoked' });
  await assert.rejects(s.db.transaction(tx => next.requireSnapshotAllowed(tx, owner.uid, candidate)), denied());
  await assert.rejects(next.request(owner, candidate), denied());
  const unknown = setup({ policy: () => ({ ...PREVIOUS_CREATION_POLICY, version: 'unrecognized' }) });
  await allowed(unknown);
  const strict = createCreationReviewStore(unknown.db, { ...unknown.options, policy: () => CONSERVATIVE_CREATION_POLICY });
  await assert.rejects(unknown.db.transaction(tx => strict.requireAllowed(tx, owner.uid, candidate)), denied());
});

test('reading an owner status automatically repairs a missing blocked queue entry with no paid retry', async () => {
  let calls = 0;
  const s = setup({ reviewer: reviewer(async () => { calls++; return evidence({ 'extremist-impersonation': 'violation' }); }) });
  const blocked = await allowed(s);
  s.db.rows.set('creationSafetyQueue/manual', { reviewIds: [] });
  assert.equal(await s.store.get(other), null);
  assert.deepEqual(s.db.rows.get('creationSafetyQueue/manual'), { reviewIds: [] });
  for (let i = 0; i < 2; i++) {
    assert.equal((await s.store.get(owner))?.reviewId, blocked.reviewId);
    assert.deepEqual((await s.store.listManual(admin)).map(row => row.reviewId), [blocked.reviewId]);
  }
  assert.equal(calls, 1);
  await assert.rejects(s.store.decide(admin, { ...blocked, decision: 'allowed' }), denied());
});

test('v5 preserves a legacy block for inspection, but requires a genuine new review to change its verdict', async () => {
  const { PREVIOUS_FOLLOWUP_POLICY } = await import('../lib/creation-policy');
  let calls = 0;
  const s = setup({ policy: () => PREVIOUS_FOLLOWUP_POLICY,
    reviewer: reviewer(async () => { calls++; return evidence({ 'fraud-impersonation': 'violation', 'portrait-provenance': 'uncertain' }); }) });
  const old = await allowed(s, { ...candidate, name: 'Benjamin Franklin' });
  s.db.rows.set('creationSafetyQueue/manual', { reviewIds: [] });
  const next = createCreationReviewStore(s.db, { ...s.options, policy: () => CONSERVATIVE_CREATION_POLICY,
    reviewer: reviewer(async () => { calls++; return evidence({ 'portrait-provenance': 'uncertain' }); }) });
  await assert.rejects(next.get(owner), denied());
  const queued = await next.listManual(admin);
  assert.equal(queued[0].reviewId, old.reviewId);
  assert.equal(queued[0].policyCurrent, false);
  assert.equal(queued[0].status, 'blocked');
  assert.equal((await next.getForAdmin(admin, old.reviewId)).status, 'blocked');
  await assert.rejects(next.decide(admin, { ...old, decision: 'allowed' }), denied());
  await assert.rejects(s.db.transaction(tx => next.requireAllowed(tx, owner.uid, old.candidate)), denied());
  assert.equal(calls, 1, 'GET and queue repair never invoke the reviewer');
  const pending = await next.request(owner, old.candidate);
  assert.equal(pending.needsReview, true);
  assert.notEqual(pending.record.reviewId, old.reviewId);
  const reviewed = await next.runReview(pending.record);
  assert.equal(reviewed.status, 'allowed');
  assert.equal((await s.db.transaction(tx => next.requireAllowed(tx, owner.uid, old.candidate))).reviewId, reviewed.reviewId);
  assert.equal(calls, 2);
  assert.equal(s.db.rows.get(`creationSafetyReviews/${old.reviewId}`)?.status, 'blocked', 'history is not rewritten');
});

test('an admin queue refresh restores its own legacy block automatically, without an owner POST', async () => {
  const { PREVIOUS_FOLLOWUP_POLICY } = await import('../lib/creation-policy');
  let calls = 0;
  const s = setup({ policy: () => PREVIOUS_FOLLOWUP_POLICY,
    reviewer: reviewer(async () => { calls++; return evidence({ 'fraud-impersonation': 'violation' }); }) });
  const old = await allowed(s);
  s.db.rows.set('sessions/owner-a-session', { uid: owner.uid, active: true, creationReviewAdmin: true });
  s.db.rows.set('creationSafetyQueue/manual', { reviewIds: [] });
  const next = createCreationReviewStore(s.db, { ...s.options, policy: () => CONSERVATIVE_CREATION_POLICY });
  for (let i = 0; i < 2; i++) {
    const queued = await next.listManual(owner);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].reviewId, old.reviewId);
    assert.equal(queued[0].policyCurrent, false);
  }
  assert.equal(calls, 1);
});

test('v5 retains exact v4 approvals and their revocation, never replaying a blocked result as allowed', async () => {
  const { PREVIOUS_FOLLOWUP_POLICY } = await import('../lib/creation-policy');
  const s = setup({ policy: () => PREVIOUS_FOLLOWUP_POLICY,
    reviewer: reviewer(async () => evidence({ 'portrait-provenance': 'uncertain' })) });
  const prior = await allowed(s);
  const next = createCreationReviewStore(s.db, { ...s.options, policy: () => CONSERVATIVE_CREATION_POLICY });
  assert.equal((await next.request(owner, candidate)).record.reviewId, prior.reviewId);
  await s.db.transaction(tx => next.requireAllowed(tx, owner.uid, candidate));
  await next.decide(admin, { ...prior, decision: 'revoked' });
  await assert.rejects(next.request(owner, candidate), denied());
  await assert.rejects(s.db.transaction(tx => next.requireSnapshotAllowed(tx, owner.uid, candidate)), denied());
});
