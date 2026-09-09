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

  async function open(page: Page, plan: PresentationPlan | (() => PresentationPlan), waitForReply?: () => Promise<void>) {
    await page.route(`**/api/visitor/${site.slug}`, async route => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: { availability } });
      await waitForReply?.();
      await route.fulfill({ json: { text: 'Offline validated destination.', catalogPlan: typeof plan === 'function' ? plan() : plan, availability } }).catch(() => {});
    });
    await page.goto(`/s/${site.slug}`);
    await expect(page.getByRole('textbox', { name: 'What would you like to see?', exact: true })).toBeEnabled();
    await settled(page);
    // Model a destination below a publisher's opening content without assuming
    // a particular host heading length or viewport-sized hero.
    await page.addStyleTag({ content: '.platform-container { margin-top: 650px !important; }' });
  }

  async function ask(page: Page) {
    const composer = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
    await composer.fill('Show the requested destination');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await composer.press('Enter');
    return composer;
  }

  for (const target of ['collection', 'criteria', 'relationships'] as const) {
    test(`${target} is revealed after settling without stealing composer focus`, async ({ page }) => {
      await page.setViewportSize({ width: 1000, height: 650 });
      if (target === 'criteria') await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, targetPlan(catalog, target));
      const composer = await ask(page);
      const slot = page.locator(`[data-platform-slot="${target}"]:not([inert])`);
      await expect.poll(() => slot.evaluate(element => {
        const box = element.getBoundingClientRect();
        return box.top >= 0 && box.top < innerHeight - 100;
      })).toBeTruthy();
      await settled(page);
      await expect(composer).toBeFocused();
      expect(await page.evaluate(() => scrollY)).toBeGreaterThan(100);
      if (target === 'criteria') expect(await slot.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running'))).toHaveLength(0);
    });
  }

  for (const input of ['wheel', 'touchstart'] as const) {
    test(`${input} cancels a pending shared reveal`, async ({ page }) => {
      await page.setViewportSize({ width: 1000, height: 650 });
      await open(page, targetPlan(catalog, 'relationships'));
      const composer = await ask(page);
      await expect(page.locator('[data-platform-slot="relationships"]:not([inert])')).toBeAttached();
      const before = await page.evaluate(input => {
        window.dispatchEvent(input === 'wheel' ? new WheelEvent('wheel', { deltaY: -100, bubbles: true }) : new Event('touchstart', { bubbles: true }));
        return scrollY;
      }, input);
      await settled(page);
      // Wait beyond the bounded 900 ms reveal window to catch delayed jumps.
      await page.waitForTimeout(1000);
      expect(await page.evaluate(() => scrollY)).toBeCloseTo(before, 0);
      await expect(composer).toBeFocused();
    });
  }

  test('the opening is not a Back step and equivalent responses do not duplicate history', async ({ page }) => {
    await open(page, targetPlan(catalog, 'relationships'));
    const back = page.locator('.platform-view-toolbar').getByRole('button', { name: 'Back', exact: true });
    await expect(back).toBeDisabled();
    for (let turn = 0; turn < 2; turn++) {
      const response = page.waitForResponse(response => response.url().endsWith(`/api/visitor/${site.slug}`) && response.request().method() === 'POST');
      await ask(page); await response;
      await expect(page.locator('[data-platform-slot="relationships"]:not([inert])')).toBeAttached();
      await settled(page);
    }
    await back.click();
    await expect(page.locator('[data-platform-slot="relationships"]')).toHaveCount(0);
    await expect(back).toBeDisabled();
  });

  test('model filter replacements and reset apply with the view; Back and old plans preserve filters', async ({ page }) => {
    const filteredView: PresentationPlan = { ...targetPlan(catalog, 'collection'), components: [
      ...targetPlan(catalog, 'criteria').components, ...targetPlan(catalog, 'collection').components,
    ] };
    let responsePlan: PresentationPlan = { ...filteredView, stateUpdate: { filters: [{ attributeId: 'price', operator: 'gte', value: 85 }] } };
    await open(page, () => responsePlan);
    const price = page.locator('.platform-explorer').getByRole('spinbutton', { name: /^Price/ });
    await price.fill('40');
    await expect(page.locator('.platform-item')).toHaveCount(1);
    await ask(page);
    await expect(price).toHaveValue('85');
    await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('At least $85.00');
    await expect(page.locator('.platform-item')).toHaveCount(1);
    await expect(page.locator('.platform-item')).toContainText('Wheel Skills');
    responsePlan = { ...filteredView, stateUpdate: { filters: [] } };
    await ask(page);
    await expect(price).toHaveValue('');
    await expect(page.locator('.platform-item')).toHaveCount(5);
    await page.locator('.platform-view-toolbar').getByRole('button', { name: 'Back', exact: true }).click();
    await expect(price).toHaveValue('85');
    await expect(page.locator('.platform-item')).toHaveCount(1);
    responsePlan = filteredView;
    await ask(page);
    await expect(price).toHaveValue('85');
    await expect(page.locator('.platform-item')).toHaveCount(1);
    responsePlan = { ...filteredView, stateUpdate: { filters: [{ attributeId: 'fabricated-price', operator: 'lte', value: 1 }] } };
    await ask(page);
    await expect(page.getByRole('region', { name: 'Site assistant' }).getByRole('alert')).toContainText('current view is still available');
    await expect(price).toHaveValue('85');
    await expect(page.locator('.platform-item')).toHaveCount(1);
  });

  test('a late model filter update cannot overwrite a newer manual filter', async ({ page }) => {
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    await open(page, { ...targetPlan(catalog, 'collection'), stateUpdate: { filters: [{ attributeId: 'price', operator: 'gte', value: 85 }] } }, () => delayed);
    await ask(page);
    await expect(page.locator('.platform-view-status')).toHaveText('Shaping your view…');
    const price = page.locator('.platform-explorer').getByRole('spinbutton', { name: /^Price/ });
    await price.fill('40'); release();
    await expect(page.locator('.platform-view-status')).not.toHaveText('Shaping your view…');
    await expect(price).toHaveValue('40');
    await expect(page.locator('.platform-item')).toHaveCount(1);
    await expect(page.locator('.platform-item')).toContainText('Drawing from Observation');
  });

  test('manual filter disclosure cancels pending model work before expanding', async ({ page }) => {
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    await open(page, targetPlan(catalog, 'relationships'), () => delayed);
    await ask(page);
    await expect(page.locator('.platform-view-status')).toHaveText('Shaping your view…');
    await page.getByRole('button', { name: 'All 6 filters', exact: true }).click();
    release();
    await expect(page.getByRole('button', { name: 'Fewer filters', exact: true })).toBeVisible();
    await expect(page.locator('.platform-view-status')).not.toHaveText('Shaping your view…');
    await expect(page.locator('[data-platform-slot="relationships"]')).toHaveCount(0);
  });
});

test('a delayed detail focus cannot steal a newer keyboard choice of Back', async ({ page }) => {
  await page.goto('/lab'); await settled(page);
  const title = page.locator('.platform-slot-collection:not([inert])').getByRole('button', { name: 'Example Blanco', exact: true });
  const back = page.locator('.platform-view-toolbar').getByRole('button', { name: 'Back', exact: true });
  await title.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Example Blanco', exact: true })).toBeFocused();
  await back.click(); await settled(page);

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
  const price = page.getByRole('spinbutton', { name: /^Price/ });
  const composer = page.getByRole('textbox', { name: 'What are you looking for?', exact: true });
  const back = page.locator('.platform-view-toolbar').getByRole('button', { name: 'Back', exact: true });
  await price.fill('40');
  await expect(page.locator('.platform-item')).toHaveCount(1);
  await composer.fill('up to $72'); await composer.press('Enter');
  await expect(price).toHaveValue('72');
  await expect(page.locator('.platform-item')).toHaveCount(3);
  await back.click();
  await expect(price).toHaveValue('40');
  await expect(page.locator('.platform-item')).toHaveCount(1);
  await composer.fill('show all'); await composer.press('Enter');
  await expect(price).toHaveValue('');
  await expect(page.locator('.platform-item')).toHaveCount(4);
  await back.click();
  await expect(price).toHaveValue('40');
  await expect(page.locator('.platform-item')).toHaveCount(1);
  await composer.fill('under $48'); await composer.press('Enter');
  await expect(price).toHaveValue('48');
  await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('Under $48.00');
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
