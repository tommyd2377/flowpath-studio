import { test, expect } from '@playwright/test';
import { WEBSITE_TEMPLATES } from '@thevoice/platform-ui/site-design';
import { createFixture, origin, post } from './website-fixtures';
import type { MediaLibrary } from '@thevoice/platform-ui/media';

test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

for (const index of [0, 1]) test(`${index ? 'services' : 'menu'}: priced photos stay bounded across templates`, async ({ page }, info) => {
  let site = await createFixture(page, index, { width: 1400, height: 1100 });
  const media = (await (await page.request.get(`/api/sites/${site.id}/media`)).json()).library as MediaLibrary;
  media.associations.push({ id: 'priced-photo', assetId: media.assets[0].id, targetType: 'entity', targetId: index ? 'identity' : 'table-small', role: 'example', primary: true });
  site = (await post(page, `/api/sites/${site.id}/media`, { revision: site.revision, library: media })).site;
  for (const template of ['editorial', 'showcase', 'clarity'] as const) {
    site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, style: { ...WEBSITE_TEMPLATES[template].defaults, websiteMotion: 'off', entry: 'website' } } })).site;
    site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
    await page.goto(`/s/${site.slug}`);
    const item = page.locator('.platform-content-card').filter({ has: page.locator('.platform-media-image') }).filter({ hasText: index ? 'Identity & art direction' : 'The shared table' }).first();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await item.scrollIntoViewIfNeeded();
      const image = item.locator('.platform-media-image');
      await expect(image).toBeInViewport();
      const bounds = (await image.boundingBox())!;
      expect(bounds.width).toBeLessThanOrEqual(165); expect(bounds.height).toBeLessThanOrEqual(165);
      expect((await item.boundingBox())!.height).toBeLessThan(460);
      await expect(item).toContainText(index ? '$1,200' : '$24');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`priced-${index}-${template}-${width}.png`) });
    }
  }
});

for (const image of [{ name: 'small-square', width: 331, height: 331 }, { name: 'portrait', width: 900, height: 1400 }, { name: 'landscape', width: 1600, height: 900 }]) test(`${image.name}: hero proportions stay balanced across templates`, async ({ page }, info) => {
  let site = await createFixture(page, 0, { width: image.width, height: image.height });
  for (const template of ['editorial', 'showcase', 'clarity'] as const) {
    site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, style: { ...WEBSITE_TEMPLATES[template].defaults, websiteMotion: 'off', entry: 'website' } } })).site;
    site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
    await page.goto(`/s/${site.slug}`);
    const hero = page.locator('.platform-website-hero'), copy = hero.locator('.platform-website-hero-copy'), photo = hero.locator('figure .platform-media-image');
    const banner = template === 'showcase' && image.name === 'landscape';
    await expect(hero).toHaveAttribute('data-hero-layout', banner ? 'banner' : 'split');
    for (const width of [1440, 1920, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.evaluate(async () => { (document.activeElement as HTMLElement)?.blur(); scrollTo(0, 0); await document.fonts.ready; });
      const heroBox = (await hero.boundingBox())!, copyBox = (await copy.boundingBox())!, photoBox = (await photo.boundingBox())!;
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(photoBox.height).toBeLessThanOrEqual(width === 390 ? 421 : 521);
      if (!banner) {
        expect(photoBox.width / photoBox.height).toBeCloseTo(image.width / image.height, 2);
        expect(photoBox.width).toBeLessThanOrEqual(image.width * 1.5 + 1);
        if (width > 760) {
          expect(photoBox.x).toBeGreaterThan(copyBox.x + copyBox.width);
          expect(heroBox.height).toBeLessThan(730);
        } else expect(photoBox.y).toBeGreaterThan(copyBox.y + copyBox.height);
      } else if (width > 760) {
        expect(photoBox.height).toBeLessThanOrEqual(361);
        expect(heroBox.height).toBeLessThan(830);
      }
      await expect.poll(() => photo.locator('img').evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
      if (width !== 1920) await page.screenshot({ path: info.outputPath(`hero-${image.name}-${template}-${width}.png`) });
    }
    await hero.getByRole('button', { name: 'Open A study in form 1', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});
