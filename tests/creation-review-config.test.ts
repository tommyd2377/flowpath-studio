import assert from 'node:assert/strict';
import test from 'node:test';
import { CREATION_POLICY_PRESET, CREATION_REVIEW_BUDGET_MICRO_USD, CREATION_REVIEW_MODEL,
  configuredCreationPolicy, hostedCreationReviewConfigured } from '../lib/creation-review-config';
import { CONSERVATIVE_CREATION_POLICY } from '../lib/creation-policy';

const hosted = { NODE_ENV: 'production', FLOWPATH_CREATION_SAFETY_ENABLED: '1', FLOWPATH_ACCOUNT_MODE: 'firebase',
  FLOWPATH_FIRESTORE_EDITION: 'standard', FLOWPATH_FIREBASE_PROJECT_ID: 'flowpath-studio',
  FLOWPATH_PUBLIC_ORIGIN: 'https://flowpath.studio', FLOWPATH_CREATION_POLICY_PRESET: CREATION_POLICY_PRESET };

test('hosted review opt-in is exact and uses the existing approved policy, model and budget', () => {
  assert.equal(hostedCreationReviewConfigured(hosted), true);
  assert.deepEqual(configuredCreationPolicy(hosted), CONSERVATIVE_CREATION_POLICY);
  assert.notEqual(configuredCreationPolicy(hosted), CONSERVATIVE_CREATION_POLICY);
  assert.equal(CREATION_REVIEW_MODEL, 'gpt-6-luna');
  assert.equal(CREATION_REVIEW_BUDGET_MICRO_USD, 500_000);
  for (const [key, value] of Object.entries({ NODE_ENV: 'development', FLOWPATH_CREATION_SAFETY_ENABLED: '0',
    FLOWPATH_ACCOUNT_MODE: 'local', FLOWPATH_FIRESTORE_EDITION: '', FLOWPATH_FIREBASE_PROJECT_ID: 'unrelated',
    FLOWPATH_PUBLIC_ORIGIN: 'https://unrelated.example', FLOWPATH_CREATION_POLICY_PRESET: 'unknown' })) {
    assert.equal(hostedCreationReviewConfigured({ ...hosted, [key]: value }), false, key);
  }
  assert.equal(hostedCreationReviewConfigured({}), false);
});

test('missing or malformed hosted policy fails closed and explicit JSON remains compatible', () => {
  assert.equal(configuredCreationPolicy({}), null);
  assert.equal(configuredCreationPolicy({ FLOWPATH_CREATION_POLICY_JSON: '{' }), null);
  assert.equal(configuredCreationPolicy({ FLOWPATH_CREATION_POLICY_JSON: '{}' }), null);
  const env = { ...hosted, FLOWPATH_CREATION_POLICY_PRESET: undefined, FLOWPATH_CREATION_POLICY_JSON: JSON.stringify(CONSERVATIVE_CREATION_POLICY) };
  assert.equal(hostedCreationReviewConfigured(env), true);
  assert.deepEqual(configuredCreationPolicy(env), CONSERVATIVE_CREATION_POLICY);
});
