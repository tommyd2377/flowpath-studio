import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { Site } from '../../lib/site-model';
import type { SitePresentation } from '../../lib/site-presentation';

type Geometry = { x: number; y: number; width: number; height: number; opacity: number; inert: boolean; hidden: boolean; transform: string; inlineHeight: string; innerHeight: number | null };
type MotionFrame = { ms: number; scrollY: number; elements: Record<string, Geometry[]>; durations: number[] };
type MotionTrace = { frames: MotionFrame[] };
type MotionWindow = Window & { __motionTrace?: Promise<MotionTrace>; __microphoneAttempts?: number };

test.use({ viewport: { width: 1440, height: 1600 }, video: 'on' });

let externalRequests: string[] = [];
let aiRequests: string[] = [];
let mockedRequests: string[] = [];

test.beforeEach(async ({ context }) => {
  externalRequests = []; aiRequests = []; mockedRequests = [];
  await context.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:3225') return route.continue();
    externalRequests.push(`${url.origin}${url.pathname}`);
    return route.abort('blockedbyclient');
  });
  context.on('request', request => {
    if (request.method() === 'POST' && /^\/api\/(visitor\/[^/]+|session(?:\/.*)?)$/.test(new URL(request.url()).pathname)) aiRequests.push(new URL(request.url()).pathname);
  });
  await context.addInitScript(() => {
    const target = window as MotionWindow;
    target.__microphoneAttempts = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      target.__microphoneAttempts!++;
      throw new Error('Microphone access is disabled for offline motion tests.');
    };
  });
});

test.afterEach(async ({ page }) => {
  expect(externalRequests, 'No external browser requests should be attempted.').toEqual([]);
  expect(aiRequests, 'Every visitor request must be explicitly mocked; the gallery makes none.').toEqual(mockedRequests);
  expect(await page.evaluate(() => (window as MotionWindow).__microphoneAttempts ?? 0)).toBe(0);
});

async function settled(page: Page, selector = '.platform-explorer') {
  await page.waitForFunction(selector => {
    const root = document.querySelector(selector);
    if (!root || root.querySelector('[inert]')) return false;
    return root.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity)
      && [...root.querySelectorAll('.platform-slot')].every(element => Number(getComputedStyle(element).opacity) >= 0.999);
  }, selector);
  let previous = ''; let stable = 0;
  await expect.poll(async () => {
    const geometry = await page.locator('.platform-slot, [data-platform-height], .platform-item').evaluateAll(elements => JSON.stringify(elements.map(element => {
      const box = element.getBoundingClientRect();
      return [box.x, box.y, box.width, box.height].map(value => Math.round(value * 10) / 10);
    })));
    stable = geometry === previous ? stable + 1 : 0; previous = geometry;
    return stable;
  }, { intervals: [100], timeout: 8000 }).toBeGreaterThanOrEqual(2);
}

async function openGallery(page: Page, example?: string) {
  await page.goto('/lab');
  if (example) await page.getByRole('navigation', { name: 'Example catalogs' }).getByRole('button', { name: example, exact: true }).click();
  await expect(page.locator('.platform-explorer')).toBeVisible();
  await settled(page);
}

// Start sampling before the native interaction. This observes real intermediate
// layout and opacity without a fake clock, forced clicks, or altered animations.
async function recordMotion(page: Page, selectors: Record<string, string>, durationMs = 1150) {
  await page.evaluate(({ selectors, durationMs }) => {
    const started = performance.now();
    const frames: MotionFrame[] = [];
    (window as MotionWindow).__motionTrace = new Promise<MotionTrace>(resolve => {
      const sample = () => {
        const elements: MotionFrame['elements'] = {};
        for (const [name, selector] of Object.entries(selectors)) {
          elements[name] = [...document.querySelectorAll<HTMLElement>(selector)].map(element => {
            const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
            return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height,
              opacity: Number(style.opacity), inert: Boolean(element.closest('[inert]')),
              hidden: Boolean(element.closest('[aria-hidden="true"]')), transform: style.transform,
              inlineHeight: element.style.height, innerHeight: element.firstElementChild instanceof HTMLElement ? element.firstElementChild.offsetHeight : null };
          });
        }
        const durations = [...new Set((document.querySelector('.platform-explorer, [aria-label="Your requested information"]')?.getAnimations({ subtree: true }) ?? [])
          .filter(animation => animation.playState === 'running')
          .map(animation => animation.effect?.getTiming().duration)
          .filter((duration): duration is number => typeof duration === 'number' && duration > 0))];
        frames.push({ ms: performance.now() - started, scrollY, elements, durations });
        if (performance.now() - started >= durationMs) resolve({ frames });
        else requestAnimationFrame(sample);
      };
      sample();
    });
  }, { selectors, durationMs });
}

async function finishMotion(page: Page, info: TestInfo, name: string) {
  const trace = await page.evaluate(async () => (window as MotionWindow).__motionTrace!);
  const path = info.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(trace));
  await info.attach(name, { path, contentType: 'application/json' });
  return trace;
}

function values(trace: MotionTrace, name: string, property: keyof Pick<Geometry, 'height' | 'width' | 'opacity' | 'x' | 'y'>) {
  return trace.frames.flatMap(frame => frame.elements[name]?.map(element => element[property]) ?? []);
}

function expectIntermediateGeometry(trace: MotionTrace, name: string, property: 'height' | 'width' | 'x' | 'y') {
  const samples = values(trace, name, property);
  expect(samples.length).toBeGreaterThan(12);
  const low = Math.min(...samples); const high = Math.max(...samples);
  expect(high - low, `${name}.${property} should visibly change during the transition.`).toBeGreaterThan(8);
  const intermediate = samples.filter(value => value > low + 1 && value < high - 1);
  expect(new Set(intermediate.map(value => value.toFixed(1))).size, `${name}.${property} must pass through intermediate geometry.`).toBeGreaterThan(3);
}

function expectOpacityTransition(trace: MotionTrace, name: string) {
  const opacity = values(trace, name, 'opacity');
  expect(opacity.some(value => value > 0.03 && value < 0.95), `${name} should have observable intermediate opacity.`).toBeTruthy();
  expect(new Set(opacity.filter(value => value > 0.03 && value < 0.95).map(value => value.toFixed(2))).size).toBeGreaterThan(3);
}

function expectMeasuredShift(trace: MotionTrace, name: string, expectedMs: number) {
  const frames = trace.frames.filter(frame => frame.elements[name]?.length === 1);
  const final = frames.at(-1)!.elements[name][0].x;
  const lastMoving = frames.findLast(frame => Math.abs(frame.elements[name][0].x - final) > 0.05);
  expect(lastMoving).toBeTruthy();
  const span = lastMoving!.ms - frames[0].ms;
  expect(span).toBeGreaterThan(expectedMs * .72);
  expect(span).toBeLessThan(expectedMs * 1.4);
}

function expectMeasuredReflow(trace: MotionTrace, name: string, expectedMs: number) {
  const frames = trace.frames.filter(frame => frame.elements[name]?.length === 1);
  const initial = frames[0].elements[name][0].height; const final = frames.at(-1)!.elements[name][0].height;
  const firstMoving = frames.find(frame => Math.abs(frame.elements[name][0].height - initial) > 0.5);
  const lastMoving = frames.findLast(frame => Math.abs(frame.elements[name][0].height - final) > 0.5);
  expect(firstMoving).toBeTruthy(); expect(lastMoving).toBeTruthy();
  const span = lastMoving!.ms - firstMoving!.ms;
  // Native RAF sampling observes the useful motion span, excluding subpixel tails.
  expect(span, `Observed height reflow should span roughly ${expectedMs}ms.`).toBeGreaterThan(expectedMs * 0.72);
  expect(span).toBeLessThan(expectedMs * 1.4);
}

test('the retired criteria panel is absent from the shared library', async ({ page }) => {
  await openGallery(page, 'Classes & experiences');
  await expect(page.getByRole('region', { name: 'Refine the collection' })).toHaveCount(0);
  await expect(page.locator('.platform-slot-criteria')).toHaveCount(0);
});

test('selection reveals over 450 ms and comparison shifts workspace over 520 ms', async ({ page }, info) => {
  await openGallery(page);
  await recordMotion(page, { selection: '[data-platform-disclosure="selection"]' });
  await page.getByRole('button', { name: 'Select Example Blanco for comparison', exact: true }).click();
  const selection = await finishMotion(page, info, 'selection-reveal');
  expectOpacityTransition(selection, 'selection');
  expectIntermediateGeometry(selection, 'selection', 'height');
  expectMeasuredReflow(selection, 'selection', 450);
  await page.getByRole('button', { name: 'Select Example Reposado for comparison', exact: true }).click();
  await settled(page);
  await recordMotion(page, { comparison: '.platform-slot-comparison', collection: '.platform-slot-collection' });
  await page.getByRole('button', { name: 'Compare selections', exact: true }).click();
  const comparison = await finishMotion(page, info, 'comparison-workspace-shift');
  expectOpacityTransition(comparison, 'comparison');
  expectIntermediateGeometry(comparison, 'comparison', 'x');
  expectMeasuredShift(comparison, 'comparison', 520);
  await expect(page.getByRole('region', { name: 'Compare published attributes' })).toBeVisible();
  await expect(page.locator('.platform-explorer [inert]')).toHaveCount(0);
});

test('interrupted detail, back and replacement transitions leave one usable current view', async ({ page }, info) => {
  await openGallery(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const toolbar = page.locator('.platform-view-toolbar');
  const composer = page.getByRole('textbox', { name: 'What are you looking for?', exact: true });
  await recordMotion(page, { detail: '.platform-slot-detail', collection: '.platform-slot-collection' }, 2400);
  for (let pass = 0; pass < 3; pass++) {
    await page.locator('.platform-slot-collection:not([inert])').getByRole('button', { name: 'Example Blanco', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.platform-slot-detail:not([inert])')).toBeAttached();
    await toolbar.getByRole('button', { name: 'Back', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.platform-slot-collection:not([inert])')).toBeAttached();
    await composer.fill(pass % 2 ? 'show all' : 'under 50');
    await composer.press('Enter');
  }
  const trace = await finishMotion(page, info, 'interrupted-native-transitions');
  expect(trace.frames.some(frame => [...frame.elements.detail, ...frame.elements.collection].some(element => element.inert && element.opacity > 0))).toBeTruthy();
  await settled(page);
  await expect(page.locator('.platform-slot-detail')).toHaveCount(0);
  await expect(page.locator('.platform-slot-collection')).toHaveCount(1);
  await expect(page.locator('.platform-item')).toHaveCount(2);
  const title = page.getByRole('button', { name: 'Example Blanco', exact: true });
  expect(await title.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBeTruthy();
  await expect(page.locator('.platform-explorer [inert]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('automatic reveal preserves composer focus and a manual wheel cancels a pending reveal', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await openGallery(page);
  const composer = page.getByRole('textbox', { name: 'What are you looking for?', exact: true });
  await composer.fill('Example Blanco');
  await composer.press('Enter');
  await expect(page.locator('.platform-slot-detail:not([inert])')).toBeAttached();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(20);
  await settled(page);
  await expect(composer).toBeFocused();
  await page.locator('.platform-view-toolbar').getByRole('button', { name: 'All items', exact: true }).click();
  await settled(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await composer.fill('Example Reposado');
  await recordMotion(page, { detail: '.platform-slot-detail' }, 1400);
  await composer.press('Enter');
  await expect(page.locator('.platform-slot-detail:not([inert])')).toBeAttached();
  await page.mouse.wheel(0, -200);
  const cancelled = await finishMotion(page, info, 'manual-input-cancels-reveal');
  expect(Math.max(...cancelled.frames.map(frame => frame.scrollY))).toBeLessThan(3);
  await expect(composer).toBeFocused();
  await expect(page.getByRole('region', { name: 'Details of Example Reposado', exact: true })).toBeVisible();
});

test('reduced motion has no residual transforms or invisible keyboard targets after repeated changes', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGallery(page, 'Classes & experiences');
  await expect(page.getByRole('region', { name: 'Refine the collection' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Introduction to Handbuilding', exact: true }).click();
  await page.locator('.platform-view-toolbar').getByRole('button', { name: 'Back', exact: true }).click();
  await settled(page);
  const residuals = await page.locator('.platform-slot, .platform-item, [data-platform-disclosure]').evaluateAll(elements => elements.map(element => ({ transform: getComputedStyle(element).transform, opacity: Number(getComputedStyle(element).opacity) })));
  expect(residuals.every(value => /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/.test(value.transform) && value.opacity === 1)).toBeTruthy();
  await expect(page.locator('.platform-explorer [inert], .platform-explorer [aria-hidden="true"] input, .platform-explorer [aria-hidden="true"] select')).toHaveCount(0);
  await page.locator('.platform-view-toolbar').getByRole('button', { name: 'All items', exact: true }).focus();
  for (let index = 0; index < 16; index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return true;
      const bounds = active.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 || active.closest('[inert], [aria-hidden="true"]')) return false;
      for (let element: HTMLElement | null = active; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (Number(style.opacity) === 0 || style.visibility === 'hidden') return false;
      }
      return true;
    })).toBeTruthy();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: info.outputPath('reduced-motion-current-view.png'), fullPage: true });
});

test('legacy source cards retain expanded content across plans and animate disclosure height', async ({ page }, info) => {
  const slug = `legacy-motion-${Date.now()}`;
  const headers = { Origin: 'http://127.0.0.1:3225' };
  const created = await page.request.post('/api/sites', { headers, data: { name: 'Offline legacy motion', slug, kind: 'photographer' } });
  expect(created.ok()).toBeTruthy();
  let site: Site = (await created.json()).site;
  const content = { ...site.draft, visitor: { enabled: true, mode: 'chat' as const, voiceTier: 'standard' as const, chatDailyLimit: 25, voiceDailyLimit: 5 },
    sections: site.draft.sections.map((section, index) => index ? section : { ...section,
      body: 'This is a synthetic photography description used only to verify expandable published content. The session leaves space for natural moments, questions, and a careful review of the available options. '.repeat(11) }) };
  const saved = await page.request.post(`/api/sites/${site.id}`, { headers, data: { action: 'save', revision: site.revision, content } });
  expect(saved.ok()).toBeTruthy(); site = (await saved.json()).site;
  const published = await page.request.post(`/api/sites/${site.id}`, { headers, data: { action: 'publish', revision: site.revision } });
  expect(published.ok()).toBeTruthy();

  let presentation: SitePresentation = { layout: 'cards', sources: ['section:weddings', 'section:portraits'], status: 'ready' };
  const path = `/api/visitor/${slug}`;
  await page.route(`**${path}`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    mockedRequests.push(path);
    await route.fulfill({ json: { text: 'Offline mocked presentation.', presentation,
      availability: { enabled: true, mode: 'chat', live: false, chatRemaining: 24, voiceRemaining: 5, resetsAt: new Date(Date.now() + 86400000).toISOString() } } });
  });
  await page.goto(`/s/${slug}`);
  const composer = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await composer.fill('Show the published sessions'); await composer.press('Enter');
  const view = page.getByRole('region', { name: 'Your requested information' });
  await expect(view).toBeVisible(); await settled(page, '[aria-label="Your requested information"]');
  const source = view.locator('article').filter({ has: page.getByRole('heading', { name: 'Wedding stories', exact: true }) });
  const sourceNode = await source.elementHandle();
  const expand = source.getByRole('button', { name: 'Read the details', exact: true });
  const expandNode = await expand.elementHandle();
  await expand.focus();
  await recordMotion(page, { copy: 'article[data-kind="section"]:first-child [data-platform-height]' });
  await page.keyboard.press('Enter');
  const disclosure = await finishMotion(page, info, 'legacy-source-disclosure');
  expectIntermediateGeometry(disclosure, 'copy', 'height');
  expectMeasuredReflow(disclosure, 'copy', 450);
  await expect(source.getByRole('button', { name: 'Show less', exact: true })).toBeFocused();

  presentation = { layout: 'comparison', sources: ['section:weddings', 'section:portraits', 'overview'], status: 'ready' };
  await composer.fill('Compare the sessions and introduction');
  await recordMotion(page, { source: 'article[data-kind="section"]:first-child', copy: 'article[data-kind="section"]:first-child [data-platform-height]' });
  await composer.press('Enter');
  const changed = await finishMotion(page, info, 'legacy-plan-continuity');
  await expect(view.locator('[data-layout="comparison"][data-count="3"]')).toBeVisible();
  expectIntermediateGeometry(changed, 'source', 'width');
  await settled(page, '[aria-label="Your requested information"]');
  expect(await sourceNode!.evaluate(element => element.isConnected)).toBeTruthy();
  expect(await expandNode!.evaluate(element => element.isConnected && element.getAttribute('aria-expanded') === 'true')).toBeTruthy();
  await expect(source.getByRole('button', { name: 'Show less', exact: true })).toBeVisible();
  await expect(view.locator('[inert]')).toHaveCount(0);
  expect(mockedRequests).toHaveLength(2);
  await page.screenshot({ path: info.outputPath('legacy-preserved-disclosure.png'), fullPage: true });
});
