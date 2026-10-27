import type { Page } from '@playwright/test';

const labels = {
  appearance: 'Appearance & voice', instructions: 'Instructions', plugins: 'Plugins',
  sharing: 'Sharing & usage', account: 'Account & tools',
} as const;

export async function settingsSection(page: Page, section: keyof typeof labels) {
  await page.getByRole('navigation', { name: 'Waveform settings' })
    .getByRole('button', { name: labels[section], exact: true }).click();
}
