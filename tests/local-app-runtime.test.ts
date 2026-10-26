import assert from 'node:assert/strict';
import test from 'node:test';
import { localAppOrigin, localAppDatabase, localTestingVoicePolicy } from '../lib/local-app-runtime';
import { localStripeSandboxOrigin } from '../lib/paid-local-sandbox';
import { PaidMemoryDatabase } from './paid-fixture';

const env = { NODE_ENV: 'development', FLOWPATH_LOCAL_APP: '1', FLOWPATH_LOCAL_APP_ORIGIN: 'http://localhost:3220',
  FLOWPATH_ACCOUNT_MODE: 'firebase', FLOWPATH_FIRESTORE_EDITION: 'standard', FLOWPATH_FIREBASE_PROJECT_ID: 'flowpath-studio' };

test('unmetered founder testing is selected only by the validated full localhost runtime', () => {
  const configured = { ...env, FLOWPATH_LIVE_ENABLED: '1', FLOWPATH_VOICE_OWNER_DAILY_SECONDS: '900',
    FLOWPATH_VOICE_GLOBAL_DAILY_SECONDS: '7200', FLOWPATH_VOICE_GLOBAL_CONCURRENCY: '2', FLOWPATH_VOICE_ACCESS: 'signed-in' };
  assert.equal(localTestingVoicePolicy(configured)?.unmeteredAdminTesting, true);
  for (const override of [{ NODE_ENV: 'production' }, { FLOWPATH_LOCAL_APP: '0' }, { FLOWPATH_ACCOUNT_MODE: 'local' },
    { FLOWPATH_PUBLIC_ORIGIN: 'https://flowpath.studio' }, { FLOWPATH_LOCAL_APP_ORIGIN: 'http://other.example:3220' }]) {
    assert.notEqual(localTestingVoicePolicy({ ...configured, ...override })?.unmeteredAdminTesting, true);
  }
});

test('full local app requires explicit real-account configuration and localhost, never selects production or fixtures', () => {
  assert.equal(localAppOrigin(env), 'http://localhost:3220');
  for (const override of [{ NODE_ENV: 'production' }, { FLOWPATH_LOCAL_APP: '0' }, { FLOWPATH_ACCOUNT_MODE: 'local' },
    { FLOWPATH_FIREBASE_PROJECT_ID: 'thevoice-old' }, { FLOWPATH_FIRESTORE_EDITION: 'enterprise' },
    { FLOWPATH_PUBLIC_ORIGIN: 'https://flowpath.studio' }, { FLOWPATH_PAID_FIXTURES: '1' }]) {
    assert.equal(localAppOrigin({ ...env, ...override }), undefined);
  }
  for (const origin of ['http://localhost', 'https://localhost:3220', 'http://127.0.0.1:3220',
    'http://user:pass@localhost:3220', 'http://localhost:3220/path', 'http://localhost:3220/?x=1', 'http://evil.example:3220']) {
    assert.equal(localAppOrigin({ ...env, FLOWPATH_LOCAL_APP_ORIGIN: origin }), undefined);
  }
});

test('local session/ledger transactions retain real account authority and isolate every operational collection', async () => {
  const base = new PaidMemoryDatabase();
  base.rows.set('ownerSessions/current', { uid: 'owner', state: 'active' });
  base.rows.set('voiceAdmission/global', { reservedSeconds: 3600 });
  const local = localAppDatabase(base);
  await local.transaction(async tx => {
    assert.equal((await tx.get('ownerSessions/current'))?.uid, 'owner');
    assert.equal(await tx.get('voiceAdmission/global'), null);
    tx.set('voiceAdmission/global', { reservedSeconds: 180 });
    tx.set('paidTestWallets/test', { balance: 900 });
  });
  assert.equal(base.rows.get('voiceAdmission/global')?.reservedSeconds, 3600);
  assert.equal(base.rows.get('localStudio_voiceAdmission/global')?.reservedSeconds, 180);
  assert.equal(base.rows.has('paidTestWallets/test'), false);
  assert.equal(base.rows.get('localStudio_paidTestWallets/test')?.balance, 900);
});

test('full local Firebase accounts can use existing sandbox Stripe without selecting synthetic account storage', () => {
  const stripe = { ...env, FLOWPATH_STRIPE_LOCAL_SANDBOX: '1', FLOWPATH_STRIPE_LOCAL_ORIGIN: 'http://localhost:3220',
    FLOWPATH_ACCOUNT_FIXTURE_DIRECTORY: '/private/tmp/local-app-private' };
  assert.equal(localStripeSandboxOrigin(stripe), 'http://localhost:3220');
  assert.equal(localStripeSandboxOrigin({ ...stripe, FLOWPATH_LOCAL_APP: '0' }), undefined);
  assert.equal(localStripeSandboxOrigin({ ...stripe, FLOWPATH_STRIPE_LOCAL_ORIGIN: 'http://127.0.0.1:3220' }), undefined);
});
