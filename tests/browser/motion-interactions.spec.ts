import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import type { WorkspaceOperation } from '@thevoice/platform-ui/workspace';
import type { Site } from '../../lib/site-model';
import type { VisitorContext } from '../../lib/visitor-request';
import { carouselFixture } from './helpers/carousel-fixture';

const origin = 'http://127.0.0.1:3225';
const availability = { enabled: true, mode: 'both', live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
const surface = (page: Page) => page.locator('[data-information-surface]');
const card = (page: Page) => surface(page).getByRole('article', { name: 'Current information' });
const reader = (page: Page) => surface(page).locator('[data-workspace-scroll]');
const back = (page: Page) => surface(page).getByRole('button', { name: 'Back to previous information', exact: true });
const forward = (page: Page) => surface(page).getByRole('button', { name: 'Forward to next information', exact: true });
const explanation = '## A closer look\n\nThe illustrated study explores a broad rim and a quiet blue surface. The photograph stays beside this explanation so you can inspect both together.\n\nA careful curve gives the piece its open shape. These are synthetic presentation fixtures, not claims about an actual maker.\n\nThe shared interface should give the same clear reading experience to a shop, studio, guide or service provider.';
const longExplanation = (title: string) => `## ${title}\n\n` + Array.from({ length: 14 }, (_, index) => `### Observation ${index + 1}\n\nThis synthetic guide discusses material, shape and practical details. Each observation stays readable while the interface changes, with enough context to exercise a long, independently scrollable information panel.`).join('\n\n');

type Frame = {
  at: number; width: number; height: number; top: number; scrollY: number; scrollTop: number; readerTop: number;
  transition: string | null; state: string | null; heading: string; sameImage: boolean; reduced: boolean;
  regions: { id: string | null; top: number; left: number; width: number; height: number; opacity: number; scaleX: number; scaleY: number; x: number; y: number }[];
};
type MotionQaWindow = Window & {
  __motionInteraction?: { frames: Frame[]; running: boolean; image: Element | null };
  __motionInteractionReceipts?: { id: string; at: number; transition: string | null; moving: boolean; opaque: boolean }[];
};
let fixture: { site: Site; media: MediaLibrary } | undefined;

async function prepare(page: Page) {
  // All content is synthetic and all model/control transport is mocked. Reuse
  // the immutable publication so these cases do not consume the site allowance.
  if (!fixture) {
    const site = await carouselFixture(page);
    const media = (await (await page.request.get(`/api/sites/${site.id}/media?revisionId=${site.published!.mediaRevisionId}`)).json()).library as MediaLibrary;
    fixture = { site, media };
  }
  const published = fixture;
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  await page.route(/\/api\/visitor\/[^/]+\/session\/control$/, route => route.fulfill({ status: 204 }));
  await page.route(/\/api\/visitor\/[^/]+$/, async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { availability } });
    const body = route.request().postDataJSON(), context = body.context as VisitorContext;
    const batch = (operations: WorkspaceOperation[]) => ({ kind: 'workspace', batch: { schemaVersion: 1, requestId: randomUUID(), publicationId: context.workspace!.publicationId, baseRevision: context.workspace!.revision, operations } });
    const photo = { instanceId: 'motion-photo', component: 'photo' as const, references: [{ kind: 'photo' as const, id: published.media.assets[0].id, revisionId: published.media.id }] };
    const target = body.text === 'Begin with one photograph' ? batch([{ kind: 'replace', objects: [photo] }])
      : body.text === 'Explain the illustrated study' ? { kind: 'answer', text: explanation }
        : body.text === 'Give me a long guide' ? { kind: 'answer', relationship: 'new-subject', text: longExplanation('The complete guide') }
          : body.text === 'Revise this guide with more context' ? { kind: 'answer', text: longExplanation('The revised guide') }
            : { kind: 'answer', relationship: 'new-subject', text: '## A fresh subject\n\nA concise result should be ready to read promptly.' };
    const events = [{ type: 'control', control: { id: randomUUID(), token: 'a'.repeat(43) } }, { type: 'navigation', id: randomUUID(), target }, { type: 'done', text: 'Ready.', displaySatisfied: true, availability }];
    await route.fulfill({ contentType: 'application/x-ndjson', body: events.map(event => JSON.stringify(event)).join('\n') + '\n' });
  });
  await page.goto(`/s/${published.site.slug}`);
  await page.evaluate(() => {
    const state = window as MotionQaWindow;
    state.__motionInteractionReceipts = [];
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (/\/api\/visitor\/[^/]+\/session\/control$/.test(path) && init?.method === 'POST') {
        const ack = JSON.parse(String(init.body)).update?.navigationAck;
        if (ack?.status === 'applied') {
          const root = document.querySelector('[data-information-surface]');
          const regions = [...root?.querySelectorAll('[data-surface-region]:not([inert])') ?? []];
          state.__motionInteractionReceipts!.push({ id: ack.id, at: performance.now(), transition: root?.getAttribute('data-workspace-transition') ?? null,
            moving: regions.some(region => { const matrix = new DOMMatrix(getComputedStyle(region).transform); return Math.abs(matrix.e) > .5 || Math.abs(matrix.f) > .5 || Math.abs(matrix.a - 1) > .01 || Math.abs(matrix.d - 1) > .01; }),
            opaque: regions.length > 0 && regions.every(region => Number(getComputedStyle(region).opacity) >= .99) });
        }
      }
      return original(input, init);
    };
  });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
}

async function settled(page: Page) {
  await expect(surface(page)).toHaveAttribute('data-pending-request', '');
  await expect(surface(page)).toHaveAttribute('aria-busy', 'false');
  await expect(surface(page)).toHaveAttribute('data-workspace-transition', 'settled');
}

async function ask(page: Page, text: string, wait = true) {
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill(text); await input.press('Enter');
  await expect(input).toHaveValue('');
  if (wait) await settled(page);
}

async function startFrames(page: Page) {
  await page.evaluate(() => {
    const state = window as MotionQaWindow;
    const root = document.querySelector('[data-information-surface]')!;
    const probe = { frames: [] as Frame[], running: true, image: root.querySelector('[data-surface-region] img') };
    state.__motionInteraction = probe;
    const deadline = performance.now() + 5000;
    const sample = () => {
      const article = root.querySelector('[aria-label="Current information"]')!, reading = root.querySelector('[data-workspace-scroll]')!;
      const bounds = article.getBoundingClientRect();
      probe.frames.push({ at: performance.now(), width: bounds.width, height: bounds.height, top: bounds.top, scrollY, scrollTop: reading.scrollTop, readerTop: reading.getBoundingClientRect().top,
        // RichAnswer renders Markdown's leading ## as h3 inside its answer
        // region; do not sample a website heading or an exiting answer.
        transition: root.getAttribute('data-workspace-transition'), state: root.getAttribute('data-surface-state'), heading: root.querySelector('[data-surface-region="answer"]:not([inert]) .platform-rich-answer h3')?.textContent ?? '', reduced: article.getAttribute('data-information-motion') === 'reduced',
        sameImage: !probe.image || probe.image.isConnected && root.querySelector('[data-surface-region] img') === probe.image,
        regions: [...root.querySelectorAll('[data-surface-region]:not([inert])')].map(region => {
          const rect = region.getBoundingClientRect(), style = getComputedStyle(region), matrix = new DOMMatrix(style.transform);
          return { id: region.getAttribute('data-surface-region'), top: rect.top, left: rect.left, width: rect.width, height: rect.height, opacity: Number(style.opacity), scaleX: matrix.a, scaleY: matrix.d, x: matrix.e, y: matrix.f };
        }) });
      if (probe.running && performance.now() < deadline) requestAnimationFrame(sample);
    };
    sample();
  });
}

async function finishFrames(page: Page, info: TestInfo, name: string) {
  const frames = await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const probe = (window as MotionQaWindow).__motionInteraction!; probe.running = false; return probe.frames;
  });
  const path = info.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(frames, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
  return frames;
}

function intermediate(frames: Frame[], property: 'width' | 'height') {
  const values = frames.map(frame => frame[property]), low = Math.min(...values), high = Math.max(...values);
  expect(high - low, `${property} changes visibly`).toBeGreaterThan(15);
  expect(new Set(values.filter(value => value > low + 1 && value < high - 1).map(value => value.toFixed(1))).size, `${property} has real intermediate frames`).toBeGreaterThan(3);
}

function undistorted(frames: Frame[]) {
  for (const frame of frames) {
    expect(frame.height).toBeGreaterThan(0);
    expect(frame.regions.length).toBeGreaterThan(0);
    for (const region of frame.regions) {
      expect(Math.abs(region.scaleX - 1)).toBeLessThan(.01);
      expect(Math.abs(region.scaleY - 1)).toBeLessThan(.01);
    }
  }
}

test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'no-preference' }); });

for (const width of [1440, 393]) test(`information enrichment and reversal preserve media and crisp geometry at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  await prepare(page); await ask(page, 'Begin with one photograph');
  await expect.poll(() => card(page).locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const initialState = await surface(page).getAttribute('data-surface-state');
  await startFrames(page);
  await ask(page, 'Explain the illustrated study');
  await expect(card(page).getByRole('heading', { name: 'A closer look', exact: true })).toBeVisible();
  const enrichedState = await surface(page).getAttribute('data-surface-state');
  const frames = await finishFrames(page, info, `enrichment-${width}`);
  if (width > 800) intermediate(frames, 'width');
  intermediate(frames, 'height'); undistorted(frames);
  expect(frames.every(frame => frame.sameImage)).toBe(true);
  const arriving = frames.filter(frame => frame.heading === 'A closer look');
  expect(arriving.length).toBeGreaterThan(3);
  const visibleAt = arriving.find(frame => (frame.regions.find(region => region.id === 'answer')?.opacity ?? 0) >= .99)!;
  expect(visibleAt, 'the new answer becomes fully readable').toBeDefined();
  expect(visibleAt.at - arriving[0].at, 'reading does not wait for the surrounding reflow').toBeLessThan(300);
  const last = frames.at(-1)!;
  const settledAt = arriving.find(frame => frame.transition === 'settled')!;
  expect(settledAt).toBeDefined();
  expect(settledAt.at - arriving[0].at, 'width and height settle together without a second trailing animation').toBeLessThan(950);
  for (const frame of arriving.filter(frame => frame.transition === 'settled')) {
    expect(Math.abs(frame.width - last.width)).toBeLessThan(1);
    expect(Math.abs(frame.height - last.height)).toBeLessThan(1);
  }
  const receipts = await page.evaluate(() => (window as MotionQaWindow).__motionInteractionReceipts!);
  expect(receipts.length).toBeGreaterThanOrEqual(2);
  expect(receipts.every(receipt => receipt.transition === 'settled' && receipt.opaque && !receipt.moving)).toBe(true);
  await page.screenshot({ path: info.outputPath(`enriched-${width}.png`) });
  await startFrames(page); await back(page).click(); await settled(page);
  await expect(surface(page)).toHaveAttribute('data-surface-state', initialState!);
  const reverse = await finishFrames(page, info, `reverse-${width}`);
  expect(reverse.every(frame => frame.sameImage)).toBe(true); undistorted(reverse);
  await forward(page).focus(); await page.keyboard.press('Enter'); await settled(page);
  await expect(surface(page)).toHaveAttribute('data-surface-state', enrichedState!);
  for (const control of [back(page), surface(page).getByRole('button', { name: 'Close assistant', exact: true })]) {
    const bounds = (await control.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(44);
  }
  await back(page).focus(); await page.keyboard.press('Tab');
  await expect(surface(page).getByRole('button', { name: 'Close assistant', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reflow after reading a scrolled panel does not project the new answer from an obsolete scroll offset', async ({ page }, info) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await prepare(page); await ask(page, 'Give me a long guide');
  await expect(card(page).getByRole('heading', { name: 'The complete guide', exact: true })).toBeVisible();
  await reader(page).evaluate(node => { node.scrollTop = 360; });
  await expect.poll(() => reader(page).evaluate(node => node.scrollTop)).toBeGreaterThan(300);
  const previousScroll = await reader(page).evaluate(node => node.scrollTop), outerScroll = await page.evaluate(() => scrollY);
  const original = await surface(page).getAttribute('data-surface-state');
  await startFrames(page); await ask(page, 'Revise this guide with more context');
  const frames = await finishFrames(page, info, 'scrolled-answer-reflow');
  const revised = frames.filter(frame => frame.heading === 'The revised guide');
  expect(revised.length).toBeGreaterThan(3); undistorted(revised);
  for (const frame of revised) {
    expect(frame.scrollY).toBe(outerScroll);
    const answer = frame.regions.find(region => region.id === 'answer')!;
    expect(answer.top, 'the former 360px reading offset must not become a layout translation').toBeGreaterThanOrEqual(frame.readerTop - 24);
    expect(Math.abs(answer.y)).toBeLessThan(24);
  }
  await expect(card(page).getByRole('heading', { name: 'The revised guide', exact: true })).toBeVisible();
  await back(page).click(); await settled(page);
  await expect(surface(page)).toHaveAttribute('data-surface-state', original!);
  expect(Math.abs(await reader(page).evaluate(node => node.scrollTop) - previousScroll)).toBeLessThan(2);
  expect(await page.evaluate(() => scrollY)).toBe(outerScroll);
  await page.screenshot({ path: info.outputPath('restored-reading-position.png') });
});

test('live reduced motion interrupts geometry safely and the next normal transition animates again', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page); await ask(page, 'Begin with one photograph');
  await expect(card(page)).toHaveAttribute('data-information-motion', 'reduced');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(card(page)).toHaveAttribute('data-information-motion', 'full');
  await startFrames(page);
  await ask(page, 'Explain the illustrated study', false);
  await expect(card(page).getByRole('heading', { name: 'A closer look', exact: true })).toBeAttached();
  await expect(surface(page)).toHaveAttribute('data-workspace-transition', 'moving');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(card(page)).toHaveAttribute('data-information-motion', 'reduced');
  await settled(page);
  const interrupted = await finishFrames(page, info, 'reduced-during-expansion');
  const stopped = interrupted.filter(frame => frame.reduced);
  expect(stopped.length).toBeGreaterThan(1);
  // Allow one paint boundary for the preference update, but no continued
  // physical travel after the mounted frame has acknowledged that preference.
  for (const frame of stopped.slice(1)) for (const region of frame.regions) {
    expect(Math.abs(region.x)).toBeLessThan(.5); expect(Math.abs(region.y)).toBeLessThan(.5);
  }
  await startFrames(page);
  await back(page).click(); await settled(page);
  const reduced = await finishFrames(page, info, 'live-reduced-history');
  undistorted(reduced);
  expect(reduced.every(frame => frame.regions.every(region => Math.abs(region.x) < .5 && Math.abs(region.y) < .5))).toBe(true);
  expect(reduced.every(frame => frame.sameImage)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(card(page)).toHaveAttribute('data-information-motion', 'full');
  await startFrames(page); await forward(page).click(); await settled(page);
  const resumed = await finishFrames(page, info, 'live-motion-resumed');
  intermediate(resumed, 'width'); undistorted(resumed);
  expect(resumed.every(frame => frame.sameImage)).toBe(true);
  await expect(card(page).getByRole('heading', { name: 'A closer look', exact: true })).toBeVisible();
});

test('live reduced motion stops composer travel without losing the draft or focus and can resume', async ({ page }, info) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let modelRequests = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/visitor\/[^/]+$/.test(new URL(request.url()).pathname)) modelRequests++; });
  await prepare(page);
  const dock = page.locator('.platform-conversation-dock'), control = page.locator('.platform-conversation-surface');
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await expect(dock).toHaveAttribute('data-conversation-motion', 'reduced');
  await input.fill('Keep this unfinished thought');
  const original = await input.elementHandle();
  // Filling the mobile input can shrink its wrapped placeholder. Wait for the
  // dock's ResizeObserver to measure that final height before recording travel.
  const destination = await control.evaluate((node: HTMLElement) => {
    const host = node.closest('.platform-conversation-dock')!;
    const viewport = window.visualViewport;
    const center = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) * .42;
    return Math.max(0, center - host.getBoundingClientRect().top - node.offsetTop - node.offsetHeight / 2);
  });
  expect(destination).toBeGreaterThan(100);
  await expect.poll(() => control.evaluate((node, destination) => Math.abs(new DOMMatrix(getComputedStyle(node).transform).f - destination), destination)).toBeLessThan(1);
  await page.keyboard.press('Escape');
  await expect(dock).toHaveAttribute('data-expanded', 'false');
  await expect.poll(() => control.evaluate(node => Math.abs(new DOMMatrix(getComputedStyle(node).transform).f))).toBeLessThan(.5);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(dock).toHaveAttribute('data-conversation-motion', 'full');
  await input.focus();
  await expect.poll(() => control.evaluate((node, destination) => {
    const y = new DOMMatrix(getComputedStyle(node).transform).f; return y > 1 && y < destination - 1;
  }, destination), { intervals: [0, 16, 32] }).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(dock).toHaveAttribute('data-conversation-motion', 'reduced');
  const stopped = await control.evaluate(async node => {
    const positions: number[] = [];
    for (let frame = 0; frame < 6; frame++) { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); positions.push(new DOMMatrix(getComputedStyle(node).transform).f); }
    return positions;
  });
  for (const position of stopped) expect(Math.abs(position - destination)).toBeLessThan(1);
  await expect(input).toBeFocused(); await expect(input).toHaveValue('Keep this unfinished thought');
  expect(await input.evaluate((node, original) => node === original, original)).toBe(true);

  // Restoring the preference must also restore normal, subtle travel on the
  // same mounted control, including an interrupted return to the compact dock.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(dock).toHaveAttribute('data-conversation-motion', 'full');
  await page.keyboard.press('Escape');
  await expect.poll(() => control.evaluate((node, destination) => {
    const y = new DOMMatrix(getComputedStyle(node).transform).f; return y > 1 && y < destination - 1;
  }, destination), { intervals: [0, 16, 32] }).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => control.evaluate(node => Math.abs(new DOMMatrix(getComputedStyle(node).transform).f))).toBeLessThan(.5);
  // Escape restores focus without reopening the layer. A real click also
  // exercises reopening when that input is already the active element.
  await input.click(); await expect(input).toBeFocused();
  await expect(dock).toHaveAttribute('data-expanded', 'true');
  await expect(input).toHaveValue('Keep this unfinished thought');
  expect(await input.evaluate((node, original) => node === original, original)).toBe(true);
  await expect.poll(() => control.evaluate((node, destination) => Math.abs(new DOMMatrix(getComputedStyle(node).transform).f - destination), destination)).toBeLessThan(1);
  expect(modelRequests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach('composer-preference-frames', { body: JSON.stringify({ destination, stopped }), contentType: 'application/json' });
  const screenshot = info.outputPath('mobile-composer-live-reduced-motion.png');
  await page.screenshot({ path: screenshot });
  await info.attach('mobile-composer-live-reduced-motion', { path: screenshot, contentType: 'image/png' });
});
