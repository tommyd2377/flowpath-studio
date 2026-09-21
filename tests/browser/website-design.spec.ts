import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { WEBSITE_TEMPLATES, type WebsiteMotion, type WebsiteTemplate } from '@thevoice/platform-ui/site-design';
import type { Site } from '../../lib/site-model';
import { createFixture, origin, post, read, studio } from './website-fixtures';

test.use({ video: 'on' });
test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});
async function publish(page: Page, site: Site, template: WebsiteTemplate, websiteMotion: WebsiteMotion = 'expressive', assistant = false) {
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, visitor: { ...site.draft.visitor, enabled: assistant, mode: 'chat' }, style: { ...WEBSITE_TEMPLATES[template].defaults, websiteMotion, entry: 'website' } } })).site;
  return (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site as Site;
}
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1400); // Covers the longest finite website entrance, including its bounded stagger.
}

for (const [index, template] of (['editorial', 'showcase', 'clarity'] as const).entries()) test(`${template}: scrolling sequences, tablet, large desktop and mobile`, async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let site = await createFixture(page, index === 2 ? 0 : index);
  site = await publish(page, site, template);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`/s/${site.slug}`); await settled(page);
  const website = page.locator('[data-published-website]');
  await expect(website).toHaveAttribute('data-website-motion', 'expressive');
  for (const photo of await website.locator('img').all()) { await photo.scrollIntoViewIfNeeded(); await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true); }
  await page.evaluate(() => scrollTo(0, 0)); await settled(page);
  await page.screenshot({ path: info.outputPath(`${template}-desktop.png`), fullPage: true });
  const firstSection = website.locator('.platform-website-section').first();
  await page.evaluate(() => {
    const state = { frames: [] as number[], longTasks: [] as number[], shifts: 0, last: performance.now(), recording: true };
    (window as unknown as { websitePerformance: typeof state }).websitePerformance = state;
    new PerformanceObserver(list => { state.longTasks.push(...list.getEntries().map(entry => entry.duration)); }).observe({ type: 'longtask', buffered: false });
    new PerformanceObserver(list => { for (const entry of list.getEntries()) { const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean }; if (!shift.hadRecentInput) state.shifts += shift.value; } }).observe({ type: 'layout-shift', buffered: false });
    const frame = (now: number) => { state.frames.push(now - state.last); state.last = now; if (state.recording) requestAnimationFrame(frame); }; requestAnimationFrame(frame);
  });
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 220); await page.waitForTimeout(130); }
  await firstSection.scrollIntoViewIfNeeded(); await settled(page);
  await expect(firstSection.locator('[data-website-reveal]').first()).toHaveAttribute('data-website-revealed', 'true');
  await page.screenshot({ path: info.outputPath(`${template}-sections.png`) });
  const faq = website.locator('.platform-website-faq summary').first();
  if (await faq.count()) {
    await faq.scrollIntoViewIfNeeded(); await faq.focus(); await page.keyboard.press('Enter');
    await expect(faq.locator('..')).toHaveAttribute('open', ''); await page.waitForTimeout(300);
    await page.keyboard.press('Enter'); await expect(faq.locator('..')).not.toHaveAttribute('open', '');
  }
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(120); }
  const measurements = await page.evaluate(() => {
    const state = (window as unknown as { websitePerformance: { frames: number[]; longTasks: number[]; shifts: number; recording: boolean } }).websitePerformance;
    state.recording = false;
    const frames = state.frames.slice(1).sort((a, b) => a - b);
    return { samples: frames.length, medianFrameMs: frames[Math.floor(frames.length * .5)], p95FrameMs: frames[Math.floor(frames.length * .95)], longTasks: state.longTasks, layoutShift: state.shifts };
  });
  await writeFile(info.outputPath(`${template}-performance.json`), JSON.stringify(measurements, null, 2));
  // Reveals do not replay when previously seen content crosses the viewport again.
  await firstSection.scrollIntoViewIfNeeded(); await page.waitForTimeout(80);
  expect(await firstSection.locator('[data-website-reveal]').first().evaluate(node => getComputedStyle(node).transform)).toBe('none');
  for (const width of [1920, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 768 ? 1080 : 844 }); await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); scrollTo(0, 0); }); await settled(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${template} at ${width}`).toBe(true);
    if (template === 'showcase' && width <= 390) {
      const price = website.locator('[data-collection-layout=services] .platform-website-price');
      await expect(price).toHaveText('PriceFrom $1,200 · scope agreed after an initial conversation');
      const bounds = await price.boundingBox(); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await expect(price).toHaveCSS('grid-column-start', '2');
    }
    if (width === 390 || width === 1920 || width === 768) await page.screenshot({ path: info.outputPath(`${template}-${width === 390 ? 'mobile' : width}.png`), fullPage: true });
  }
  const menu = website.locator('.platform-website-mobile-nav'); await menu.locator('summary').click();
  await menu.getByRole('link').first().click(); await expect(menu).not.toHaveAttribute('open', '');
  await expect(firstSection).toBeFocused();
  expect(errors).toEqual([]);
});

test('selected image tracking is modest, stops offscreen, and reduced motion overrides it immediately', async ({ page }) => {
  let site = await createFixture(page, 0); site = await publish(page, site, 'showcase');
  await page.goto(`/s/${site.slug}`); await settled(page);
  const frame = page.locator('.platform-website-hero [data-website-depth]'), image = frame.locator('img');
  await expect(frame).toHaveAttribute('data-website-tracking', 'true');
  const before = await image.evaluate(element => getComputedStyle(element).transform);
  await page.mouse.wheel(0, 210); await page.waitForTimeout(180);
  expect(await image.evaluate(element => getComputedStyle(element).transform)).not.toBe(before);
  const bounds = await image.evaluate(element => { const m = new DOMMatrix(getComputedStyle(element).transform); return { scale: m.a, travel: Math.abs(m.f) / element.getBoundingClientRect().height }; });
  expect(bounds.scale).toBeCloseTo(1.05, 2); expect(bounds.travel).toBeLessThan(.023);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(frame).toHaveAttribute('data-website-tracking', 'false');
  await page.evaluate(() => scrollTo(0, 0)); await expect(frame).toHaveAttribute('data-website-tracking', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(frame).toHaveAttribute('data-website-tracking', 'false');
  await expect(image).toHaveCSS('transform', 'none');
  await expect(frame).toHaveCSS('clip-path', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await expect(frame).toHaveAttribute('data-website-tracking', 'true');
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(frame).toHaveAttribute('data-website-tracking', 'false'); await expect(image).toHaveCSS('transform', 'none');
  }
});

test('Branding previews actual content, saves motion independently and keeps publication separate', async ({ page }, info) => {
  let site = await createFixture(page, 0); site = await publish(page, site, 'showcase', 'subtle');
  const publication = structuredClone(site.published), original = { ...site.draft, style: undefined };
  await studio(page, site);
  const control = page.getByRole('combobox', { name: 'Scrolling & transitions', exact: true });
  const preview = page.locator('.preview-scroll [data-published-website]');
  for (const mode of ['off', 'expressive', 'subtle'] as const) {
    await control.selectOption(mode); await expect(preview).toHaveAttribute('data-website-motion', mode);
    await expect(preview).toContainText('72 hours’ notice');
  }
  await control.selectOption('off');
  const save = page.getByRole('region', { name: 'Site editor' }).getByRole('button', { name: 'Save draft', exact: true });
  await save.click(); await expect(save).toBeDisabled(); site = await read(page, site.id);
  expect(site.draft.style).toMatchObject({ websiteMotion: 'off', template: 'showcase', palette: 'ink', typography: 'modern' });
  expect({ ...site.draft, style: undefined }).toEqual(original); expect(site.published).toEqual(publication);
  await studio(page, site); await expect(control).toHaveValue('off');
  await control.selectOption('expressive');
  const scroller = page.locator('.preview-scroll');
  await scroller.evaluate(element => { element.scrollTop = 600; }); await page.waitForTimeout(300);
  // The scroll root is the embedded preview, not the Studio page.
  const seen = await preview.locator('[data-website-revealed=true]').count(); expect(seen).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Mobile preview', exact: true }).click(); await settled(page);
  expect(await scroller.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await control.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('branding-motion.png') });
  await page.goto(`/s/${site.slug}`); await expect(page.locator('[data-published-website]')).toHaveAttribute('data-website-motion', 'subtle');
});

test('opening the assistant preserves the website scene, media and scroll position', async ({ page }) => {
  let site = await createFixture(page, 0); site = await publish(page, site, 'showcase', 'expressive', true);
  await page.goto(`/s/${site.slug}`); await settled(page);
  const website = page.locator('[data-published-website]');
  await website.locator('.platform-website-footer').getByRole('button', { name: 'Ask a question', exact: true }).scrollIntoViewIfNeeded(); await settled(page);
  const position = await page.evaluate(() => scrollY);
  await website.locator('img').first().evaluate(image => { (image as HTMLElement).dataset.continuityProbe = 'original'; });
  const seen = await website.locator('[data-website-revealed=true]').count();
  await website.locator('.platform-website-footer').getByRole('button', { name: 'Ask a question', exact: true }).click();
  await expect(website).toHaveAttribute('data-website-paused', 'true');
  await expect(website.locator('[data-website-tracking=true]')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(website).toHaveAttribute('data-website-paused', 'false');
  await expect(website.locator('img').first()).toHaveAttribute('data-continuity-probe', 'original');
  expect(await website.locator('[data-website-revealed=true]').count()).toBeGreaterThanOrEqual(seen);
  expect(Math.abs(await page.evaluate(() => scrollY) - position)).toBeLessThan(3);
});

test('failed images, unavailable observers, larger text and no JavaScript retain useful content', async ({ page, browser }, info) => {
  let site = await createFixture(page, 0); site = await publish(page, site, 'editorial');
  await page.addInitScript(() => { Object.defineProperty(window, 'IntersectionObserver', { value: undefined, configurable: true }); });
  await page.route('**/api/public-files/**', route => route.abort());
  await page.setViewportSize({ width: 320, height: 740 }); await page.goto(`/s/${site.slug}`); await settled(page);
  const website = page.locator('[data-published-website]');
  await expect(website.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(website.locator('.platform-media-unavailable').first()).toBeVisible();
  await website.evaluate(element => { (element as HTMLElement).style.setProperty('--platform-text-scale', '1.5'); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('failed-image-large-text.png'), fullPage: true });
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const plain = await context.newPage(); await plain.goto(`${origin}/s/${site.slug}`);
  await expect(plain.getByRole('heading', { level: 1 })).toBeVisible();
  const question = plain.locator('.platform-website-faq summary'); await question.click();
  await expect(plain.locator('.platform-website-answer')).toBeVisible();
  await context.close();
});

test('slow image loading reserves its frame and section entrances show intermediate frames once', async ({ page }) => {
  let site = await createFixture(page, 0); site = await publish(page, site, 'editorial', 'subtle');
  const pending: (() => Promise<void>)[] = [];
  await page.route('**/api/public-files/**', route => new Promise<void>(resolve => pending.push(async () => { await route.continue(); resolve(); })));
  await page.goto(`/s/${site.slug}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(600);
  const frame = page.locator('.platform-website-hero .platform-media-image');
  const before = await frame.boundingBox();
  await expect.poll(() => pending.length).toBeGreaterThan(0);
  await Promise.all(pending.splice(0).map(release => release())); await page.unroute('**/api/public-files/**');
  await expect.poll(() => frame.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await frame.boundingBox()).toEqual(before);
  const target = page.locator('.platform-website-section[data-section-kind=photos] .platform-website-section-heading');
  await target.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect(target).toHaveAttribute('data-website-revealed', 'true');
  const frames: string[] = [];
  for (let i = 0; i < 5; i++) { frames.push(await target.evaluate(element => getComputedStyle(element).transform)); await page.waitForTimeout(60); }
  expect(new Set(frames).size).toBeGreaterThan(1);
  await expect(target).toHaveCSS('transform', 'none');
  await page.evaluate(() => scrollTo(0, 0)); await target.scrollIntoViewIfNeeded();
  await expect(target).toHaveCSS('transform', 'none');
});
