import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({ ...base, testMatch: 'paid.spec.ts', testIgnore: [],
  use: { ...base.use, baseURL: 'http://127.0.0.1:3226' },
  webServer: { ...base.webServer, command: 'FLOWPATH_LIVE_ENABLED=0 FLOWPATH_ACCOUNT_MODE=local FLOWPATH_PAID_FIXTURES=1 npm run dev -- --port 3226',
    url: 'http://127.0.0.1:3226' },
});
