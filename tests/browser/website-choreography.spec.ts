import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { WEBSITE_TEMPLATES, type WebsiteTemplate } from '@thevoice/platform-ui/site-design';
import { createFixture, origin, post } from './website-fixtures';

test.use({ video: 'on' });
test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

async function observeMotion(page: Page) {
  await page.addInitScript(() => {
    const samples: { selector: string; transform: string; clip: string; width: number }[] = [];
    (window as unknown as { websiteMotionSamples: typeof samples }).websiteMotionSamples = samples;
    const started = performance.now();
    const sample = () => {
      for (const selector of ['.platform-website-hero h1', '.platform-website-hero [data-website-frame]', '.platform-website-image-content', '.platform-website-section li[data-website-reveal]']) {
        for (const node of document.querySelectorAll<HTMLElement>(selector)) {
          const style = getComputedStyle(node);
          if ((style.transform !== 'none' || style.clipPath !== 'none') && samples.length < 800) samples.push({ selector, transform: style.transform, clip: style.clipPath, width: innerWidth });
        }
      }
      if (performance.now() - started < 10_000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

for (const [index, template] of (['editorial', 'showcase', 'clarity'] as const).entries()) test(`${template}: content-led composition and distinct motion on desktop and mobile`, async ({ page }, info) => {
  let site = await createFixture(page, index, undefined, undefined, 3);
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, style: { ...WEBSITE_TEMPLATES[template].defaults, entry: 'website' } } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await observeMotion(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto(`/s/${site.slug}`);
    const website = page.locator('[data-published-website]');
    await expect(website.getByRole('heading', { level: 1 })).toBeVisible();
    if (template === 'showcase') await website.locator('.platform-website-hero [data-website-frame]').evaluate(element => element.scrollIntoView({ block: 'center' }));
    if (template === 'clarity') await website.locator('.platform-website-section li').first().evaluate(element => element.scrollIntoView({ block: 'center' }));
    await expect.poll(async () => page.evaluate((kind: WebsiteTemplate) => {
      const samples = (window as unknown as { websiteMotionSamples: { selector: string; transform: string; clip: string }[] }).websiteMotionSamples;
      return samples.some(sample => {
        const matrix = new DOMMatrix(sample.transform);
        if (kind === 'editorial') return sample.selector === '.platform-website-hero h1' && matrix.e < -1 && sample.clip !== 'none';
        if (kind === 'showcase') return sample.selector === '.platform-website-image-content' && matrix.a > 1.002;
        return sample.selector.includes('section li') && matrix.a < .999 && matrix.a > .97;
      });
    }, template)).toBe(true);
    await page.waitForTimeout(1500);
    for (const image of await website.locator('img').all()) {
      await image.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
    }
    const gallery = website.locator('[data-section-kind=photos]');
    if (index !== 2) {
      await expect(gallery.locator('li')).toHaveCount(3);
      await expect.poll(() => gallery.locator('li').evaluateAll(elements => elements.every(element => getComputedStyle(element).transform === 'none'))).toBe(true);
      const boxes = await gallery.locator('li').evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }));
      if (width === 1440 && template === 'editorial') expect(boxes[0].height).toBeGreaterThan(boxes[1].height * 1.25);
      if (width === 1440 && template === 'showcase') expect(boxes[0].width, 'a portrait/square illustration must not be enlarged into a wide lead banner').toBeLessThan(boxes[1].width * 1.5);
      if (width === 390) expect(new Set(boxes.map(box => Math.round(box.x))).size).toBe(1);
    } else {
      await expect(gallery).toHaveCount(0);
      await expect(website.locator('.platform-website-hero figure')).toHaveCount(0);
    }
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (template === 'showcase' && width === 1440) await page.screenshot({ path: info.outputPath('showcase-desktop-hero-synthetic.png'), fullPage: false });
    await page.screenshot({ path: info.outputPath(`${template}-${width}.png`), fullPage: true });
    await writeFile(info.outputPath(`${template}-${width}-motion.json`), JSON.stringify(await page.evaluate(() => (window as unknown as { websiteMotionSamples: unknown }).websiteMotionSamples), null, 2));
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/s/${site.slug}`);
  await expect(page.locator('[data-published-website]')).toHaveAttribute('data-website-reduced', 'true');
  await expect(page.locator('.platform-website-hero h1')).toHaveCSS('transform', 'none');
  await expect(page.locator('.platform-website-hero h1')).toHaveCSS('clip-path', 'none');
  expect(await page.locator('.platform-website-image-content').evaluateAll(elements => elements.every(element => getComputedStyle(element).transform === 'none'))).toBe(true);
});

test('only an approved wide image receives a bounded Showcase gallery lead', async ({ page }, info) => {
  let site = await createFixture(page, 0, { width: 2200, height: 1000 }, undefined, 3);
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, style: { ...WEBSITE_TEMPLATES.showcase.defaults, entry: 'website' } } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`);
  const gallery = page.locator('[data-section-kind=photos]');
  await gallery.evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(1500);
  const cards = await gallery.locator('li').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
  expect(cards[0]).toBeGreaterThan(cards[1] * 1.8);
  const image = gallery.locator('li').first().locator('img');
  await expect(image).toHaveCSS('object-fit', 'contain');
  expect((await image.boundingBox())!.height).toBeLessThanOrEqual(445); // Includes the bounded depth transform.
  await page.screenshot({ path: info.outputPath('showcase-wide-gallery.png') });
});
