import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CreationReviewQueue from '../components/CreationReviewQueue';
import { useCreationReview } from '../lib/use-creation-review';
import { canDecideCreationReview, canonicalCreationReviewCandidate, creationReviewDecisionPayload, creationReviewQueueRecords,
  creationReviewResponseStatus, creationReviewView, type CreationReviewCandidate, type CreationReviewClientResult, type CreationReviewStatus } from '../lib/creation-review-client';

const candidate = { name: 'Waveform', initialPrompt: 'Helpful instructions' };
const proof = { ownerUid: 'synthetic-owner', reviewId: 'synthetic-review', digest: 'synthetic-digest', policyVersion: 'policy-v1', policyDigest: 'synthetic-policy' };

test('review keys match server trim rules while preserving internal newlines and exact text-panel whitespace', () => {
  const first = canonicalCreationReviewCandidate({ name: '  Waveform  ', initialPrompt: '\r\n Helpful\r\ninstructions\n ' });
  assert.deepEqual(first?.candidate, { name: 'Waveform', initialPrompt: 'Helpful\r\ninstructions', textPanel: null });
  assert.equal(first?.key, canonicalCreationReviewCandidate({ name: 'Waveform', initialPrompt: 'Helpful\r\ninstructions', textPanel: null })?.key);
  assert.notEqual(first?.key, canonicalCreationReviewCandidate({ name: 'Waveform', initialPrompt: 'Helpful\ninstructions' })?.key);
  const textPanel = { type: 'text', version: 1, text: ' \nExact text\r\n ' } as const;
  assert.equal(canonicalCreationReviewCandidate({ ...candidate, textPanel })?.candidate.textPanel?.text, textPanel.text);
  assert.notEqual(canonicalCreationReviewCandidate({ ...candidate, textPanel })?.key,
    canonicalCreationReviewCandidate({ ...candidate, textPanel: { ...textPanel, text: textPanel.text.trim() } })?.key);
});

test('invalid editor candidates are rejected locally without clipping or sending review requests', () => {
  for (const input of [{ ...candidate, name: '' }, { ...candidate, name: ' '.repeat(81) },
    { ...candidate, name: 'x'.repeat(81) }, { ...candidate, name: 'Bad\nName' },
    { ...candidate, initialPrompt: '' }, { ...candidate, initialPrompt: 'x'.repeat(8_001) },
    { ...candidate, initialPrompt: 'Bad\u0000prompt' },
    { ...candidate, textPanel: { type: 'text', version: 1, text: 'x'.repeat(4_001) } },
    { ...candidate, textPanel: { type: 'html', version: 1, text: 'invalid' } }]) {
    assert.equal(canonicalCreationReviewCandidate(input as CreationReviewCandidate), null);
  }
  assert.ok(canonicalCreationReviewCandidate({ name: 'x'.repeat(80), initialPrompt: 'x'.repeat(8_000), textPanel: { type: 'text', version: 1, text: 'x'.repeat(4_000) } }));
});

test('only an enabled complete response with a known status can allow Save', () => {
  for (const status of ['pending', 'allowed', 'blocked', 'manual-review', 'stale', 'unavailable'] as const) {
    assert.equal(creationReviewResponseStatus({ enabled: true, review: { ...proof, status } }), status);
  }
  for (const input of [null, {}, { enabled: false }, { enabled: true, review: { status: 'allowed' } },
    { enabled: true, review: { ...proof, status: 'approved' } },
    { enabled: true, review: { ...proof, digest: '', status: 'allowed' } },
    { get enabled() { throw new Error('private error'); } }]) {
    assert.equal(creationReviewResponseStatus(input), 'unavailable');
  }
});

test('edits, owner changes and out-of-order results fail closed immediately before effects run', () => {
  const oldKey = canonicalCreationReviewCandidate(candidate)!.key;
  const newKey = canonicalCreationReviewCandidate({ ...candidate, initialPrompt: 'Edited version' })!.key;
  const result: CreationReviewClientResult = { ownerKey: 'owner-a', key: oldKey, status: 'allowed' };
  assert.deepEqual(creationReviewView({ enabled: true, ownerKey: 'owner-a', key: oldKey, result }), { status: 'allowed', canSave: true });
  assert.deepEqual(creationReviewView({ enabled: true, ownerKey: 'owner-a', key: newKey, result }), { status: 'stale', canSave: false });
  assert.deepEqual(creationReviewView({ enabled: true, ownerKey: 'owner-b', key: oldKey, result }), { status: 'stale', canSave: false });
  assert.deepEqual(creationReviewView({ enabled: true, ownerKey: 'owner-a', key: newKey, result: null }), { status: 'pending', canSave: false });
  assert.deepEqual(creationReviewView({ enabled: true, ownerKey: '', key: oldKey, result }), { status: 'unavailable', canSave: false });
  assert.deepEqual(creationReviewView({ enabled: true, ownerKey: 'owner-a', key: null, result }), { status: null, canSave: false });
  assert.deepEqual(creationReviewView({ enabled: false, ownerKey: '', key: null, result }), { status: null, canSave: true });
  for (const status of ['pending', 'blocked', 'manual-review', 'stale', 'unavailable'] as const) {
    assert.equal(creationReviewView({ enabled: true, ownerKey: 'owner-a', key: oldKey, result: { ...result, status } }).canSave, false);
  }
});

test('admin queue projects exact proof and bounded candidate fields without retaining extra server data', () => {
  const malicious = '<script>attack()</script>\n[link](javascript:attack())';
  const records = creationReviewQueueRecords({ reviews: [{ ...proof, candidate: { ...candidate, initialPrompt: malicious,
    textPanel: { type: 'text', version: 1, text: '<img onerror="attack()">' } }, status: 'manual-review', categories: ['policy-check'], privateMetadata: 'omit me' }] });
  assert.equal(records?.length, 1);
  assert.equal(records?.[0].candidate.initialPrompt, malicious);
  assert.doesNotMatch(JSON.stringify(records), /privateMetadata|omit me/);
  const payload = creationReviewDecisionPayload(records![0], 'allowed');
  assert.deepEqual(payload, { ...proof, decision: 'allowed' });
  assert.doesNotMatch(JSON.stringify(payload), /candidate|initialPrompt|script|categories|textPanel/);
  records![0].proof.digest = 'changed-local-copy';
  assert.equal(payload.digest, 'synthetic-digest');
});

test('pending and completed reviews cannot be decided, while malformed queues fail closed', () => {
  for (const status of ['pending', 'allowed', 'blocked', 'stale', 'unavailable'] as CreationReviewStatus[]) assert.equal(canDecideCreationReview(status), false);
  assert.equal(canDecideCreationReview('manual-review'), true);
  assert.deepEqual(creationReviewQueueRecords({ reviews: [] }), []);
  for (const input of [{}, { reviews: 'private' }, { reviews: [{}] },
    { reviews: [{ ...proof, digest: '', candidate, status: 'manual-review', categories: [] }] },
    { reviews: [{ ...proof, candidate, status: 'unknown', categories: [] }] },
    { reviews: [{ ...proof, candidate, status: 'manual-review', categories: ['x'.repeat(81)] }] },
    { reviews: Array(101).fill({ ...proof, candidate, status: 'manual-review', categories: [] }) }]) {
    assert.equal(creationReviewQueueRecords(input), null);
  }
});

test('unverified queue renders nothing and hook initially fails closed without any fetch during render', () => {
  assert.equal(renderToStaticMarkup(createElement(CreationReviewQueue, { verifiedAdmin: false })), '');
  function Preview({ enabled }: { enabled: boolean }) {
    const review = useCreationReview({ enabled, ownerKey: 'synthetic-owner', candidate });
    return createElement('span', null, JSON.stringify(review));
  }
  assert.match(renderToStaticMarkup(createElement(Preview, { enabled: true })), /pending.*canSave&quot;:false/);
  assert.match(renderToStaticMarkup(createElement(Preview, { enabled: false })), /status&quot;:null.*canSave&quot;:true/);
});
