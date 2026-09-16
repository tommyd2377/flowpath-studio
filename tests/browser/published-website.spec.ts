import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Site } from '../../lib/site-model';
import { semanticFixture } from '../../fixtures/semantic-knowledge/graph';
import { DEFAULT_OPENING } from '../../lib/site-opening';
import { DEFAULT_EXPLORE_SETTINGS, demoExploreResult } from '../../lib/explore-model';

const origin = 'http://127.0.0.1:3225';
async function fixture(page: Page, generalPhotos = false, websiteFirst = false) {
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { headers: { Origin: origin }, data });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body;
  };
  let site: Site = (await post('/api/sites', { name: 'Harbor Journal', slug: `website-${Date.now()}`, kind: 'general' })).site;
  const upload = async (name: string, mime: string, data: Buffer) => {
    const response = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': mime, 'X-File-Name': name, 'X-Site-Revision': String(site.revision) }, data });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); site = body.site; return body.fileId as string;
  };
  const fileId = await upload('synthetic-guide.txt', 'text/plain', await readFile('fixtures/semantic-knowledge/business.txt'));
  let review = await post(`/api/sites/${site.id}/knowledge`, { action: 'analyze', revision: site.revision, fileId, requestId: randomUUID() });
  const graph = structuredClone(semanticFixture); graph.id = review.candidates[0].catalog.id;
  graph.name = 'An invitation to slow down.'; graph.description = 'Meet the makers, discover workshops, and explore objects shaped by hand. A collection of stories from Harbor Studio.';
  graph.entities.find(entity => entity.id === 'blue')!.summary = 'A soft blue glaze, an open shape, and room for everyday rituals.';
  graph.entities.push({ ...graph.entities.find(entity => entity.id === 'blue')!, id: 'blue-other-source', summary: 'A second published description, with a different price.', attributes: { price: 40 } });
  graph.collections.push({ id: 'overlap', name: 'Another selection', entityIds: ['blue-other-source', 'white'] });
  review = await post(`/api/sites/${site.id}/knowledge`, { action: 'revise', revision: site.revision, candidateId: review.candidates[0].id, catalog: graph });
  site = (await post(`/api/sites/${site.id}/knowledge`, { action: 'apply', revision: site.revision, candidateId: review.candidates[0].id })).site;
  const ids: string[] = [];
  const colors = generalPhotos ? ['#698ca1', '#c1a782', '#859982', '#94a1bf', '#b68778', '#647980', '#ac9772', '#547a68', '#c4a8b2'] : ['#698ca1', '#c1a782', '#859982'];
  for (const [index, color] of colors.entries()) {
    // Test-only illustration; no external images or model calls.
    const svg = `<svg width="900" height="680" xmlns="http://www.w3.org/2000/svg"><rect width="900" height="680" fill="${color}"/><ellipse cx="450" cy="520" rx="270" ry="55" fill="#243636" opacity=".15"/><path d="M220 275 Q450 720 680 275Z" fill="#ede5d5"/><ellipse cx="450" cy="275" rx="230" ry="70" fill="#e2d6bf"/><ellipse cx="450" cy="275" rx="197" ry="48" fill="${color}"/></svg>`;
    ids.push(await upload(`illustration-${index}.png`, 'image/png', await sharp(Buffer.from(svg)).png().toBuffer()));
  }
  site = (await post(`/api/sites/${site.id}/media`, { revision: site.revision, library: { schemaVersion: 1, id: randomUUID(),
    assets: ids.map((id, index) => ({ id, width: 900, height: 680, caption: `Studio study ${index + 1}`, alt: `Synthetic ceramic bowl illustration ${index + 1}`, credit: 'Local test illustration' })),
    albums: [{ id: 'studies', title: 'Studio studies', description: 'An illustrated collection.', assetIds: ids }],
    associations: ids.map((assetId, index) => ({ id: `association-${index}`, assetId, ...(generalPhotos ? { targetType: 'site' } : { targetType: 'entity', targetId: index === 1 ? 'white' : 'blue' }), role: 'example', primary: index === 0 })),
  } })).site;
  site = (await post(`/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft,
    contact: 'hello@harbor.example', hours: 'Tuesday–Sunday, 10am–5pm', style: { layout: 'editorial', palette: 'parchment', ...(websiteFirst ? { entry: 'website' } : {}) },
    opening: { ...DEFAULT_OPENING, initialAssetIds: [ids[0]], visibility: 'intro-only' },
    sections: [{ id: 'story', title: 'Made with time and intention.', body: 'A small studio with a generous spirit. Explore a practice grounded in material, place, and the people who make it their own.' }],
    visitorSpeaksFirst: true, visitor: { ...site.draft.visitor, enabled: true, mode: 'voice' }, explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled: true, annotations: true },
  } })).site;
  site = (await post(`/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`); return site;
}
const focus = (page: Page) => page.locator('[data-workspace-focused]:not([inert])');
async function ask(page: Page, value: string) {
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill(value); await input.press('Enter');
}

test('website-first pages keep the voice control visible while browsing on desktop and mobile', async ({ page }, info) => {
  const providerRequests: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/visitor\//.test(request.url()) && !/\/tasks(?:\/|$)/.test(request.url())) providerRequests.push(request.url());
  });
  await fixture(page, false, true);
  const wave = page.getByRole('button', { name: 'Preview voice', exact: true });
  const website = page.locator('[data-published-website]');
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: viewport.width === 390 ? 'reduce' : 'no-preference' });
    await expect(wave).toBeVisible();
    await expect(wave).toBeEnabled();
    await expect(wave).toBeInViewport();
    await expect(page.locator('[data-voice-dock] canvas')).toBeVisible();
    await website.getByText('hello@harbor.example', { exact: true }).scrollIntoViewIfNeeded();
    await expect(wave).toBeInViewport();
    await wave.focus();
    await expect(wave).toBeFocused();
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'What would you like to see?', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Voice', exact: true }).click();
    await expect(wave).toBeVisible();
    await expect(wave).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`website-voice-${viewport.width}.png`) });
  }
  expect(providerRequests).toEqual([]);
});

test('site photos appear between content sections on desktop and mobile without adding repeated navigation', async ({ page }, info) => {
  await fixture(page, true);
  await page.getByRole('button', { name: 'Browse published content', exact: true }).click();
  const website = page.locator('[data-published-website]');
  await expect(website).toBeVisible();
  const sections = website.locator('.platform-website-section');
  await expect(sections.nth(1)).toHaveAttribute('data-section-kind', 'photos');
  await expect(sections.nth(2)).not.toHaveAttribute('data-section-kind', 'photos');
  await expect(sections.nth(1).locator('img')).toHaveCount(4);
  await expect(sections.nth(1).getByText('Example photo', { exact: true })).toHaveCount(4);
  const navigation = website.getByRole('navigation', { name: 'Website navigation' });
  await navigation.locator('summary').click();
  await expect(navigation.getByRole('link', { name: 'Studio studies', exact: true })).toHaveCount(1);
  await navigation.locator('summary').click();
  await sections.nth(1).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('distributed-photos-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await sections.nth(1).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath('distributed-photos-mobile.png') });
});

test('full website, distinct same-name records, published footer, photos and Home work on desktop and mobile', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await fixture(page); await page.setViewportSize({ width: 1440, height: 1000 });
  let paid = 0; page.on('request', request => { if (request.method() === 'POST' && /\/api\/visitor\/[^/]+(?:\/explore)?$/.test(request.url())) paid++; });
  await page.getByRole('button', { name: 'Browse published content', exact: true }).click();
  const website = page.getByRole('region', { name: 'Browse approved information' });
  await expect(website.getByRole('navigation', { name: 'Website navigation' })).toBeVisible();
  await expect(website.getByRole('heading', { name: 'An invitation to slow down.' })).toBeVisible();
  await expect(website.getByRole('button', { name: 'Open Blue Bowl', exact: true })).toHaveCount(1);
  await website.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('website-desktop.png') });
  await website.getByRole('button', { name: 'Open Blue Bowl', exact: true }).click();
  const results = website.getByRole('region', { name: 'Website content', exact: true });
  await expect(results.getByRole('status')).toHaveText('2 matching items');
  await results.getByRole('button', { name: 'Open Blue Bowl', exact: true }).first().click();
  await expect(results.getByRole('region', { name: 'Record detail' })).toContainText('35');
  await results.getByRole('button', { name: 'Back to results' }).click();
  await results.getByRole('button', { name: 'Open Blue Bowl', exact: true }).nth(1).click();
  await expect(results.getByRole('region', { name: 'Record detail' })).toContainText('40');
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  await expect(focus(page)).toHaveCount(0); await expect(website).toHaveCount(0); await expect(page.locator('.platform-workspace-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Browse published content', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await website.getByRole('heading', { name: 'An invitation to slow down.' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('website-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await website.getByText('hello@harbor.example', { exact: true }).scrollIntoViewIfNeeded();
  await expect(website.getByText('Tuesday–Sunday, 10am–5pm', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('website-footer-mobile.png') });
  await website.getByRole('button', { name: 'Open Studio study 2', exact: true }).click();
  await expect(focus(page)).toHaveAttribute('data-workspace-transition', 'settled');
  await focus(page).getByRole('button', { name: 'Open photo: Studio study 2' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(website).toHaveCount(0); await expect(focus(page)).toHaveCount(0);
  expect(paid).toBe(0); expect(errors).toEqual([]);
});

test('voice-preferred sites expose typing; Home, searches and local navigation survive exhausted chat allowance', async ({ page }) => {
  const site = await fixture(page);
  await page.route(`**/api/visitor/${site.slug}`, route => route.fulfill({ json: { availability: { enabled: true, mode: 'voice', live: false, chatRemaining: 0, voiceRemaining: 5, resetsAt: '' } } }));
  let searches = 0, chats = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/api/visitor/${site.slug}`)) chats++; });
  await page.route(`**/api/visitor/${site.slug}/explore`, async route => {
    const input = route.request().postDataJSON(); searches++;
    await route.fulfill({ json: { result: { ...demoExploreResult(input.query, input.kind), id: `result-${searches}` } } });
  });
  await page.reload(); await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await ask(page, 'Open Harbor Studio'); await expect(page.getByRole('region', { name: 'Record detail' })).toContainText('12 Example Lane');
  await ask(page, 'Expand an image search online about ceramics');
  await expect(focus(page).getByRole('button', { name: /Open image 2:/ })).toBeVisible();
  await ask(page, 'Expand image A2'); await expect(page.getByRole('dialog', { name: 'Web image viewer' })).toBeVisible();
  expect(searches).toBe(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.platform-workspace-card')).toHaveCount(0);
  for (let index = 0; index < 7; index++) {
    await ask(page, `Search the web for ceramics ${index}`);
    await expect(focus(page).getByRole('heading', { name: `Search the web for ceramics ${index}`, exact: true })).toBeVisible();
  }
  await expect(page.locator('.platform-workspace-card[data-workspace-component="external"]')).toHaveCount(6);
  await expect(page.getByText('Search the web for ceramics 0', { exact: true })).toHaveCount(0);
  await ask(page, 'Take me back to the main page');
  await expect(page.locator('.platform-workspace-card')).toHaveCount(0);
  await ask(page, 'Show me the full website'); await expect(page.locator('[data-published-website]')).toBeVisible();
  await ask(page, 'Search for White Bowl');
  await expect(page.getByRole('region', { name: 'Website content', exact: true })).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('region', { name: 'Website content', exact: true }).getByRole('status')).toHaveText('1 matching item');
  await page.getByRole('button', { name: 'Open White Bowl', exact: true }).scrollIntoViewIfNeeded();
  await ask(page, 'Open the first one'); await expect(page.getByRole('region', { name: 'Record detail' })).toContainText('White Bowl');
  await ask(page, 'Start over'); await expect(page.locator('[data-published-website]')).toHaveCount(0);
  expect(searches).toBe(8); expect(chats).toBe(0);
});
