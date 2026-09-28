import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('editor and semantic ingestion use the quality defaults through offline provider requests', async () => {
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ['--experimental-test-module-mocks', '--conditions=react-server', '--import', 'tsx', '--test', '--test-reporter=tap', fileURLToPath(new URL('./helpers/studio-provider-requests.fixture.ts', import.meta.url))], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      // No inherited environment or real credentials; the child replaces every network/storage call.
      env: { NODE_ENV: 'test', VOICE_BACKEND: 'firebase', VOICE_AI_MODE: 'openai', OPENAI_API_KEY: 'offline-test-placeholder' }, timeout: 20_000,
    });
    assert.match(stdout, /# pass 4/); assert.match(stdout, /# fail 0/);
  } catch (error) { const result = error as Error & { stdout?: string; stderr?: string }; assert.fail(`${result.message}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`); }
});
