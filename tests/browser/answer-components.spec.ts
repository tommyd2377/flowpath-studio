import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { carouselFixture } from './helpers/carousel-fixture';

const availability = { enabled: true, mode: 'both', live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === 'http://127.0.0.1:3225' ? route.continue() : route.abort('blockedbyclient'));
});

test('rich answers, keyboard source disclosure, streaming, and lazy relationship selection', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/lab/answers');
  const answer = page.getByRole('article', { name: 'Answer preview' });
  await expect(answer.getByRole('table')).toBeVisible();
  await expect(answer.getByRole('columnheader', { name: 'Price' })).toHaveCSS('text-align', 'right');
  await expect(page.locator('.react-flow')).toHaveCount(0);
  const sources = answer.locator('summary'); await sources.focus(); await sources.press('Enter');
  await expect(answer.getByRole('link', { name: /Example workshop guide/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('answer-desktop.png'), fullPage: true });
  await answer.getByRole('button', { name: 'Preview streamed answer' }).click();
  await expect(answer.locator('[data-streaming=true]')).toBeVisible();
  await expect(answer.getByRole('button', { name: 'Preview streamed answer' })).toBeEnabled();
  await expect(answer.getByRole('row')).toHaveCount(4);
  await page.getByRole('button', { name: 'View relationship map' }).click();
  const map = page.getByRole('region', { name: 'Published relationship map' });
  await expect(map.locator('.react-flow__node')).toHaveCount(4);
  const teacher = map.getByRole('button', { name: 'person Taylor Lane' }); await teacher.focus(); await teacher.press('Enter');
  await expect(page.locator('.platform-diagram-detail')).toContainText('Fictional ceramics instructor.');
  await page.screenshot({ path: info.outputPath('relationship-map.png'), fullPage: true });
  await page.getByRole('button', { name: 'Bookshop', exact: true }).click();
  await expect(answer.getByRole('list').first()).toContainText('Choose a quiet corner.');
  await expect(page.locator('.platform-diagram-detail')).toContainText('The Imaginary Harbor');
  expect(errors).toEqual([]);
});

test('mobile light and dark answers keep native scrolling, readable sources and a relationship list', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/lab/answers');
  await expect(page.getByRole('button', { name: 'View relationship map' })).toBeHidden();
  await expect(page.getByRole('list', { name: 'Published relationships' })).toBeVisible();
  await page.locator('.platform-answer-sources summary').click();
  await expect(page.locator('.platform-answer-sources a')).toBeVisible();
  await page.screenshot({ path: info.outputPath('answer-mobile-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Dark palette' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Preview streamed answer' }).click();
  expect(await page.locator('.platform-rich-answer').evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(page.getByRole('button', { name: 'Preview streamed answer' })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('answer-mobile-dark.png'), fullPage: true });
});

for (const mobile of [false, true]) test(`published answers restore rich content through Back and Forward ${mobile ? 'on mobile' : 'on desktop'}`, async ({ page }, info) => {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 });
  const errors: string[] = [], requests: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const site = await carouselFixture(page);
  await page.route(/\/api\/visitor\/[^/]+\/tasks$/, async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'execute' && body.call.capabilityId === 'query.command') return route.fulfill({ json: { handled: false } });
    return route.fallback();
  });
  await page.route(/\/api\/visitor\/[^/]+\/session\/control$/, route => route.fulfill({ status: 204 }));
  await page.route(/\/api\/visitor\/[^/]+$/, async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { availability } });
    const { text } = route.request().postDataJSON(); requests.push(text);
    const answer = text === 'Compare the workshop options' ? '## A clearer comparison\n\n| Workshop | Duration | Price |\n| :--- | ---: | ---: |\n| Handbuilding | 90 minutes | $60 |\n| Wheel Skills | 120 minutes | $85 |\n\nBoth include **materials**. [Example guide](https://example.com/guide)'
      : '## Getting ready\n\n1. Choose a date.\n2. Bring a notebook.\n   - Leave room for sketches.\n3. Arrive a few minutes early.';
    const events = [{ type: 'control', control: { id: randomUUID(), token: 'a'.repeat(43) } },
      { type: 'navigation', id: randomUUID(), target: { kind: 'answer', text: answer, relationship: 'new-subject' } },
      { type: 'done', text: 'Ready.', displaySatisfied: true, availability }];
    await route.fulfill({ contentType: 'application/x-ndjson', body: events.map(event => JSON.stringify(event)).join('\n') + '\n' });
  });
  await page.goto(`/s/${site.slug}`); await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const surface = page.locator('[data-information-surface]'), input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  const ask = async (text: string) => {
    await input.fill(text); await input.press('Enter'); await expect(input).toHaveValue('');
    await expect(surface).toHaveAttribute('aria-busy', 'false'); await expect(surface).toHaveAttribute('data-workspace-transition', 'settled');
  };
  await ask('Compare the workshop options'); await expect(surface.getByRole('table')).toBeVisible();
  await page.screenshot({ path: info.outputPath('published-answer.png') });
  await ask('Help me prepare'); await expect(surface.getByRole('heading', { name: 'Getting ready' })).toBeVisible();
  await surface.getByRole('button', { name: 'Back to previous information' }).click(); await expect(surface.getByRole('table')).toBeVisible();
  await surface.getByRole('button', { name: 'Forward to next information' }).click(); await expect(surface.getByRole('heading', { name: 'Getting ready' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(requests).toEqual(['Compare the workshop options', 'Help me prepare']); expect(errors).toEqual([]);
});
