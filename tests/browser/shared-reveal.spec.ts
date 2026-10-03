import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { KnowledgeCatalog, PresentationPlan } from '@thevoice/platform-ui/contracts';
import type { Site } from '../../lib/site-model';
import classes from '../../fixtures/catalogs/classes.json' with { type: 'json' };

const origin = 'http://127.0.0.1:3225';
const availability = { enabled: true, mode: 'chat', live: false, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
let external: string[] = [];
let unexpectedProvider: string[] = [];

test.beforeEach(async ({ context }) => {
  external = []; unexpectedProvider = [];
  await context.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    external.push(url.origin + url.pathname); return route.abort('blockedbyclient');
  });
  await context.route(/\/api\/visitor\/[^/]+(?:\/session)?$/, route => {
    if (route.request().method() !== 'POST') return route.continue();
    unexpectedProvider.push(new URL(route.request().url()).pathname); return route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error('Microphone access is disabled in this offline rendering test.'); };
  });
});
test.afterEach(() => { expect(external).toEqual([]); expect(unexpectedProvider).toEqual([]); });

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('.platform-explorer');
    return !!root && !root.querySelector('[inert]')
      && root.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity)
      && [...root.querySelectorAll('.platform-slot')].every(element => Number(getComputedStyle(element).opacity) >= 0.999);
  });
}

async function publishFixture(request: APIRequestContext) {
  async function post(path: string, data: unknown) {
    const response = await request.post(path, { headers: { Origin: origin }, data });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); return body;
  }
  let site: Site = (await post('/api/sites', { name: 'Synthetic shared renderer', slug: `shared-${randomUUID().slice(0, 8)}`, kind: 'photographer' })).site;
  site = (await post(`/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, visitorSpeaksFirst: true,
    visitor: { enabled: true, mode: 'chat', voiceTier: 'standard', chatDailyLimit: 25, voiceDailyLimit: 5 } } })).site;
  const uploaded = await request.post(`/api/sites/${site.id}/files`, {
    headers: { Origin: origin, 'Content-Type': 'text/csv', 'X-Site-Revision': String(site.revision), 'X-File-Name': 'classes.csv' },
    data: await readFile('fixtures/source-packs/classes.csv'),
  });
  const upload = await uploaded.json(); expect(uploaded.ok(), JSON.stringify(upload)).toBeTruthy(); site = upload.site;
  const knowledge = `/api/sites/${site.id}/knowledge`;
  let state = await post(knowledge, { action: 'analyze', revision: site.revision, requestId: randomUUID(), fileId: upload.fileId });
  expect(state.candidates).toHaveLength(1);
  state = await post(knowledge, { action: 'revise', revision: site.revision, candidateId: state.candidates[0].id,
    catalog: { ...classes, id: state.candidates[0].catalog.id } });
  const applied = await post(knowledge, { action: 'apply', revision: site.revision, candidateId: state.candidates[0].id });
  site = applied.site;
  site = (await post(`/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  return { site, catalog: applied.catalog as KnowledgeCatalog };
}

function targetPlan(catalog: KnowledgeCatalog, target: 'collection' | 'criteria' | 'relationships'): PresentationPlan {
  const attributes = catalog.attributes.map(attribute => attribute.id);
  return { schemaVersion: 1, snapshotId: catalog.id, operation: 'understand', components: target === 'relationships'
    ? [{ id: 'detail', type: 'detail', variant: 'expanded', entityIds: ['class-handbuilding'], attributeIds: attributes },
      { id: target, type: target, variant: 'list', entityIds: ['class-handbuilding'], attributeIds: [] }]
    : [{ id: target, type: target, variant: target === 'collection' ? 'list' : 'expanded', entityIds: catalog.entities.map(entity => entity.id), attributeIds: attributes }],
  transition: { type: 'focus', targetComponentId: target } };
}

test.describe('published validated destinations', () => {
  let site: Site; let catalog: KnowledgeCatalog;
  test.beforeAll(async ({ request }) => { ({ site, catalog } = await publishFixture(request)); });
  const focused = (page: Page) => page.locator('[data-workspace-focused]:not([inert])');
  async function open(page: Page, plan: PresentationPlan | (() => PresentationPlan), waitForReply?: () => Promise<void>) {
    await page.route(`**/api/visitor/${site.slug}`, async route => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: { availability } });
      await waitForReply?.();
      await route.fulfill({ json: { text: 'Offline validated destination.', catalogPlan: typeof plan === 'function' ? plan() : plan, availability } }).catch(() => {});
    });
    await page.goto(`/s/${site.slug}`);
    await expect(page.getByRole('textbox', { name: 'What would you like to see?', exact: true })).toBeEnabled();
  }
  async function ask(page: Page) {
    const composer = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
    await composer.fill('Show the requested destination'); await composer.press('Enter'); return composer;
  }
  for (const target of ['collection', 'relationships'] as const) test(`${target} lifts v1 into a visible workspace object without stealing composer focus`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 650 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, targetPlan(catalog, target)); const composer = await ask(page);
    await expect(focused(page)).toHaveAttribute('data-workspace-transition', 'settled');
    const box = (await focused(page).boundingBox())!; expect(box.y).toBeGreaterThan(0); expect(box.y + box.height).toBeLessThanOrEqual(650);
    await expect(composer).toBeFocused(); expect(await page.evaluate(() => scrollY)).toBe(0);
  });
  for (const input of ['wheel', 'touchstart'] as const) test(`${input} during focus cannot cause a delayed page jump`, async ({ page }) => {
    await open(page, targetPlan(catalog, 'relationships')); const composer = await ask(page);
    await expect(focused(page)).toBeAttached();
    const before = await page.evaluate(input => { window.dispatchEvent(input === 'wheel' ? new WheelEvent('wheel', {deltaY:-100,bubbles:true}) : new Event('touchstart',{bubbles:true})); return scrollY; }, input);
    await expect(focused(page)).toHaveAttribute('data-workspace-transition', 'settled');
    await page.waitForTimeout(1000); expect(await page.evaluate(() => scrollY)).toBeCloseTo(before, 0); await expect(composer).toBeFocused();
  });
  test('equivalent v1 replies keep one instance and Back retains its useful object', async ({ page }) => {
    await open(page, targetPlan(catalog, 'relationships'));
    for (let turn = 0; turn < 2; turn++) { await ask(page); await expect(focused(page)).toHaveAttribute('data-workspace-transition','settled'); await expect(page.locator('.platform-workspace-card')).toHaveCount(1); }
    await focused(page).getByRole('button',{name:'Back to workspace'}).click(); await expect(focused(page)).toHaveCount(0);
    await expect(page.locator('.platform-workspace-card')).toHaveCount(1);
  });
  test('model filters update only their object; Back and old plans retain filters and invalid updates preserve the view', async ({ page }) => {
    const filteredView = targetPlan(catalog, 'collection');
    let responsePlan: PresentationPlan = { ...filteredView, stateUpdate: { filters: [{attributeId:'price',operator:'gte',value:85}] } };
    await open(page, () => responsePlan); await ask(page);
    const items = () => focused(page).locator('.platform-workspace-content-list > li');
    await expect(items()).toHaveCount(1); await expect(items()).toContainText('Wheel Skills');
    await focused(page).getByRole('button',{name:'Back to workspace'}).click(); await expect(focused(page)).toHaveCount(0);
    responsePlan = filteredView; await ask(page); await expect(items()).toHaveCount(1);
    responsePlan = {...filteredView,stateUpdate:{filters:[]}}; await ask(page); await expect(items()).toHaveCount(5);
    responsePlan = {...filteredView,stateUpdate:{filters:[{attributeId:'fabricated-price',operator:'lte',value:1}]}};
    await ask(page); await expect(page.getByRole('alert').filter({hasText:'workspace remains available'})).toBeVisible();
    await expect(items()).toHaveCount(5);
  });
  test('manual browsing cancels a pending model filter update', async ({ page }) => {
    let release!: () => void; const delayed = new Promise<void>(resolve => {release=resolve;});
    await open(page, {...targetPlan(catalog,'collection'),stateUpdate:{filters:[{attributeId:'price',operator:'gte',value:85}]}}, () => delayed);
    await ask(page); await page.getByRole('button',{name:'Browse published content'}).click(); release();
    await expect(page.getByRole('region',{name:'Browse approved information'})).toBeVisible();
    await expect(page.locator('.platform-workspace-card')).toHaveCount(0);
    await expect(page.locator('.platform-view-status')).toHaveCount(0);
  });
});

test('a delayed detail focus cannot steal a newer keyboard choice of Back', async ({ page }) => {
  await page.goto('/lab'); await settled(page);
  const title = page.locator('.platform-slot-collection:not([inert])').getByRole('button', { name: 'Example Blanco', exact: true });
  const back = page.locator('.platform-view-toolbar').getByRole('button', { name: 'Back', exact: true });
  await title.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Example Blanco', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Back to results', exact: true }).click(); await settled(page);

  // Hold frame callbacks so focus moves to Back before the queued detail handoff.
  await page.evaluate(() => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const queued = new Map<number, FrameRequestCallback>();
    let next = -1;
    window.requestAnimationFrame = callback => { const id = next--; queued.set(id, callback); return id; };
    window.cancelAnimationFrame = id => { if (!queued.delete(id)) cancel(id); };
    (window as typeof window & { releaseDetailFrames: () => void }).releaseDetailFrames = () => {
      window.requestAnimationFrame = request; window.cancelAnimationFrame = cancel;
      for (const callback of queued.values()) callback(performance.now());
      queued.clear();
    };
  });
  await title.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.platform-slot-detail:not([inert])')).toBeAttached();
  await back.focus();
  await page.evaluate(() => (window as typeof window & { releaseDetailFrames: () => void }).releaseDetailFrames());
  await expect(back).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.platform-slot-collection:not([inert])')).toBeAttached();
  await settled(page);
  await expect(page.locator('.platform-slot-detail')).toHaveCount(0);
});

test('demo requests replace an old budget and show all resets it with reversible history', async ({ page }) => {
  await page.goto('/lab'); await settled(page);
  const composer = page.getByRole('textbox', { name: 'What are you looking for?', exact: true });
  const back = page.locator('.platform-view-toolbar').getByRole('button', { name: 'Back', exact: true });
  await composer.fill('up to $40'); await composer.press('Enter');
  await expect(page.locator('.platform-item')).toHaveCount(1);
  await composer.fill('up to $72'); await composer.press('Enter');
  await expect(page.locator('.platform-item')).toHaveCount(3);
  await back.click();
  await expect(page.locator('.platform-item')).toHaveCount(1);
  await composer.fill('show all'); await composer.press('Enter');
  await expect(page.locator('.platform-item')).toHaveCount(4);
  await back.click();
  await expect(page.locator('.platform-item')).toHaveCount(1);
  await composer.fill('under $48'); await composer.press('Enter');
  await expect(page.locator('.platform-item')).toHaveCount(1);
});

test('reveal uses the scrolling preview pane even when its destination is inside the browser viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1100 });
  await page.goto('/lab');
  await page.locator('.platform-container').evaluate(element => { Object.assign((element as HTMLElement).style, { height: '300px', overflowY: 'auto' }); });
  await settled(page);
  const composer = page.getByRole('textbox', { name: 'What are you looking for?', exact: true });
  await composer.fill('Under 50');
  const before = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.platform-container')!;
    pane.scrollTop = 0; window.scrollTo({ top: 0, behavior: 'instant' });
    return { bottom: pane.getBoundingClientRect().bottom, target: document.querySelector('[data-platform-slot="collection"]')!.getBoundingClientRect().top, height: innerHeight };
  });
  expect(before.target).toBeGreaterThan(before.bottom);
  expect(before.target).toBeLessThan(before.height);
  await composer.press('Enter');
  await expect.poll(() => page.locator('.platform-container').evaluate(element => element.scrollTop)).toBeGreaterThan(50);
  await expect.poll(() => page.evaluate(() => {
    const pane = document.querySelector('.platform-container')!.getBoundingClientRect();
    const target = document.querySelector('[data-platform-slot="collection"]:not([inert])')!.getBoundingClientRect();
    return target.top >= pane.top && target.top < pane.bottom - 100;
  })).toBeTruthy();
  await expect(composer).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBeLessThan(2);
});

for (const embedded of [true, false]) {
  test(`${embedded ? 'desktop embedded 375px' : '375px mobile viewport'} uses the narrow catalog and comparison layout`, async ({ page }, info) => {
    await page.setViewportSize({ width: embedded ? 1440 : 375, height: 900 });
    await page.goto('/lab');
    if (embedded) await page.locator('.platform-container').evaluate(element => { (element as HTMLElement).style.width = '375px'; });
    await settled(page);
    const layout = await page.locator('.platform-explorer').evaluate(element => {
      const root = getComputedStyle(element);
      const items = getComputedStyle(element.querySelector('.platform-items')!);
      const canvas = getComputedStyle(element.querySelector('.platform-canvas')!);
      return { padding: root.paddingLeft, itemColumns: items.gridTemplateColumns.split(' ').length, canvasColumns: canvas.gridTemplateColumns.split(' ').length,
        font: getComputedStyle(element.querySelector('h2')!).fontSize, overflow: element.scrollWidth > element.clientWidth + 1 };
    });
    expect(layout).toEqual({ padding: '16px', itemColumns: 1, canvasColumns: 1, font: '36px', overflow: false });
    const composer = page.getByRole('textbox', { name: 'What are you looking for?', exact: true });
    await composer.fill('Compare'); await composer.press('Enter');
    await expect(page.locator('.platform-comparison-mobile')).toBeVisible();
    await expect(page.locator('.platform-comparison-table')).toBeHidden();
    await settled(page);
    await page.locator('.platform-container').screenshot({ path: info.outputPath('narrow-comparison.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  });
}

for (const width of [320, 390]) for (const embedded of [false, true]) {
  test(`featured cards retain readable text at ${width}px ${embedded ? 'embedded' : 'viewport'} width`, async ({ page }, info) => {
    await page.setViewportSize({ width: embedded ? 1440 : width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/lab');
    if (embedded) await page.locator('.platform-container').evaluate((element, value) => { (element as HTMLElement).style.width = `${value}px`; }, width);
    await settled(page);
    const card = page.locator('.platform-item[data-layout="feature"]').first();
    await card.scrollIntoViewIfNeeded();
    const content = await card.innerText();
    const geometry = await card.evaluate(element => {
      const body = element.querySelector('.platform-item-content')!;
      const summary = element.querySelector('.platform-item-summary')!;
      const attributes = element.querySelector('.platform-item-attributes')!;
      return { columns: getComputedStyle(body).gridTemplateColumns.split(' ').length,
        bodyWidth: body.getBoundingClientRect().width, summaryWidth: summary.getBoundingClientRect().width,
        titleWidth: element.querySelector('h4')!.getBoundingClientRect().width,
        summaryBottom: summary.getBoundingClientRect().bottom, attributesTop: attributes.getBoundingClientRect().top,
        clipped: body.scrollWidth > body.clientWidth + 1 };
    });
    expect(geometry.columns).toBe(1);
    expect(geometry.summaryWidth).toBeGreaterThan(150);
    expect(geometry.titleWidth).toBeGreaterThan(130);
    expect(Math.abs(geometry.summaryWidth - geometry.bodyWidth)).toBeLessThan(1);
    expect(geometry.attributesTop).toBeGreaterThanOrEqual(geometry.summaryBottom);
    expect(geometry.clipped).toBe(false);
    const opener = card.locator('.platform-item-open');
    await opener.focus(); await opener.press('Enter');
    await page.getByRole('button', { name: 'Back to results', exact: true }).click();
    await settled(page); await expect(opener).toBeFocused();
    expect(await card.innerText()).toBe(content);
    await card.screenshot({ path: info.outputPath('featured-card-readable.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

for (const initial of ['no-preference', 'reduce'] as const) {
  test(`live card and shortlist motion follows preference changes from ${initial}`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: initial });
    await page.goto('/lab'); await settled(page);
    const card = page.locator('.platform-item[data-layout="feature"]').first();
    await card.scrollIntoViewIfNeeded();
    const original = await card.elementHandle();
    await page.mouse.move(0, 0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(100);
    await card.evaluate(element => {
      const values: number[] = []; (window as typeof window & { cardMotionSamples?: number[] }).cardMotionSamples = values;
      element.addEventListener('pointerenter', () => {
        const start = performance.now();
        const sample = () => { values.push(new DOMMatrixReadOnly(getComputedStyle(element).transform).m42); if (performance.now() - start < 550) requestAnimationFrame(sample); };
        requestAnimationFrame(sample);
      }, { once: true });
    });
    await card.hover();
    await expect.poll(() => card.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42)).toBeLessThan(-3.9);
    const samples = await page.evaluate(() => (window as typeof window & { cardMotionSamples: number[] }).cardMotionSamples);
    expect(samples.some(value => value < -0.05 && value > -3.9)).toBe(true);
    // Keep the pointer stationary while reducing motion: an active hover must reset.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const neutral = async () => card.evaluate(element => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { y: matrix.m42, scale: matrix.a, opacity: Number(getComputedStyle(element).opacity) };
    });
    await expect.poll(neutral).toEqual({ y: 0, scale: 1, opacity: 1 });
    const reducedFrames = await card.evaluate(async element => {
      const values: number[] = [];
      for (let index = 0; index < 6; index++) { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); values.push(new DOMMatrixReadOnly(getComputedStyle(element).transform).m42); }
      return values;
    });
    expect(reducedFrames).toEqual([0, 0, 0, 0, 0, 0]);
    await page.mouse.move(0, 0); await card.hover();
    await page.waitForTimeout(100); expect(await neutral()).toEqual({ y: 0, scale: 1, opacity: 1 });
    await card.getByRole('button', { name: /Select .* for comparison/ }).click();
    const chip = page.locator('.platform-selection-items button').first();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Start a fresh keyboard interaction after restoring normal motion.
    await page.keyboard.press('Tab'); await chip.focus();
    expect(await chip.evaluate(element => element.matches(':focus-visible'))).toBe(true);
    await expect.poll(() => chip.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).a)).toBeGreaterThan(1.01);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => chip.evaluate(element => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { y: matrix.m42, scale: matrix.a };
    })).toEqual({ y: 0, scale: 1 });
    await expect(chip).toBeFocused();
    expect(await card.evaluate((element, previous) => element === previous, original)).toBe(true);
    await chip.press('Enter'); await expect(page.locator('.platform-selection-items button')).toHaveCount(0);
    await expect(card.getByRole('button', { name: /Select .* for comparison/ })).toBeEnabled();
    await card.screenshot({ path: info.outputPath('live-reduced-card.png') });
  });
}
