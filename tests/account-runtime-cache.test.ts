import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

// Exercise the actual runtime modules across development reloads, with no
// credentials, durable writes, auth exchange, paid provider or cloud connection.
test('a local policy reload replaces stale save, publication and voice validators, preserving controls and unchanged caches', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    globalThis.fetch = () => { throw new Error('Network forbidden in cache test'); };
    const policy = (await import('./lib/creation-policy.ts')).CONSERVATIVE_CREATION_POLICY;
    const stale = { stale: true };
    globalThis.flowpathAccounts = stale;
    globalThis.flowpathAccountSafetyVersion = 'creation-safety-v3';
    globalThis.flowpathPaidStore = stale;
    globalThis.flowpathPaidSafetyVersion = 'creation-safety-v3-draft-snapshots-v1';
    const first = await import('./lib/account-runtime.ts?cache-test=first');
    await import('./lib/paid-runtime.ts?cache-test=first');
    assert.notEqual(first.accountServer, stale);
    assert.equal(globalThis.flowpathPaidStore, undefined);
    const version = globalThis.flowpathAccountSafetyVersion;
    const stable = await import('./lib/account-runtime.ts?cache-test=stable');
    assert.equal(stable.accountServer, first.accountServer);
    globalThis.flowpathPaidStore = stale;
    await import('./lib/paid-runtime.ts?cache-test=stable');
    assert.equal(globalThis.flowpathPaidStore, stale);
    const voice = await import('./lib/production-voice-runtime.ts');
    const control = { synthetic: true };
    const controls = new Map([['synthetic-active-call', control]]);
    globalThis.flowpathLocalVoiceControllers = controls;
    const firstVoice = voice.getProductionVoiceServer();
    assert.equal(voice.getProductionVoiceServer(), firstVoice);
    policy.version = 'synthetic-policy-update';
    const updated = await import('./lib/account-runtime.ts?cache-test=updated');
    await import('./lib/paid-runtime.ts?cache-test=updated');
    assert.notEqual(updated.accountServer, first.accountServer);
    assert.notEqual(globalThis.flowpathAccountSafetyVersion, version);
    assert.equal(globalThis.flowpathPaidStore, undefined);
    assert.notEqual(voice.getProductionVoiceServer(), firstVoice);
    assert.equal(globalThis.flowpathLocalVoiceControllers, controls);
    assert.equal(controls.get('synthetic-active-call'), control);
    const response = await updated.accountServer.accountGET(new Request('http://localhost:3220/api/account', { headers: { host: 'localhost:3220' } }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user, null);
  `], { cwd: process.cwd(), encoding: 'utf8', timeout: 20_000,
    env: { PATH: process.env.PATH, NODE_ENV: 'development', FLOWPATH_LOCAL_APP: '1', FLOWPATH_LOCAL_APP_ORIGIN: 'http://localhost:3220',
      FLOWPATH_ACCOUNT_MODE: 'firebase', FLOWPATH_FIRESTORE_EDITION: 'standard', FLOWPATH_FIREBASE_PROJECT_ID: 'flowpath-studio',
      FLOWPATH_FIREBASE_AUTO_CONFIG: '1', FLOWPATH_LIVE_ENABLED: '0', FLOWPATH_PAID_FIXTURES: '0', FLOWPATH_PAID_TEST_ENABLED: '0' } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
