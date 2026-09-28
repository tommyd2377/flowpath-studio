import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { WEBSITE_TEMPLATES, type WebsiteTemplate } from '@thevoice/platform-ui/site-design';
import { templateFixtures } from '../../fixtures/template-sites';
import { createFixture, origin, post } from './website-fixtures';

const baseline = process.env.WEBSITE_MOTION_BASELINE === '1';
const actual = process.env.WEBSITE_MOTION_ACTUAL === '1';
const travel: typeof templateFixtures[number] = {
  ...templateFixtures[2], id: 'travel',
  content: { ...templateFixtures[2].content, name: 'Northbound Notes', tagline: 'Independent travel notes', headline: 'Take the slower road.', description: 'A synthetic guide to thoughtful journeys, walks and places to stay. Plan with room to explore.' },
  catalog: { ...templateFixtures[2].catalog, name: 'Northbound Notes', entities: [
    { id: 'river', kind: 'guide', name: 'A weekend by the water', summary: 'A two-day itinerary with a riverside walk and a quiet afternoon in the old town.', attributes: { distance: 'Approximately 4 km on foot' }, blocks: [{ id: 'plan', kind: 'paragraph' as const, text: 'Start at the waterfront and follow the path into town. Leave the afternoon open for a museum or a pause in the gardens. This is illustrative travel information; check access and opening times before visiting.' }] },
    { id: 'garden', kind: 'place', name: 'The hillside guesthouse', summary: 'An illustrative place to stay near the walking routes. No live availability or booking is offered.', attributes: {} },
    { id: 'access', kind: 'information', name: 'Before you set out', summary: 'Check local weather, transport and access with the relevant providers. Timetables and conditions can change.', attributes: {} },
    { id: 'faq', kind: 'faq', name: 'Can I book here?', summary: 'These are travel notes only. Contact the provider directly for current information.', attributes: {} },
  ] },
};

// Capture computed pixels on every animation frame, not implementation flags.
async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const state = { samples: [] as { t: number; scroll: number; title: number[]; copy: number[]; section: number[]; image: string; clip: string }[], shifts: 0, scrollShifts: 0, overflow: 0, longTasks: [] as number[], start: 0 };
    (window as unknown as { motionProbe: typeof state }).motionProbe = state;
    new PerformanceObserver(list => { for (const item of list.getEntries()) { const entry = item as PerformanceEntry & { value: number; hadRecentInput: boolean }; if (!entry.hadRecentInput) { state.shifts += entry.value; if (scrollY > 0) state.scrollShifts += entry.value; } } }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(list => state.longTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask', buffered: true });
    const read = (node: Element | null) => {
      if (!node) return [];
      let x = 0, y = 0, opacity = 1;
      for (let p: Element | null = node; p && !p.hasAttribute('data-published-website'); p = p.parentElement) { const css = getComputedStyle(p), matrix = new DOMMatrix(css.transform); x += matrix.e; y += matrix.f; opacity *= Number(css.opacity); }
      return [Math.hypot(x, y), opacity];
    };
    const sample = () => {
      const title = document.querySelector('.platform-website-hero h1');
      if (title && state.samples.length < 1000) {
        if (!state.start) state.start = performance.now();
        const image = document.querySelector('.platform-website-hero img');
        const frame = document.querySelector('.platform-website-hero [data-website-frame]');
        state.samples.push({ t: performance.now() - state.start, scroll: scrollY, title: read(title), copy: read(document.querySelector('.platform-website-hero p')), section: read(document.querySelector('.platform-website-section-heading')), image: image ? getComputedStyle(image).transform : '', clip: frame ? getComputedStyle(frame).clipPath : '' });
        state.overflow = Math.max(state.overflow, document.documentElement.scrollWidth - innerWidth);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function capture(browser: Browser, url: string, label: string, width: number, info: TestInfo) {
  const viewport = { width, height: width === 390 ? 844 : 1000 };
  const directory = info.outputPath(label); await mkdir(directory, { recursive: true });
  const context = await browser.newContext({ viewport, reducedMotion: 'no-preference', recordVideo: { dir: directory, size: viewport }, serviceWorkers: 'block' });
  // This browser only reads its named localhost page and public assets. No model,
  // telemetry write, microphone, external host or customer state mutation.
  await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === new URL(url).origin && route.request().method() === 'GET' ? route.continue() : route.abort());
  const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await installProbe(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1700);
  await page.screenshot({ path: `${directory}/opening.png` });
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, width === 390 ? 155 : 200); await page.waitForTimeout(140); }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${directory}/sections.png` });
  const result = await page.evaluate(() => ({
    ...(window as unknown as { motionProbe: { samples: { t: number; scroll: number; title: number[]; copy: number[]; section: number[] }[]; shifts: number; scrollShifts: number; overflow: number; longTasks: number[] } }).motionProbe,
    template: document.querySelector('[data-template]')?.getAttribute('data-template'),
    mode: document.querySelector('[data-website-motion]')?.getAttribute('data-website-motion'),
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    unreadable: Array.from(document.querySelectorAll('[data-website-reveal], [data-website-frame]')).filter(n => Number(getComputedStyle(n).opacity) < .99 || (getComputedStyle(n).clipPath.match(/[\d.]+/g) ?? []).some(value => Number(value) > .01)).length,
  }));
  await writeFile(`${directory}/measurements.json`, JSON.stringify(result, null, 2));
  await context.close();
  expect(errors).toEqual([]); expect(result.overflow).toBeLessThanOrEqual(1); expect(result.unreadable).toBe(0);
  if (!baseline) {
    const start = result.samples.filter(s => s.scroll === 0 && s.t < 1600);
    const distance = result.template === 'clarity' ? 3 : result.template === 'editorial' ? width === 390 ? 7 : 10 : width === 390 ? 12 : 18;
    expect(Math.max(...start.map(s => s.title[0])), 'opening has visible displacement in its template direction').toBeGreaterThan(distance);
    expect(start.filter(s => s.title[0] > 1).length, 'motion lasts multiple real frames').toBeGreaterThan(8);
    expect(start.some(s => Math.abs(s.title[0] - s.copy[0]) > (result.template === 'clarity' ? 1 : 3)), 'title and copy are choreographed separately').toBe(true);
    expect(new Set(result.samples.map(s => s.section[0].toFixed(1))).size, 'section visibly moves over time').toBeGreaterThan(5);
    expect(result.scrollShifts, 'scroll animations do not shift layout').toBeLessThan(.005);
  }
}

for (const [index, fixture] of [...templateFixtures, travel].entries()) test(`Motion choreography: ${fixture.id}`, async ({ page, browser }, info) => {
  test.skip(actual); test.setTimeout(180_000);
  let site = await createFixture(page, index === 3 ? 2 : index, undefined, fixture);
  for (const template of ['editorial', 'showcase', 'clarity'] as WebsiteTemplate[]) {
    site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, style: { ...WEBSITE_TEMPLATES[template].defaults, websiteMotion: 'subtle', entry: 'website' } } })).site;
    site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
    for (const width of [1440, 390]) await capture(browser, `${origin}/s/${site.slug}`, `${fixture.id}-${template}-${width}`, width, info);
  }
});

test('read-only actual cake-shop motion', async ({ browser }, info) => {
  test.skip(!actual);
  for (const width of [1440, 390]) await capture(browser, 'http://127.0.0.1:3220/s/doc-s-cake-shop', `cake-shop-${width}`, width, info);
});

async function setStyle(page: Page, site: Awaited<ReturnType<typeof createFixture>>, template: WebsiteTemplate, mode: 'off' | 'subtle' | 'expressive') {
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, style: { ...WEBSITE_TEMPLATES[template].defaults, websiteMotion: mode, entry: 'website' } } })).site;
  return (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
}

async function sampleMovement(page: Page, selector: string) {
  return page.locator(selector).evaluate(node => new Promise<number[]>(resolve => {
    const frames: number[] = [], start = performance.now();
    const sample = () => { const matrix = new DOMMatrix(getComputedStyle(node).transform); frames.push(Math.hypot(matrix.e, matrix.f)); if (performance.now() - start < 1250) requestAnimationFrame(sample); else resolve(frames); };
    requestAnimationFrame(sample);
  }));
}

test('Off, reduced motion and live preference changes keep all templates readable and still', async ({ page }) => {
  test.skip(actual || baseline); test.setTimeout(120_000);
  let site = await createFixture(page, 0);
  for (const template of ['editorial', 'showcase', 'clarity'] as const) {
    for (const mode of ['off', 'subtle', 'expressive'] as const) {
      site = await setStyle(page, site, template, mode);
      await page.emulateMedia({ reducedMotion: mode === 'off' ? 'no-preference' : 'reduce' });
      await page.goto(`/s/${site.slug}`);
      const movements = await sampleMovement(page, '.platform-website-hero h1');
      expect(movements.every(value => value === 0)).toBe(true);
      await expect(page.locator('.platform-website-hero h1')).toHaveCSS('opacity', '1');
      await expect(page.locator('[data-website-tracking=true]')).toHaveCount(0);
      const card = page.locator('.platform-website-card').first(); await card.scrollIntoViewIfNeeded();
      await card.hover();
      await expect(card.locator('.platform-content-card-more > span')).toHaveCSS('transform', 'none');
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload(); await page.waitForTimeout(1400);
    const card = page.locator('.platform-website-card').first(); await card.scrollIntoViewIfNeeded(); await card.hover();
    const arrow = card.locator('.platform-content-card-more > span');
    await expect.poll(() => arrow.evaluate(n => new DOMMatrix(getComputedStyle(n).transform).e)).toBeGreaterThan(2.5);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(arrow).toHaveCSS('transform', 'none');
    await expect(page.locator('[data-website-tracking=true]')).toHaveCount(0);
  }
});

test('nested Studio scroll animates pixels without scrolling the surrounding page', async ({ page }) => {
  test.skip(actual || baseline);
  const { studio } = await import('./website-fixtures');
  let site = await createFixture(page, 0); site = await setStyle(page, site, 'showcase', 'subtle');
  await studio(page, site);
  const scroller = page.locator('.preview-scroll');
  const target = '.preview-scroll .platform-website-section[data-section-kind=photos] .platform-website-section-heading';
  await page.waitForTimeout(1400);
  const outerPosition = await page.evaluate(() => scrollY);
  await scroller.evaluate(element => {
    const target = element.querySelector('.platform-website-section[data-section-kind=photos]')!;
    element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - 140;
  });
  const frames = await sampleMovement(page, target);
  expect(Math.max(...frames)).toBeGreaterThan(10); expect(new Set(frames).size).toBeGreaterThan(8);
  expect(await page.evaluate(() => scrollY)).toBe(outerPosition);
  await expect(page.locator(target)).toHaveCSS('opacity', '1');
  await expect(page.locator(target)).toHaveCSS('transform', 'none');
});

test('dynamic collections, fast scrolling and visibility interruption settle without replay or scroll renders', async ({ page }) => {
  test.skip(actual || baseline);
  const fixture = structuredClone(templateFixtures[0]);
  for (let i = 0; i < 12; i++) {
    const id = `extra-${i}`; fixture.catalog.entities.push({ ...fixture.catalog.entities[0], id, name: `Seasonal selection ${i + 1}` }); fixture.catalog.collections[0].entityIds.push(id);
  }
  let site = await createFixture(page, 0, undefined, fixture); site = await setStyle(page, site, 'clarity', 'subtle');
  await page.addInitScript(() => {
    const probe = { commits: 0, renderer: 0 };
    Object.assign(window, { renderProbe: probe, __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      supportsFiber: true, renderers: new Map(), inject() { return ++probe.renderer; },
      onCommitFiberRoot() { probe.commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    } });
  });
  await page.goto(`/s/${site.slug}`); await page.waitForTimeout(1500);
  const more = page.getByRole('button', { name: 'Explore all 15', exact: true }); await more.scrollIntoViewIfNeeded(); await more.click();
  const fresh = page.locator('.platform-website-entries > li').nth(6);
  await fresh.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const frames = await sampleMovement(page, '.platform-website-entries > li:nth-child(7)');
  expect(new Set(frames).size).toBeGreaterThan(5);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(30);
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(1400);
  const before = await page.evaluate(() => (window as unknown as { renderProbe: { commits: number; renderer: number } }).renderProbe);
  expect(before.renderer).toBeGreaterThan(0); expect(before.commits).toBeGreaterThan(0);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 180); await page.waitForTimeout(100); }
  const after = await page.evaluate(() => (window as unknown as { renderProbe: { commits: number } }).renderProbe.commits);
  expect(after - before.commits, 'scroll/entrance frames do not re-render React').toBe(0);
  // Synthetic visibility events exercise cleanup deterministically in headless
  // Chromium, where background tabs otherwise remain document-visible.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('[data-website-tracking=true]')).toHaveCount(0);
  const position = await page.evaluate(() => scrollY);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  expect(await page.evaluate(() => scrollY)).toBe(position);
  await page.evaluate(() => scrollTo(0, 0));
  expect((await sampleMovement(page, '.platform-website-hero h1')).every(value => value === 0)).toBe(true);
  await expect(page.locator('.platform-website-hero h1')).toHaveCSS('opacity', '1');
});
