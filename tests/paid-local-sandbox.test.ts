import assert from 'node:assert/strict';
import test from 'node:test';
import { localStripeSandboxOrigin } from '../lib/paid-local-sandbox';

const local = { NODE_ENV: 'development', FLOWPATH_ACCOUNT_MODE: 'local', FLOWPATH_STRIPE_LOCAL_SANDBOX: '1',
  FLOWPATH_ACCOUNT_FIXTURE_DIRECTORY: '/private/tmp/synthetic-fixtures', FLOWPATH_STRIPE_LOCAL_ORIGIN: 'http://127.0.0.1:3220' };
test('real Stripe test forwarding requires explicit isolated local fixtures and a loopback origin', () => {
  assert.equal(localStripeSandboxOrigin(local), 'http://127.0.0.1:3220');
  for (const override of [{ NODE_ENV: 'production' }, { FLOWPATH_ACCOUNT_MODE: 'firebase' }, { FLOWPATH_STRIPE_LOCAL_SANDBOX: '0' },
    { FLOWPATH_ACCOUNT_FIXTURE_DIRECTORY: '' }, { FLOWPATH_PAID_FIXTURES: '1' }]) assert.equal(localStripeSandboxOrigin({ ...local, ...override }), undefined);
  for (const origin of ['https://flowpath.studio', 'http://evil.example:3220', 'http://user:pass@localhost:3220',
    'http://localhost:3220/path', 'http://localhost:3220/?x=1', 'http://localhost:3220/#fragment']) {
    assert.equal(localStripeSandboxOrigin({ ...local, FLOWPATH_STRIPE_LOCAL_ORIGIN: origin }), undefined);
  }
});
