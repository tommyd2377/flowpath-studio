import { chromium, defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Retain the project's dedicated cached test-browser fallback. Each launch
// uses an isolated Playwright profile, never a signed-in browser profile.
const executablePath = [chromium.executablePath(), join(homedir(), 'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')].find(existsSync);

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3225', browserName: 'chromium', launchOptions: { executablePath }, trace: 'retain-on-failure' },
  webServer: {
    command: 'FLOWPATH_LIVE_ENABLED=0 npm run dev -- --port 3225',
    url: 'http://127.0.0.1:3225',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
