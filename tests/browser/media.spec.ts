import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import type { Site } from '../../lib/site-model';
import type { MediaLibrary } from '@thevoice/platform-ui/media';

const origin = 'http://127.0.0.1:3225';
let external: string[] = [];
let forbidden: string[] = [];
let applies: string[] = [];

test.beforeEach(async ({ context }) => {
  external = []; forbidden = []; applies = [];
  await context.route(/^https?:\/\//, route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== origin) { external.push(`${url.origin}${url.pathname}`); return route.abort('blockedbyclient'); }
    if (request.method() === 'POST' && /^\/api\/(visitor\/[^/]+|session(?:\/.*)?)$/.test(url.pathname)) {
      forbidden.push(url.pathname); return route.abort('blockedbyclient');
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/media/interpret') && request.postDataJSON()?.useVision) {
      forbidden.push('connected photo analysis'); return route.abort('blockedbyclient');
    }
    if (request.method() === 'POST' && /\/media$/.test(url.pathname)) applies.push(url.pathname);
    return route.continue();
  });
  await context.addInitScript(() => {
    const current = window as typeof window & { __mediaMicrophoneAttempts: number }; current.__mediaMicrophoneAttempts = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { current.__mediaMicrophoneAttempts++; throw new Error('No microphone in offline photo tests.'); };
  });
});

test.afterEach(async ({ page }) => {
  expect(external, 'No external browser requests.').toEqual([]);
  expect(forbidden, 'No visitor model calls or connected image analysis.').toEqual([]);
  expect(await page.evaluate(() => (window as typeof window & { __mediaMicrophoneAttempts?: number }).__mediaMicrophoneAttempts ?? 0)).toBe(0);
});

async function photo(name: string, color = '#945f49') {
  return { name, mimeType: 'image/png', buffer: await sharp({ create: { width: 640, height: 480, channels: 3, background: color } }).png().toBuffer() };
}

async function workspace(page: Page, label: string): Promise<Site> {
  const slug = `media-${label}-${Date.now()}`;
  const result = await page.request.post('/api/sites', { headers: { Origin: origin }, data: { name: `Offline ${label} photos`, slug, kind: 'photographer' } });
  expect(result.ok()).toBeTruthy(); const site: Site = (await result.json()).site;
  await page.goto('/');
  await page.getByLabel('Current site', { exact: true }).selectOption(site.id);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Files(?: \d+)?$/ }).click();
  await expect(page.getByRole('region', { name: 'Photo library' }).getByRole('button', { name: 'Add photos', exact: true })).toBeEnabled();
  return site;
}

async function currentSite(page: Page, id: string): Promise<Site> {
  const response = await page.request.get(`/api/sites/${id}`); expect(response.ok()).toBeTruthy(); return (await response.json()).site;
}

async function apply(page: Page, id: string): Promise<MediaLibrary> {
  const response = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/sites/${id}/media`);
  await page.getByRole('region', { name: 'Photo library' }).getByRole('button', { name: 'Apply to draft', exact: true }).click();
  const result = await response; const body = await result.json(); expect(result.ok(), JSON.stringify(body)).toBeTruthy(); return body.library;
}

test('batch photos work before knowledge, preserve review state, and publish only the applied library', async ({ page }, info) => {
  const site = await workspace(page, 'batch');
  const media = page.getByRole('region', { name: 'Photo library' });
  await media.getByLabel('Upload photos', { exact: true }).setInputFiles([await photo('wedding-detail.png'), await photo('portrait-detail.png', '#648197')]);
  await expect(media.locator('[data-media-asset]')).toHaveCount(2);
  await expect(media.getByRole('button', { name: 'Apply to draft', exact: true })).toBeEnabled();
  const firstId = (await currentSite(page, site.id)).files[0].id;
  expect(applies).toEqual([]);
  expect((await page.request.get(`/api/public-files/${site.slug}/${firstId}?size=thumb`)).status()).toBe(404);
  await media.getByLabel('Album title', { exact: true }).fill('Spring work');
  const first = media.locator('[data-media-asset]').first();
  await first.getByRole('button', { name: 'Edit photo details', exact: true }).click();
  const details = media.getByRole('region', { name: 'Photo details', exact: true });
  await details.getByLabel('Photo caption', { exact: true }).fill('Reviewed wedding detail');
  await details.getByRole('textbox', { name: /^Alternative text/ }).fill('A synthetic terracotta photo fixture.');
  await details.getByLabel('Photo credit', { exact: true }).fill('Offline fixture');
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Branding', exact: true }).click();
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Files(?: \d+)?$/ }).click();
  await expect(details.getByLabel('Photo caption', { exact: true })).toHaveValue('Reviewed wedding detail');
  await expect(media.getByLabel('Album title', { exact: true })).toHaveValue('Spring work');
  await expect(page.locator('.publish-button')).toBeDisabled();
  await media.getByLabel('What should we know about these photos?', { exact: true }).fill('These are example photos for Wedding stories.');
  const suggestion = page.waitForResponse(response => response.url().endsWith('/media/interpret'));
  await media.getByRole('button', { name: 'Suggest connections', exact: true }).click();
  const proposed = await suggestion; expect(proposed.ok()).toBeTruthy();
  expect((await proposed.json()).mode).toBe('local');
  await expect(media.locator('.media-photo-caption').first()).toContainText('Example · Wedding stories');
  await media.getByRole('combobox', { name: 'Connect selected photos to', exact: true }).selectOption('section:portraits');
  await media.getByRole('combobox', { name: 'These photos are', exact: true }).selectOption('depicts');
  await media.getByRole('button', { name: 'Connect selected photos', exact: true }).click();
  await details.locator('.media-connection').filter({ hasText: 'Actual photo' }).getByRole('button', { name: 'Use as lead photo', exact: true }).click();
  await media.locator('[data-media-asset]').nth(1).getByRole('button', { name: 'Make cover', exact: true }).click();
  await media.getByRole('button', { name: 'Move portrait-detail.png earlier', exact: true }).click();
  await media.getByText('Organize selected photos', { exact: true }).click();
  await media.getByRole('button', { name: 'Use note as album description', exact: true }).click();
  const library = await apply(page, site.id);
  expect(library.assets).toHaveLength(2); expect(library.albums[0].title).toBe('Spring work');
  expect(library.albums[0].coverAssetId).toBe(library.albums[0].assetIds[0]);
  expect(library.associations.filter(item => item.targetId === 'weddings' && item.role === 'example')).toHaveLength(2);
  expect(library.associations.find(item => item.assetId === firstId && item.targetId === 'portraits')?.primary).toBe(true);
  expect(applies).toHaveLength(1);
  expect((await page.request.get(`/api/public-files/${site.slug}/${firstId}?size=thumb`)).status()).toBe(404);
  const previewBrowse = page.getByRole('button', { name: 'Browse published content', exact: true });
  if (await previewBrowse.count()) await previewBrowse.click();
  await expect(page.getByRole('region', { name: 'Website preview' }).getByRole('region', { name: 'Browse approved information' })).toContainText('Spring work');
  await page.locator('.publish-button').click();
  await page.getByRole('button', { name: 'Publish locally', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Published locally.' })).toBeVisible();
  const published = await currentSite(page, site.id);
  expect(published.published?.mediaRevisionId).toBe(published.draft.mediaRevisionId);
  const publicPhoto = await page.request.get(`/api/public-files/${site.slug}/${firstId}?size=thumb`);
  expect(publicPhoto.ok()).toBeTruthy(); expect(publicPhoto.headers()['content-type']).toContain('image/webp');
  await details.getByLabel('Photo caption', { exact: true }).fill('Unapplied caption');
  await expect(page.locator('.publish-button')).toBeDisabled();
  await media.getByRole('button', { name: 'Discard photo changes', exact: true }).click();
  await page.goto(`/s/${site.slug}`);
  const publicBrowse = page.getByRole('button', { name: 'Browse published content', exact: true });
  if (await publicBrowse.count()) await publicBrowse.click();
  const sectionPhoto = page.getByRole('button', { name: 'Explore the photo for Portrait sessions', exact: true }).locator('img');
  await expect(sectionPhoto).toBeVisible();
  expect(await sectionPhoto.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(100);
  expect(await sectionPhoto.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(80);
  const gallery = page.getByRole('region', { name: 'Browse approved information', exact: true });
  await expect(gallery).toContainText('Reviewed wedding detail');
  await expect(gallery).not.toContainText('Unapplied caption');
  const opener = gallery.getByRole('button', { name: 'Open Reviewed wedding detail', exact: true });
  await opener.click();
  const lightbox = page.locator('[data-workspace-focused]:not([inert])'); await expect(lightbox).toBeVisible();
  await expect(lightbox).toContainText('Offline fixture');
  await page.keyboard.press('Escape'); await expect(lightbox).not.toBeVisible();
  await expect(opener).toBeFocused();
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity));
  await page.screenshot({ path: info.outputPath('published-photo-albums.png'), fullPage: true });
});

test('folders become editable albums and group actions keep library removal distinct', async ({ page }, info) => {
  const site = await workspace(page, 'folders');
  const root = await mkdtemp(join(tmpdir(), 'thevoice-media-fixtures-'));
  const directory = join(root, 'Photo collection');
  await mkdir(join(directory, 'Weddings'), { recursive: true }); await mkdir(join(directory, 'Portraits'));
  await writeFile(join(directory, 'Weddings', 'detail.png'), (await photo('detail.png')).buffer);
  await writeFile(join(directory, 'Portraits', 'IMG0001.png'), (await photo('IMG0001.png', '#547565')).buffer);
  const media = page.getByRole('region', { name: 'Photo library' });
  await media.getByLabel('Upload a photo folder', { exact: true }).setInputFiles(directory);
  await expect(media.locator('[data-media-asset]')).toHaveCount(2);
  await expect(media.getByRole('navigation', { name: 'Photo albums' })).toContainText('Photo collection / Weddings');
  await expect(media.getByRole('navigation', { name: 'Photo albums' })).toContainText('Photo collection / Portraits');
  await expect(media.locator('.media-photo-caption')).not.toContainText(['IMG0001']);
  await media.getByText('Organize selected photos', { exact: true }).click();
  await media.getByRole('button', { name: 'Create album from selection', exact: true }).click();
  await media.getByLabel('Album title', { exact: true }).fill('Selected work');
  await media.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await media.locator('[data-media-asset]').first().getByRole('checkbox').check();
  await media.getByRole('button', { name: 'Remove from this album', exact: true }).click();
  await expect(media.locator('[data-media-asset]')).toHaveCount(1);
  await media.getByRole('navigation', { name: 'Photo albums' }).getByRole('button', { name: 'All photos', exact: true }).click();
  await expect(media.locator('[data-media-asset]')).toHaveCount(2);
  await media.getByRole('button', { name: 'Select all', exact: true }).click();
  await media.getByText('Organize selected photos', { exact: true }).click();
  await media.getByRole('combobox', { name: 'Destination album', exact: true }).selectOption({ label: 'Selected work' });
  await media.getByRole('button', { name: 'Add to album', exact: true }).click();
  await expect(media.locator('[data-media-asset]')).toHaveCount(2);
  const saved = await apply(page, site.id); expect(saved.albums).toHaveLength(3);
  await media.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await media.locator('[data-media-asset]').first().getByRole('checkbox').check();
  await media.getByRole('button', { name: 'Remove from photo library', exact: true }).click();
  const reduced = await apply(page, site.id); expect(reduced.assets).toHaveLength(1);
  expect((await currentSite(page, site.id)).files).toHaveLength(2);
  await expect(media.getByText('Add from uploaded files (1)', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('folder-album-review.png'), fullPage: true });
});

test('a partial upload retains earlier photo edits and completed files, including on mobile', async ({ page }, info) => {
  const site = await workspace(page, 'partial');
  const media = page.getByRole('region', { name: 'Photo library' });
  await media.getByLabel('Upload photos', { exact: true }).setInputFiles(await photo('first.png'));
  await expect(media.locator('[data-media-asset]')).toHaveCount(1);
  await media.locator('[data-media-asset]').getByRole('button', { name: 'Edit photo details', exact: true }).click();
  await media.getByLabel('Photo caption', { exact: true }).fill('Keep this reviewed caption');
  await media.getByLabel('Upload photos', { exact: true }).setInputFiles([await photo('second.png', '#896349'), { name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not a real image') }]);
  await expect(media.getByRole('alert')).toContainText('1 file(s) saved.');
  await expect(media.locator('[data-media-asset]')).toHaveCount(2);
  await expect(media.getByLabel('Photo caption', { exact: true })).toHaveValue('Keep this reviewed caption');
  expect(applies).toEqual([]);
  expect((await currentSite(page, site.id)).files).toHaveLength(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await media.getByRole('button', { name: 'Close photo details', exact: true }).click();
  await media.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(media.locator('[data-media-asset]')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await media.locator('.media-grid').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => (document.querySelector('.sidebar')?.getBoundingClientRect().right ?? 0) <= 0.5);
  await page.screenshot({ path: info.outputPath('mobile-photo-review.png'), fullPage: true });
  const library = await apply(page, site.id);
  expect(library.assets.find(asset => asset.caption === 'Keep this reviewed caption')).toBeTruthy();
});
