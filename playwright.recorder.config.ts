import { defineConfig } from '@playwright/test';
import { dirname, join } from 'node:path';
import base from './playwright.config';

const snapshot = process.env.FLOWPATH_RECORDER_TEST_ROOT;
if (!snapshot) throw new Error('Use npm run test:recorder for an isolated development server.');
const quote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
export default defineConfig({ ...base, testDir: './tests/recorder-browser', outputDir: './test-results/recorder', timeout: 120_000,
  webServer: {
    cwd: snapshot,
    command: `env -i PATH=${quote(`${dirname(process.execPath)}:/usr/bin:/bin`)} NODE_ENV=development VOICE_BACKEND=demo VOICE_AI_MODE=demo VOICE_APP_ORIGIN=http://127.0.0.1:3225 VOICE_DATA_DIR=${quote(join(snapshot, 'data'))} ${quote(process.execPath)} node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3225`,
    url: 'http://127.0.0.1:3225', reuseExistingServer: false, timeout: 120_000,
  },
});
