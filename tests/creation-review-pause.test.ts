import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const origin = 'http://127.0.0.1:3220';

function request(path: string, body: object, cookie?: string, method = 'POST') {
  return new Request(`${origin}/api/${path}`, {
    method, headers: { host: '127.0.0.1:3220', origin, 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

test('a signed-in creator can save Visual Display while creation review is paused', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-review-pause-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  Object.assign(process.env, { NODE_ENV: 'development', FLOWPATH_ACCOUNT_MODE: 'local', FLOWPATH_LOCAL_APP: '0',
    FLOWPATH_ACCOUNT_FIXTURE_DIRECTORY: directory, FLOWPATH_SAFETY_FIXTURES: '1', FLOWPATH_CREATION_SAFETY_PAUSED: '1' });
  const { accountServer } = await import('../lib/account-runtime');
  const { creationApi } = await import('../lib/creation-api-runtime');
  const visualDisplay = { type: 'visual', version: 1, images: [] };
  const draft = { name: 'Synthetic guide', initialPrompt: 'Describe the exhibit.', visualDisplay };
  assert.equal((await accountServer.waveformPUT(request('waveform', draft), true)).status, 401);
  const login = await accountServer.accountPOST(request('account', { localAccount: 'owner-a' }));
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const saved = await accountServer.waveformPUT(request('waveform?id=130bcfac-d349-4034-84fa-d27ce603030b', draft, cookie), true);
  assert.equal(saved.status, 200);
  const { waveform } = await saved.json();
  assert.deepEqual(waveform.visualDisplay, visualDisplay);
  assert.equal((await creationApi.POST(request('creation-review', { candidate: draft }, cookie))).status, 503);

  process.env.FLOWPATH_CREATION_SAFETY_PAUSED = '0';
  const reviewRequired = await accountServer.waveformPUT(request(`waveform?id=${waveform.id}`, { ...draft, name: 'Edited guide' }, cookie, 'PUT'));
  assert.equal((await reviewRequired.json()).reviewRequired, true);
});
