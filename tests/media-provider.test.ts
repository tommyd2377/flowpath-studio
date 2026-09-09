import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('connected photo interpretation remains bounded with entirely offline services', async () => {
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ['--experimental-test-module-mocks', '--conditions=react-server', '--import', 'tsx', '--test', '--test-reporter=tap', fileURLToPath(new URL('./helpers/media-provider.fixture.ts', import.meta.url))], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), env: { NODE_ENV: 'test', VOICE_BACKEND: 'firebase', VOICE_AI_MODE: 'demo' }, timeout: 20_000,
    });
    assert.match(stdout, /# pass 6/); assert.match(stdout, /# fail 0/);
  } catch (error) { const result = error as Error & { stdout?: string; stderr?: string }; assert.fail(`${result.message}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`); }
});
