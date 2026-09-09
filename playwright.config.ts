import { chromium, defineConfig } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const node = process.execPath;
const binary = [chromium.executablePath(), join(homedir(), 'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')].find(existsSync);
if (!binary) throw new Error('The existing isolated Playwright Chromium binary is unavailable. No browser was installed.');
const data = mkdtempSync(join(tmpdir(), 'thevoice-platform-browser-'));
const quote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;

export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1,
  timeout: 90_000, expect: { timeout: 10_000 }, retries: 0,
  reporter: 'list', outputDir: './test-results/platform',
  use: {
    baseURL: 'http://127.0.0.1:3225', viewport: { width: 1440, height: 1100 },
    actionTimeout: 15_000, navigationTimeout: 30_000,
    headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: { executablePath: binary },
    permissions: [], serviceWorkers: 'block',
  },
  webServer: {
    command: `env -i PATH=${quote(`${dirname(node)}:/usr/bin:/bin`)} NODE_ENV=production VOICE_BACKEND=demo VOICE_AI_MODE=demo VOICE_APP_ORIGIN=http://127.0.0.1:3225 VOICE_DATA_DIR=${quote(data)} ${quote(node)} node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3225`,
    url: 'http://127.0.0.1:3225', reuseExistingServer: false, timeout: 60_000,
  },
});
