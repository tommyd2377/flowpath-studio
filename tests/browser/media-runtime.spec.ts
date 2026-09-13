import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Site } from '../../lib/site-model';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';

const origin = 'http://127.0.0.1:3225';
async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post(path, { headers: { Origin: origin }, data });
  const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); return body;
}

async function prepare(page: Page, fixture: string) {
  let site: Site = (await post(page, '/api/sites', { name: `Offline ${fixture} photos`, slug: `photo-${fixture}-${Date.now()}`, kind: 'general' })).site;
  async function upload(name: string, contentType: string, bytes: Buffer) {
    const response = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': contentType, 'X-File-Name': name, 'X-Site-Revision': String(site.revision) }, data: bytes });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); site = body.site; return body.fileId as string;
  }
  const fileId = await upload(`${fixture}.csv`, 'text/csv', await readFile(`fixtures/source-packs/${fixture}.csv`));
  const knowledgePath = `/api/sites/${site.id}/knowledge`;
  const review = await post(page, knowledgePath, { action: 'analyze', revision: site.revision, fileId, requestId: randomUUID() });
  const applied = await post(page, knowledgePath, { action: 'apply', revision: site.revision, candidateId: review.candidates[0].id });
  site = applied.site; const catalog: KnowledgeCatalog = applied.catalog;
  const ids: string[] = [];
  for (const [index, color] of ['#af7860', '#698aa0', '#bdaf78'].entries()) {
    ids.push(await upload(`photo-${index}.png`, 'image/png', await sharp({ create: { width: index === 2 ? 480 : 960, height: index === 2 ? 960 : 640, channels: 3, background: color } }).png().toBuffer()));
  }
  const library: MediaLibrary = { schemaVersion: 1, id: randomUUID(),
    assets: ids.map((id, index) => ({ id, width: site.files.find(file => file.id === id)!.image!.width, height: site.files.find(file => file.id === id)!.image!.height,
      caption: `${fixture} ${index === 2 ? 'illustrative example' : `actual photo ${index + 1}`}`, alt: `Synthetic ${fixture} test image ${index + 1}` })),
    albums: [{ id: 'published-album', title: `${fixture} album`, description: 'Publisher chosen order', assetIds: [ids[1], ids[0], ids[2]], coverAssetId: ids[1] }],
    associations: ids.map((assetId, index) => ({ id: randomUUID(), assetId, targetType: 'entity', targetId: catalog.entities[index === 1 ? 1 : 0].id, role: index === 2 ? 'example' : 'depicts', primary: index !== 2 })),
  };
  const media = await post(page, `/api/sites/${site.id}/media`, { revision: site.revision, library }); site = media.site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, visitor: { ...site.draft.visitor!, enabled: true, mode: 'chat' } } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  return { site, catalog, ids, library: media.library as MediaLibrary };
}

for (const fixture of ['classes', 'bookstore']) test(`${fixture}: contextual card photos, manual galleries, typed requests and mobile viewer share approved media`, async ({ page, context }, info) => {
  const external: string[] = []; const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort('blockedbyclient'); }
    if (url.pathname.endsWith('/media/interpret')) return route.abort('blockedbyclient');
    return route.continue();
  });
  const { site, catalog, ids, library } = await prepare(page, fixture);
  await page.goto(`/s/${site.slug}`);
  await expect(page.getByRole('button', { name: 'Browse published content', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Browse published content', exact: true }).click();
  const explorer = page.getByRole('region', { name: 'Browse approved information' });
  const firstCard = explorer.getByRole('button', { name: `Open ${catalog.entities[0].name}`, exact: true });
  await expect(firstCard.locator('img')).toHaveCount(1);
  await expect(firstCard.locator('img')).toHaveAttribute('src', new RegExp(ids[0]));
  await expect(explorer.getByRole('button', { name: `Open ${catalog.entities[1].name}`, exact: true }).locator('img')).toHaveAttribute('src', new RegExp(ids[1]));
  await expect(explorer.getByRole('button', { name: `Open ${catalog.entities[2].name}`, exact: true }).locator('img')).toHaveCount(0);
  const imageLoaded = await firstCard.locator('img').evaluate(async (image: HTMLImageElement) => { await image.decode(); return image.naturalWidth > 0; });
  expect(imageLoaded).toBe(true);
  await expect(firstCard).not.toContainText('Take a closer look');
  await page.screenshot({ path: info.outputPath(`${fixture}-photo-cards.png`), fullPage: true });
  await firstCard.click();
  const focused = page.locator('[data-workspace-focused]:not([inert])');
  await expect(focused.locator('img')).toHaveCount(2);
  await expect(focused).toContainText('Example photo');
  await focused.getByRole('button', { name: 'Back to workspace', exact: true }).click();
  await expect(focused).toHaveCount(0);

  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill(`Show me photos of ${catalog.entities[0].name}`);
  await page.getByRole('button', { name: 'Show me', exact: true }).click();
  const photos = page.locator('.platform-workspace-card[data-workspace-component="photo"]');
  await expect(photos).toHaveCount(2);
  await expect(photos.nth(1)).toContainText('Example photo');
  await expect(photos.nth(1).locator('img')).toHaveAttribute('src', new RegExp(ids[2]));
  await expect(page.locator('.platform-workspace-card[data-workspace-component="detail"]')).toHaveCount(1);

  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize({ width: 390, height: 844 });
  const open = photos.nth(1).getByRole('button', { name: `Open ${fixture} illustrative example`, exact: true });
  await open.click(); const viewer = focused;
  await expect(viewer).toBeVisible();
  await expect(page.locator('.platform-workspace [data-voice-focus-open="true"]')).toHaveAttribute('data-voice-focus-kind', 'photo');
  await expect(page.locator('.platform-workspace [data-voice-focus-open="true"]')).toHaveAttribute('data-voice-focus-id', ids[2]);
  await expect(viewer.locator('img')).toHaveAttribute('src', new RegExp(ids[2]));
  const displayedPhoto = await viewer.locator('img').evaluate(async (image: HTMLImageElement) => {
    await image.decode(); const bounds = image.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, naturalWidth: image.naturalWidth };
  });
  expect(displayedPhoto.naturalWidth).toBeGreaterThan(0);
  expect(displayedPhoto.width).toBeGreaterThan(100);
  expect(displayedPhoto.height).toBeGreaterThan(100);
  await expect(viewer).toContainText('Example photo');
  await expect.poll(() => viewer.evaluate(element => { const rect = element.getBoundingClientRect(); return rect.top >= -2 && rect.bottom <= innerHeight; })).toBe(true);
  await page.screenshot({ path: info.outputPath(`${fixture}-photo-mobile.png`) });
  // An observation follows the settled browser acknowledgment, not an intent.
  await expect.poll(async () => { const activity = await page.request.get(`/api/sites/${site.id}/events`); return (await activity.json()).activity.events.some((event: { kind?: string; assetId?: string; snapshotId?: string }) => event.kind === 'photo_view' && event.assetId === ids[2] && event.snapshotId === library.id); }).toBeTruthy();
  await page.keyboard.press('Escape'); await expect(viewer).not.toBeVisible(); await expect(open).toBeFocused();
  // Check during the retained exit, then after it settles. A desktop exit may
  // keep its old width, but must never enlarge the mobile page's scroll area.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(explorer.locator('[inert]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(external).toEqual([]); expect(errors).toEqual([]);
});
