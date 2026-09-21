import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { carouselFixture } from './helpers/carousel-fixture';
import { prepareCarouselVoice } from './helpers/carousel-voice';
import { websiteTaskFixture } from '../../fixtures/visitor-tasks';
import { demoExploreResult } from '../../lib/explore-model';
import type { Site } from '../../lib/site-model';
import type { VisitorContext } from '../../lib/visitor-request';
import type { WorkspaceOperation } from '@thevoice/platform-ui/workspace';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import { websiteDesignTokens } from '@thevoice/platform-ui/site-design';

// The filename remains in the existing isolated group; these replace global-carousel acceptance.
const origin = 'http://127.0.0.1:3225';
const surface = (page: Page) => page.locator('[data-information-surface]');
const back = (page: Page) => surface(page).getByRole('button', { name: 'Back to previous information' });
const availability = { enabled: true, mode: 'both', live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
async function post(page: Page, path: string, data: unknown) { const response = await page.request.post(path, { headers: { Origin: origin }, data }); const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body; }
async function ask(page: Page, question: string, wait = true) {
  if (!await page.getByRole('textbox', { name: 'What would you like to see?', exact: true }).isVisible()) await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill(question); await input.press('Enter');
  if (wait) { await expect(input).toHaveValue(''); await expect(surface(page)).toHaveAttribute('data-pending-request', ''); await expect(surface(page)).toHaveAttribute('aria-busy', 'false'); await expect(surface(page)).toHaveAttribute('data-workspace-transition', 'settled'); }
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  // Resize and browser-chrome transitions do not change the composition key.
  // Wait for foreground paint readiness as well as the frame's geometry receipt.
  const card = surface(page).getByRole('article', { name: 'Current information' });
  await expect(surface(page)).toHaveAttribute('data-workspace-transition', 'settled');
  await expect.poll(() => card.locator('img').evaluateAll(images => images.every(image => {
    const rect = image.getBoundingClientRect();
    return rect.bottom <= 0 || rect.top >= innerHeight || image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  }))).toBe(true);
  await card.locator('img').evaluateAll(images => Promise.all(images.filter((image): image is HTMLImageElement => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0).map(image => image.decode())));
  expect(await card.evaluate(async node => {
    let stable = 0, last = ''; const start = performance.now();
    while (performance.now() - start < 2000) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const foreground = [node, ...node.querySelectorAll('[data-surface-region]')];
      const next = foreground.flatMap(element => { const rect = element.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 2)); }).join(':');
      const visible = foreground.every(element => { const style = getComputedStyle(element); return style.opacity === '1' && style.visibility === 'visible'; });
      stable = visible && next === last ? stable + 1 : 0; last = next; if (stable >= 6) return true;
    }
    return false;
  })).toBe(true);
  await expect(surface(page)).toHaveAttribute('data-workspace-transition', 'settled');
  await mkdir('docs/screenshots/information-surface', { recursive: true });
  const path = `docs/screenshots/information-surface/${name}.png`;
  const capture = await page.screenshot({ path }); await info.attach(name, { path, contentType: 'image/png' }); return capture;
}
let fixture: { site: Site; media: MediaLibrary; catalogId: string } | undefined;
async function fixtureSite(page: Page) {
  if (!fixture) {
    let site = await carouselFixture(page);
    const original = (await (await page.request.get(`/api/sites/${site.id}/media`)).json()).library as MediaLibrary;
    const media: MediaLibrary = { ...original, videos: [{ id: 'studio-film', autoplay: false, title: 'A study in clay', description: 'A quiet look at shaping a vessel, from the first pull to the finished rim.', source: { kind: 'youtube', videoId: 'abcdefghijk' }, posterAssetId: original.assets[0].id, transcript: [{ start: 0, end: 30, text: 'The maker centers the clay, opens the form, and gently draws up the walls.' }] }] };
    media.albums.push({ id: 'first-studies', title: 'Early studies', description: '', assetIds: original.assets.slice(0, 2).map(asset => asset.id) }, { id: 'last-studies', title: 'Later studies', description: '', assetIds: original.assets.slice(2).map(asset => asset.id) });
    site = (await post(page, `/api/sites/${site.id}/media`, { revision: site.revision, library: media })).site;
    site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
    const catalog = (await (await page.request.get(`/api/sites/${site.id}/knowledge?revisionId=${site.published!.knowledgeRevisionId}`)).json()).catalog;
    const publishedMedia = (await (await page.request.get(`/api/sites/${site.id}/media?revisionId=${site.published!.mediaRevisionId}`)).json()).library as MediaLibrary;
    fixture = { site, media: publishedMedia, catalogId: catalog.id };
  }
  return fixture;
}
async function harness(page: Page) {
  const fixture = await fixtureSite(page), requests: { context: VisitorContext; text: string }[] = [], receipts: VisitorContext[] = [];
  let release: (() => void) | undefined;
  await page.addInitScript(() => {
    const state = { seconds: 0, paused: true, destroyed: 0, created: 0, seeked: 0 };
    Object.assign(window, { __surfacePlayer: state, YT: { Player: class {
      node: HTMLElement; options: { events: { onReady: () => void; onStateChange: (event: { data: number }) => void } }; muted = false;
      constructor(node: HTMLElement, options: { events: { onReady: () => void; onStateChange: (event: { data: number }) => void } }) {
        state.created++; this.node = node; this.options = options;
        Object.assign(node.style, { height: '100%', background: 'radial-gradient(ellipse at 50% 70%, #ddd0b8 0 25%, transparent 26%), linear-gradient(140deg,#4d6c70,#a2b6b4)', display: 'grid', placeItems: 'center' });
        const button = document.createElement('button'); button.textContent = 'Play film'; button.onclick = () => { state.seconds = 12; this.playVideo(); }; node.append(button); setTimeout(() => options.events.onReady(), 0);
      }
      playVideo() { state.paused = false; this.options.events.onStateChange({ data: 1 }); }
      pauseVideo() { state.paused = true; this.options.events.onStateChange({ data: 2 }); }
      destroy() { state.paused = true; state.destroyed++; this.node.remove(); }
      getCurrentTime() { return state.seconds; } getPlayerState() { return state.paused ? 2 : 1; } mute() { this.muted = true; } isMuted() { return this.muted; } seekTo(seconds: number) { state.seconds = seconds; state.seeked++; }
    } } });
  });
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  await page.route(/\/api\/visitor\/[^/]+\/tasks$/, async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'execute' && body.call.capabilityId === 'query.command') return route.fulfill({ json: { handled: false } });
    return route.fallback();
  });
  await page.route(/\/api\/visitor\/[^/]+\/session\/control$/, async route => { receipts.push(route.request().postDataJSON().update.context); await route.fulfill({ status: 204 }); });
  await page.route(/\/api\/visitor\/[^/]+$/, async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { availability } });
    const body = route.request().postDataJSON(); requests.push(body);
    const context = body.context as VisitorContext, workspace = context.workspace!;
    const batch = (operations: WorkspaceOperation[], offset = 0) => ({ kind: 'workspace', batch: { schemaVersion: 1, requestId: randomUUID(), publicationId: workspace.publicationId, baseRevision: workspace.revision + offset, operations } });
    const source = (id: string) => ({ instanceId: id.replaceAll(':', '-'), component: 'information' as const, references: [{ kind: 'source' as const, id, revisionId: workspace.publicationId }] });
    const photo = { instanceId: 'added-photo', component: 'photo' as const, references: [{ kind: 'photo' as const, id: fixture.media.assets[0].id, revisionId: fixture.media.id }] };
    const video = { instanceId: 'film', component: 'information' as const, references: [{ kind: 'source' as const, id: 'video:studio-film', revisionId: fixture.media.id }] };
    const chart = { instanceId: 'prices', component: 'chart' as const, metric: 'price', references: ['blue', 'white', 'clay'].map(id => ({ kind: 'entity' as const, id, revisionId: fixture.catalogId })) };
    let targets: unknown[];
    switch (body.text) {
      case 'Watch the making process': targets = [batch([{ kind: 'replace', objects: [video] }])]; break;
      case 'Explain the technique': targets = [{ kind: 'answer', text: '## A steady hand, a lighter touch\n\nThe published transcript describes **centering the clay**, opening the form, and drawing up the walls.\n\nKeeping the walls even gives the vessel its balance. The film stays here while you explore the details.' }]; break;
      case 'Add a price chart': targets = [batch([{ kind: 'add', object: chart }, { kind: 'focus', instanceId: 'prices' }])]; break;
      case 'Show contact information': targets = [batch([{ kind: 'replace', objects: [source('contact')] }])]; break;
      case 'Calculate in the current detail': targets = [batch([{ kind: 'replace', objects: [source('contact')] }]), { kind: 'answer', text: 'Three items at $9 total $27. With the hypothetical 12% surcharge, the total is $30.24.', placement: 'supporting' }]; break;
      case 'Add a photograph': targets = [batch([{ kind: 'add', object: photo }, { kind: 'focus', instanceId: photo.instanceId }])]; break;
      case 'Remove the photograph': targets = [batch([{ kind: 'close', instanceId: photo.instanceId }])]; break;
      case 'Show the studio story': targets = [batch([{ kind: 'replace', objects: [source('section:story')] }])]; break;
      case 'Combine photo and chart': targets = [batch([{ kind: 'add', object: { ...photo, instanceId: 'combined-photo', references: [{ kind: 'photo', id: fixture.media.assets[1].id, revisionId: fixture.media.id }] } }]), batch([{ kind: 'add', object: chart }, { kind: 'focus', instanceId: chart.instanceId }], 1)]; break;
      case 'A slow explanation': await new Promise<void>(resolve => { release = resolve; }); targets = [{ kind: 'answer', text: 'This late result must not appear.' }]; break;
      case 'Return to the earlier composition': targets = [{ kind: 'carousel', action: 'back' }]; break;
      case 'A short explanation': targets = [{ kind: 'answer', relationship: 'new-subject', text: 'Stoneware is fired at a high temperature, giving it a dense body that works well for everyday use.' }]; break;
      case 'A sourced explanation': targets = [{ kind: 'explore', result: { ...demoExploreResult('Clay and firing', 'web'), answer: '## From earth to everyday use\n\nFiring transforms a shaped clay body into a durable ceramic object. The temperature, atmosphere and glaze each contribute to its final surface.\n\nThis is synthetic background for the design review; the publisher’s own descriptions remain the source for its pieces.', sources: [{ title: 'Ceramic materials — synthetic reference', url: 'https://example.com/ceramics' }] } }]; break;
      case 'A geographic overview': targets = [{ kind: 'explore', result: demoExploreResult('Map of the United States', 'map') }]; break;
      case 'A partial response': targets = [{ kind: 'answer', text: 'This useful explanation arrived before the optional lookup failed.' }]; break;
      case 'An invalid video': targets = [batch([{ kind: 'replace', objects: [{ ...video, references: [{ kind: 'source', id: 'video:missing', revisionId: fixture.media.id }] }] }])]; break;
      case 'A long explanation': targets = [{ kind: 'answer', relationship: 'new-subject', text: Array.from({ length: 12 }, (_, i) => `## Step ${i + 1}\n\nWorking with clay takes patience. Shape, dry and fire each piece with care, allowing the material to guide your decisions. The result is an object that carries the marks of its making.`).join('\n\n') }]; break;
      case 'Compare two pieces': targets = [batch([{ kind: 'replace', objects: [{ instanceId: 'comparison', component: 'comparison', references: ['blue', 'white'].map(id => ({ kind: 'entity' as const, id, revisionId: fixture.catalogId })) }] }])]; break;
      case 'Open the gallery': targets = [batch([{ kind: 'replace', objects: [{ instanceId: 'gallery', component: 'gallery', references: [{ kind: 'album', id: 'studies', revisionId: fixture.media.id }] }] }])]; break;
      case 'Add two photo albums': targets = [batch(['first-studies', 'last-studies'].map(id => ({ kind: 'add' as const, object: { instanceId: id, component: 'gallery' as const, references: [{ kind: 'album' as const, id, revisionId: fixture.media.id }] } }))), { kind: 'answer', text: 'The three published studies are shown together.', placement: 'supporting' }]; break;
      case 'Show published photo collection': targets = [batch([{ kind: 'replace', objects: [{ instanceId: 'all-photos', component: 'gallery', references: [{ kind: 'collection', id: 'published-photos', revisionId: fixture.catalogId }] }] }])]; break;
      default: targets = [{ kind: 'answer', text: 'The published contact is hello@harbor.example.' }];
    }
    const ending = body.text === 'A partial response' ? { type: 'error', message: 'The optional lookup is unavailable.' } : { type: 'done', text: 'Ready.', displaySatisfied: true, availability };
    const events = [{ type: 'control', control: { id: randomUUID(), token: 'a'.repeat(43) } }, ...targets.map(target => ({ type: 'navigation', id: randomUUID(), target })), ending];
    await route.fulfill({ contentType: 'application/x-ndjson', body: events.map(event => JSON.stringify(event)).join('\n') + '\n' }).catch(() => undefined);
  });
  await page.goto(`/s/${fixture.site.slug}`);
  return { requests, receipts, release: () => release?.() };
}

for (const mobile of [false, true]) test(`requested albums fill one visible grid above old text${mobile ? ' on phone' : ' on desktop'}`, async ({ page }, info) => {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 });
  const h = await harness(page);
  await ask(page, 'Show the studio story'); await ask(page, 'Add a photograph');
  await ask(page, 'Add two photo albums');
  const primary = surface(page).locator('[data-surface-region][data-role=primary]');
  await expect(primary.locator('[data-information-grid]')).toHaveAttribute('data-item-count', '3');
  await expect(primary.getByRole('img').first()).toBeInViewport();
  await expect(surface(page).getByText('Made with time and intention.', { exact: true })).toHaveCount(0);
  await expect(surface(page)).toContainText('The three published studies are shown together.');
  const box = (await primary.boundingBox())!;
  if (!mobile) expect(box.width).toBeGreaterThan(1200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const observed = h.receipts.at(-1)!.surface!.regions.find(region => region.role === 'primary')!;
  expect(observed).toMatchObject({ kind: 'collection', visible: true, itemCount: 3 });
  expect(observed.visibleReferenceIds!.length).toBeGreaterThan(0);
  await screenshot(page, info, `combined-photo-grid-${mobile ? 'mobile' : 'desktop'}`);
  await back(page).click(); await expect(surface(page)).toContainText('Made with time and intention.');
  await surface(page).getByRole('button', { name: 'Forward to next information' }).click();
  await expect(primary.locator('[data-information-grid]')).toHaveAttribute('data-item-count', '3');
  await ask(page, 'Show published photo collection');
  await expect(primary.locator('[data-information-grid]')).toHaveAttribute('data-item-count', '3');
});

test('a mounted gallery below the viewport never receives a successful display receipt', async ({ page }) => {
  const statuses: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/session/control')) { const status = request.postDataJSON().update?.navigationAck?.status; if (status) statuses.push(status); } });
  await harness(page);
  const obstruction = await page.addStyleTag({ content: '[data-surface-region][data-kind=collection] [data-information-grid] { margin-top: 120vh !important; }' });
  await ask(page, 'Open the gallery');
  expect(statuses).toContain('failed'); expect(statuses).not.toContain('applied');
  await obstruction.evaluate(node => { node.parentNode?.removeChild(node); });
  await ask(page, 'Open the gallery');
  expect(statuses.at(-1)).toBe('applied');
});

for (const mobile of [false, true]) test(`one persistent video enriches, adds a chart and restores without remount${mobile ? ' on phone' : ' on desktop'}`, async ({ page }, info) => {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const h = await harness(page);
  await ask(page, 'Watch the making process'); await expect(surface(page).getByRole('button', { name: 'Play A study in clay' })).toBeVisible();
  await screenshot(page, info, mobile ? 'phone-initial-video' : 'desktop-initial-video');
  await surface(page).getByRole('button', { name: 'Play A study in clay' }).click(); await surface(page).getByRole('button', { name: 'Play film', exact: true }).click();
  await ask(page, 'Explain the technique'); await expect(surface(page)).toContainText('A steady hand, a lighter touch');
  await expect(surface(page).locator('[data-surface-region]')).toHaveCount(2);
  const sizes = await surface(page).locator('[data-surface-region]').evaluateAll(nodes => nodes.map(node => ({ kind: (node as HTMLElement).dataset.kind, rect: node.getBoundingClientRect().toJSON() })));
  if (!mobile) expect(sizes.find(item => item.kind === 'video')!.rect.right).toBeLessThan(sizes.find(item => item.kind === 'answer')!.rect.left);
  else expect(sizes.find(item => item.kind === 'video')!.rect.top).toBeLessThan(sizes.find(item => item.kind === 'answer')!.rect.top);
  await screenshot(page, info, mobile ? 'phone-enriched-video' : 'desktop-enriched-video');
  await page.getByRole('textbox', { name: 'What would you like to see?', exact: true }).click();
  const inputBox = await page.getByRole('textbox', { name: 'What would you like to see?', exact: true }).boundingBox();
  await expect.poll(async () => (await surface(page).getByRole('article', { name: 'Current information' }).boundingBox())!.y).toBeGreaterThan(inputBox!.y + inputBox!.height);
  const player = () => page.evaluate(() => (window as unknown as { __surfacePlayer: { seconds: number; paused: boolean; created: number; destroyed: number; seeked: number } }).__surfacePlayer);
  expect(await player()).toMatchObject({ seconds: 12, paused: false, created: 1, destroyed: 0, seeked: 1 });
  await ask(page, 'Add a price chart'); await expect(surface(page).getByRole('figure', { name: 'Price chart' })).toBeVisible();
  await screenshot(page, info, mobile ? 'phone-enriched-chart' : 'desktop-enriched-chart');
  await back(page).click(); await expect(surface(page).getByRole('figure', { name: 'Price chart' })).toHaveCount(0);
  await expect(surface(page)).toContainText('A steady hand'); expect(await player()).toMatchObject({ paused: false, created: 1, destroyed: 0, seeked: 1 });
  await back(page).click(); await expect(surface(page)).not.toContainText('A steady hand'); expect(await player()).toMatchObject({ paused: false, created: 1, destroyed: 0, seeked: 1 });
  await ask(page, 'Show the studio story'); expect(await player()).toMatchObject({ paused: true, destroyed: 1 });
  await back(page).click(); await surface(page).getByRole('button', { name: 'Play A study in clay' }).click();
  await expect.poll(player).toMatchObject({ paused: false, seconds: 12, created: 2 }); // Explicit Play is the only resumption.
  expect(h.receipts.every(context => context.surface?.regions.length && context.surface.regions.length <= 3)).toBe(true);
  expect(errors).toEqual([]);
});

for (const palette of ['parchment', 'midnight'] as const) test(`surface perimeter keeps ${palette} content and keyboard controls crisp`, async ({ page }, info) => {
  await harness(page);
  const tokens = websiteDesignTokens({ layout: 'editorial', palette }, '#72542e');
  await page.locator('[data-visitor-site]').evaluate((node, tokens) => {
    for (const [name, value] of Object.entries(tokens)) (node as HTMLElement).style.setProperty(name, value);
  }, tokens);
  await ask(page, 'Show contact information'); await ask(page, 'Add a photograph');
  const card = surface(page).getByRole('article', { name: 'Current information' });
  const close = surface(page).getByRole('button', { name: 'Close assistant' });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const photo = card.getByRole('img', { name: 'Synthetic ceramic bowl illustration 1' });
    await expect(photo).toBeInViewport();
    if (width === 1440) {
      await expect(card.getByRole('heading', { name: 'Get in touch', exact: true })).toBeInViewport();
      await expect(card.getByText('hello@harbor.example', { exact: true })).toBeInViewport();
    }
    const capture = await screenshot(page, info, `perimeter-${palette}-${width}`);
    const box = (await photo.boundingBox())!;
    // The cream bowl must be painted in the actual PNG, not just a loaded DOM
    // image or its blue placeholder. All fixtures use a 1x device scale here.
    const pixel = await sharp(capture).extract({ left: Math.round(box.x + box.width / 2), top: Math.round(box.y + box.height * .65), width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    expect([...pixel].every(channel => channel > 180)).toBe(true);
    if (width === 1440) {
      const title = (await card.getByRole('heading', { name: 'Get in touch', exact: true }).boundingBox())!;
      const pixels = await sharp(capture).extract({ left: Math.ceil(title.x), top: Math.ceil(title.y), width: Math.floor(title.width), height: Math.floor(title.height) }).removeAlpha().raw().toBuffer();
      const ink = [1, 3, 5].map(start => parseInt(tokens['--platform-text'].slice(start, start + 2), 16));
      let painted = 0;
      for (let index = 0; index < pixels.length; index += 3) if (ink.every((channel, offset) => Math.abs(pixels[index + offset] - channel) < 24)) painted++;
      expect(painted).toBeGreaterThan(30);
    }
    expect(await card.evaluate(node => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, border: style.borderTopColor, shadow: style.boxShadow, overflow: style.overflow };
    })).toEqual({ background: 'rgba(0, 0, 0, 0)', border: 'rgba(0, 0, 0, 0)', shadow: 'none', overflow: 'visible' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await card.locator('img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
    expect(await card.evaluate(node => [node, ...node.querySelectorAll('[data-workspace-scroll], [data-surface-region], img, button')].every(element => {
      const style = getComputedStyle(element);
      return style.filter === 'none' && style.backdropFilter === 'none' && style.maskImage === 'none' && style.opacity === '1';
    }))).toBe(true);
    await back(page).focus(); await page.keyboard.press('Tab'); await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(back(page)).toBeFocused();
    for (const button of [back(page), close]) {
      await button.focus();
      const accent = tokens['--platform-accent'];
      await expect(button).toHaveCSS('outline-color', `rgb(${[1, 3, 5].map(start => parseInt(accent.slice(start, start + 2), 16)).join(', ')})`);
      expect(await button.evaluate(node => {
        const style = getComputedStyle(node), rect = node.getBoundingClientRect();
        const ring = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
        return node.matches(':focus-visible') && style.outlineStyle === 'solid' && parseFloat(style.outlineWidth) >= 2 && rect.left >= ring && rect.right + ring <= innerWidth && rect.top >= ring && rect.bottom + ring <= innerHeight && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('button') === node;
      })).toBe(true);
    }
    await screenshot(page, info, `perimeter-${palette}-${width}-focus`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize({ width: 320, height: 600 });
  await ask(page, 'A long explanation');
  const reader = surface(page).locator('[data-workspace-scroll]');
  expect(await reader.evaluate(node => node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY === 'auto')).toBe(true);
  await reader.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(surface(page).getByText('Step 12', { exact: true })).toBeInViewport();
  await expect(close).toBeInViewport(); await expect(back(page)).toBeInViewport();
  await screenshot(page, info, `perimeter-${palette}-320-reduced`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await close.click(); await expect(surface(page)).toBeHidden();
});

test('research, local map controls, partial success and invalid media keep useful information', async ({ page }, info) => {
  await harness(page); await ask(page, 'A sourced explanation');
  await expect(surface(page)).toContainText('From earth to everyday use'); await screenshot(page, info, 'desktop-research');
  await ask(page, 'A geographic overview'); await expect(surface(page)).toContainText('United States overview');
  await surface(page).getByRole('button', { name: 'Zoom in', exact: true }).click(); await expect(surface(page)).toContainText('Overview zoom 4');
  await surface(page).locator('.platform-external-mapPreview').press('ArrowRight'); await expect(surface(page)).toContainText('Overview zoom 4');
  await ask(page, 'A short explanation'); await back(page).click(); await expect(surface(page)).toContainText('Overview zoom 4');
  await back(page).click(); await expect(surface(page)).toContainText('Overview zoom 3');
  await back(page).click(); await expect(surface(page)).toContainText('From earth to everyday use');
  await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, info, 'phone-research');
  await ask(page, 'A partial response', false); await expect(surface(page)).toContainText('useful explanation arrived'); await expect(surface(page)).toContainText('optional lookup is unavailable'); await expect(surface(page)).toHaveAttribute('aria-busy', 'false');
  await back(page).click(); await expect(surface(page)).not.toContainText('useful explanation arrived');
  await ask(page, 'An invalid video'); await expect(surface(page)).toContainText('From earth to everyday use'); await expect(surface(page).locator('[data-kind=video]')).toHaveCount(0);
});

test('whole-state history restores photo removal, replacement, multi-tool requests, facts and pending cancellation', async ({ page }, info) => {
  const h = await harness(page);
  await ask(page, 'Show contact information'); await expect(surface(page)).toContainText('hello@harbor.example');
  await screenshot(page, info, 'desktop-initial-information');
  await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, info, 'phone-initial-information');
  await ask(page, 'Add a photograph'); await expect(surface(page).locator('[data-kind=photo]')).toHaveCount(1);
  await screenshot(page, info, 'phone-enriched-information'); await page.setViewportSize({ width: 1440, height: 1100 });
  await screenshot(page, info, 'desktop-enriched-information');
  await ask(page, 'Remove the photograph'); await expect(surface(page).locator('[data-kind=photo]')).toHaveCount(0);
  await back(page).click(); await expect(surface(page).locator('[data-kind=photo]')).toHaveCount(1); await expect(surface(page)).toContainText('hello@harbor.example');
  await ask(page, 'Show the studio story'); await expect(surface(page)).toContainText('Made with time and intention.');
  await ask(page, 'Go back'); await expect(surface(page)).toContainText('hello@harbor.example');
  const depth = Number(await surface(page).getAttribute('data-history-depth'));
  await ask(page, 'Combine photo and chart'); await expect(surface(page).locator('[data-kind=chart]')).toBeVisible();
  await expect(surface(page)).toHaveAttribute('data-history-depth', String(depth + 1));
  const bar = surface(page).getByRole('button', { name: /Blue Bowl/ });
  await bar.click(); await expect(bar).toHaveAttribute('aria-pressed', 'true');
  await ask(page, 'A short explanation'); await back(page).click(); await expect(bar).toHaveAttribute('aria-pressed', 'true');
  await back(page).click(); await expect(bar).toHaveAttribute('aria-pressed', 'false');
  await back(page).click(); await expect(surface(page).locator('[data-kind=chart]')).toHaveCount(0);
  await ask(page, 'A slow explanation', false); await expect(surface(page)).toHaveAttribute('aria-busy', 'true');
  await back(page).click(); h.release(); await expect(surface(page)).not.toContainText('This late result');
  await ask(page, 'What is the contact?'); expect(h.requests.at(-1)!.context.surface?.regions.some(region => region.referenceIds.some(id => id.endsWith(':contact')))).toBe(true);
  expect(h.requests.at(-1)!.context.surface?.answer).not.toContain('late');
  const stable = await surface(page).getAttribute('data-surface-state');
  await ask(page, 'A slow explanation', false); await expect(surface(page)).toHaveAttribute('aria-busy', 'true');
  await ask(page, 'Go back'); h.release(); await expect(surface(page)).toHaveAttribute('data-surface-state', stable!);
  await ask(page, 'Show the studio story'); await ask(page, 'Return to the earlier composition');
  await expect(surface(page)).toHaveAttribute('data-surface-state', stable!);
});

test('typing after Home reopens the stable composer and the first submit click works', async ({ page }) => {
  const h = await harness(page);
  for (const width of [393, 1440]) {
    await page.setViewportSize({ width, height: 852 });
    await ask(page, 'A short explanation');
    await ask(page, 'Take me home'); await expect(surface(page)).toBeHidden();
    const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
    await input.fill('What is the contact? Please show the published details again so I can read them.');
    await expect(page.getByRole('dialog', { name: 'Assistant exploration' })).toBeVisible();
    const before = h.requests.length;
    const send = page.getByRole('button', { name: 'Show me', exact: true });
    await expect.poll(() => send.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('button') === node;
    })).toBe(true);
    await send.click();
    await expect(input).toHaveValue('');
    await expect(surface(page)).toContainText('hello@harbor.example');
    await expect(surface(page)).toHaveAttribute('data-pending-request', '');
    expect(h.requests.length).toBe(before + 1);
  }
});

test('initial prose, comparison, long reading, limited height and larger type stay deliberate and accessible', async ({ page }, info) => {
  await harness(page); await ask(page, 'A short explanation');
  await screenshot(page, info, 'desktop-initial-short');
  const card = surface(page).getByRole('article', { name: 'Current information' });
  expect((await card.boundingBox())!.height).toBeLessThan(320);
  for (const width of [320, 430, 768, 1440, 2560]) { await page.setViewportSize({ width, height: 1000 }); await expect.poll(async () => (await card.boundingBox())!.width).toBeLessThanOrEqual(width <= 800 ? width - 28 : width * .8 + 1); }
  await ask(page, 'Compare two pieces'); await expect(surface(page).locator('table')).toBeVisible(); await screenshot(page, info, 'desktop-comparison');
  await page.setViewportSize({ width: 390, height: 600 }); await ask(page, 'A long explanation');
  await page.locator('[data-visitor-site]').evaluate(element => (element as HTMLElement).style.setProperty('--platform-text-scale', '1.35'));
  await expect(surface(page)).toContainText('Step 12');
  await screenshot(page, info, 'phone-long-larger-type');
  const reader = surface(page).locator('[data-workspace-scroll]');
  expect(await reader.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await reader.evaluate(element => { element.scrollTop = element.scrollHeight; }); await expect(surface(page).getByText('Step 12', { exact: true })).toBeInViewport();
  const position = await reader.evaluate(element => element.scrollTop);
  await ask(page, 'A short explanation'); await back(page).click();
  await expect.poll(() => reader.evaluate(element => element.scrollTop)).toBe(position);
  await expect(surface(page).getByText('Step 12', { exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 844, height: 390 }); await expect(surface(page).getByRole('button', { name: 'Close assistant' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await back(page).click(); await expect(surface(page)).toHaveAttribute('data-workspace-transition', 'settled');
  await expect(back(page)).toBeFocused();
});

test('a final calculation stays inside its acknowledged detail without an empty second column', async ({ page }) => {
  const h = await harness(page);
  await ask(page, 'Calculate in the current detail');
  await expect(surface(page)).toContainText('$30.24');
  await expect(surface(page)).toContainText('hello@harbor.example');
  await expect(surface(page).locator('[data-surface-region]')).toHaveCount(1);
  for (const width of [1440, 393]) {
    await page.setViewportSize({ width, height: 852 });
    await expect(surface(page).locator('[data-surface-supplement]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await ask(page, 'A short explanation');
  expect(h.requests.at(-1)!.context.surface?.answer).toContain('$30.24');
  await back(page).click();
  await expect(surface(page).locator('[data-surface-supplement]')).toContainText('$30.24');
  await expect(surface(page).locator('[data-surface-region]')).toHaveCount(1);
});

test('card spacing follows the finished composer animation without an empty chat band', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await harness(page); await ask(page, 'Watch the making process');
  for (const width of [393, 1440]) {
    await page.setViewportSize({ width, height: width === 393 ? 852 : 1100 });
    await expect.poll(() => page.evaluate(() => {
      const controls = document.querySelector<HTMLElement>('[data-ai-controls]')!;
      const bottom = Math.max(controls.getBoundingClientRect().bottom, ...[...controls.querySelectorAll('[data-visitor-conversation-controls], .platform-conversation-surface')].map(node => node.getBoundingClientRect().bottom));
      const card = document.querySelector('[aria-label="Current information"]')!.getBoundingClientRect();
      return Math.abs(card.top - bottom - (innerWidth <= 800 ? 12 : 16));
    })).toBeLessThan(2);
    const dock = (await page.locator('[data-ai-controls] .platform-conversation-dock').boundingBox())!;
    const input = (await page.getByRole('textbox', { name: 'What would you like to see?', exact: true }).boundingBox())!;
    expect(dock.y + dock.height - input.y - input.height).toBeLessThan(24);
  }
});

test('failed media keeps its description and a keyboard-sized visual viewport keeps controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await harness(page); await ask(page, 'Watch the making process');
  await page.evaluate(() => { Object.assign(window, { YT: { Player: class { constructor() { throw new Error('Synthetic unavailable player'); } } } }); });
  await surface(page).getByRole('button', { name: 'Play A study in clay' }).click();
  await expect(surface(page)).toContainText('This video could not be played'); await expect(surface(page)).toContainText('A quiet look at shaping a vessel');
  await ask(page, 'A long explanation');
  await page.evaluate(() => { Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 400 }); window.visualViewport!.dispatchEvent(new Event('resize')); });
  const card = surface(page).getByRole('article', { name: 'Current information' });
  await expect.poll(async () => { const rect = (await card.boundingBox())!; return rect.y + rect.height; }).toBeLessThanOrEqual(400);
  for (const control of [back(page), surface(page).getByRole('button', { name: 'Close assistant' })]) { const box = (await control.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44); expect(box.y + box.height).toBeLessThan(400); }
});

test('disabled external search rejects the request and retains useful published information', async ({ page }) => {
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  let site: Site = (await post(page, '/api/sites', { name: 'Synthetic reference guide', slug: `surface-guide-${Date.now()}`, kind: 'general' })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, contact: 'help@guide.example', visitor: { ...site.draft.visitor, enabled: true, mode: 'chat' } } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`); await ask(page, 'Open Get in touch'); await expect(surface(page)).toContainText('help@guide.example');
  await ask(page, 'Search the web for a current guide', false);
  await expect(surface(page)).toContainText('help@guide.example'); await expect(surface(page)).toHaveAttribute('aria-busy', 'false');
  const response = await page.request.post(`/api/visitor/${site.slug}/explore`, { headers: { Origin: origin }, data: { requestId: randomUUID(), query: 'Current guide', kind: 'web' } });
  expect(response.ok()).toBe(false);
});

test('gallery gestures stay local; closing returns to unchanged website and scroll', async ({ page }) => {
  await harness(page);
  // Measure the browsing position in the same conversation mode used below.
  // Switching modes removes the outgoing voice dock and changes page height.
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.locator('[data-voice-dock]')).toHaveCount(0);
  const website = page.locator('[data-published-website]'), before = await website.innerText();
  await website.getByText('hello@harbor.example', { exact: true }).scrollIntoViewIfNeeded(); const scroll = await page.evaluate(() => scrollY);
  await ask(page, 'Open the gallery');
  const id = await surface(page).getAttribute('data-surface-state');
  await expect(surface(page).locator('[data-information-grid] [data-grid-presence=present]')).toHaveCount(3);
  await surface(page).locator('[data-information-grid] button').first().click();
  await surface(page).getByRole('button', { name: 'Next photo' }).click(); await expect(surface(page)).toContainText('2 of 3');
  const gallery = surface(page).getByRole('group', { name: 'Photo gallery', exact: true });
  await gallery.press('ArrowRight'); await expect(surface(page)).toContainText('3 of 3');
  await gallery.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 100, clientY: 200 });
  await gallery.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 230, clientY: 205 });
  await expect(surface(page)).toContainText('2 of 3');
  expect(await surface(page).getAttribute('data-surface-state')).not.toBe(id);
  await back(page).click(); await expect(surface(page)).toContainText('3 of 3');
  await surface(page).getByRole('button', { name: 'Forward to next information' }).click(); await expect(surface(page)).toContainText('2 of 3');
  await expect(surface(page)).toHaveAttribute('data-history-direction', 'forward');
  await expect(surface(page).getByRole('button', { name: 'Next card' })).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(surface(page)).toBeHidden();
  expect(await website.innerText()).toBe(before); expect(await page.evaluate(() => scrollY)).toBe(scroll);
});

for (const kind of ['products', 'services'] as const) test(`${kind}: queries, ordering and selection restore retained results and branch correctly`, async ({ page }, info) => {
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  let site: Site = (await post(page, '/api/sites', { name: `Synthetic ${kind}`, slug: `surface-${kind}-${Date.now()}`, kind: 'general' })).site;
  const { records, memberships, relationships, publication: _publication, ...metadata } = websiteTaskFixture(kind, 40); expect(_publication).toBeTruthy();
  let review = (await post(page, `/api/sites/${site.id}/collections`, { action: 'begin', siteRevision: site.revision, metadata })).review;
  review = (await post(page, `/api/sites/${site.id}/collections`, { action: 'append', reviewId: review.id, revision: review.revision, chunk: { records, memberships, relationships } })).review;
  review = (await post(page, `/api/sites/${site.id}/collections`, { action: 'finish', reviewId: review.id, revision: review.revision })).review;
  site = (await post(page, `/api/sites/${site.id}/collections`, { action: 'apply', reviewId: review.id, revision: review.revision, siteRevision: site.revision })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`);
  await ask(page, kind === 'products' ? 'Show me chocolate' : 'Show me remote'); await expect(surface(page)).toContainText('14 items');
  await ask(page, 'Only those under $40'); await expect(surface(page)).toContainText('6 items');
  for (const width of [1440, 1024, 393]) {
    await page.setViewportSize({ width, height: width === 393 ? 852 : 1100 });
    if (kind === 'services') await page.emulateMedia({ reducedMotion: 'reduce' });
    await screenshot(page, info, `${kind}-compact-count-${width}`);
    const count = surface(page).getByRole('heading', { name: '6 items', exact: true });
    const card = surface(page).getByRole('article', { name: 'Current information' });
    const firstItem = surface(page).locator('[data-task-record] h3').first();
    expect(await count.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeLessThanOrEqual(13);
    expect((await firstItem.boundingBox())!.y - (await card.boundingBox())!.y).toBeLessThan(85);
    if (width > 800) {
      const cardBox = (await card.boundingBox())!;
      expect(cardBox.width).toBeCloseTo(Math.min(width * .9, width - 128), 0);
      expect((await back(page).boundingBox())!.x).toBeGreaterThanOrEqual(8);
    }
    await expect(surface(page).getByRole('button', { name: 'Show everything again' })).toHaveCount(0);
    await expect(surface(page).getByLabel('Active criteria')).toHaveCount(0);
    await expect(count).toBeInViewport();
    if (width === 393) {
      const countBox = (await count.boundingBox())!, closeBox = (await surface(page).getByRole('button', { name: 'Close assistant' }).boundingBox())!;
      expect(Math.abs(countBox.y + countBox.height / 2 - closeBox.y - closeBox.height / 2)).toBeLessThan(5);
    }
    const lastItem = surface(page).locator('[data-task-record] h3').last();
    expect((await surface(page).getByLabel('Records needing information').boundingBox())!.y).toBeGreaterThan((await lastItem.boundingBox())!.y);
    for (const button of [back(page), surface(page).getByRole('button', { name: 'Close assistant' })]) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  for (const [maximum, count, expectedWidth] of [[24, 1, 600], [27, 2, 880]]) {
    await ask(page, `Only those under $${maximum}`); await expect(surface(page)).toContainText(`${count} item`);
    const card = surface(page).getByRole('article', { name: 'Current information' });
    expect((await card.boundingBox())!.width).toBeCloseTo(expectedWidth, 0);
    await back(page).click(); await expect(surface(page)).toContainText('6 items');
    await expect(surface(page)).toHaveAttribute('data-workspace-transition', 'settled');
    expect((await card.boundingBox())!.width).toBeCloseTo(1440 * .9, 0);
  }
  await ask(page, 'Sort price descending');
  const order = await surface(page).locator('[data-task-record]').evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.taskRecord));
  await surface(page).getByRole('button', { name: /Read details/ }).first().click(); await expect(surface(page).getByRole('region', { name: 'Record detail' })).toBeVisible();
  await expect(surface(page)).toHaveAttribute('data-pending-request', '');
  await expect(surface(page)).toHaveAttribute('aria-busy', 'false');
  await back(page).click(); await expect(surface(page)).toContainText('6 items');
  await expect(surface(page)).toHaveAttribute('data-workspace-transition', 'settled');
  expect(await surface(page).locator('[data-task-record]').evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.taskRecord))).toEqual(order);
  await surface(page).getByRole('button', { name: 'Forward to next information' }).click(); await expect(surface(page).getByRole('region', { name: 'Record detail' })).toBeVisible();
  await ask(page, 'Go back'); await expect(surface(page)).toContainText('6 items');
  await ask(page, 'Go forward'); await expect(surface(page).getByRole('region', { name: 'Record detail' })).toBeVisible();
  await back(page).click(); await back(page).click(); await back(page).click(); await expect(surface(page)).toContainText('14 items');
  await ask(page, 'Only those under $1'); await expect(surface(page)).toContainText('No matches yet');
  await expect(surface(page).getByRole('button', { name: 'Forward to next information' })).toHaveCount(0);
  await back(page).click(); await expect(surface(page)).toContainText('14 items');
  await expect(surface(page)).toHaveAttribute('aria-busy', 'false');
  const beforeCancelledDetail = await surface(page).getAttribute('data-surface-state');
  const forwardDepth = await surface(page).getAttribute('data-forward-depth');
  let releaseAck: (() => void) | undefined;
  await page.route(/\/api\/visitor\/[^/]+\/tasks$/, async route => {
    if (route.request().postDataJSON().action === 'ack') await new Promise<void>(resolve => { releaseAck = resolve; });
    await route.fallback().catch(() => undefined);
  });
  await surface(page).getByRole('button', { name: /Read details/ }).first().click();
  await expect.poll(() => !!releaseAck).toBe(true);
  await back(page).click(); releaseAck?.();
  await expect(surface(page)).toHaveAttribute('aria-busy', 'false');
  await expect(surface(page)).toHaveAttribute('data-surface-state', beforeCancelledDetail!);
  await expect(surface(page)).toHaveAttribute('data-forward-depth', forwardDepth!);
  await expect(surface(page)).toContainText('14 items');
  await page.unroute(/\/api\/visitor\/[^/]+\/tasks$/);
  const comparedIds = await surface(page).locator('[data-task-record]').evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.taskRecord!).slice(0, 2));
  await page.route(/\/api\/visitor\/[^/]+\/session\/control$/, route => route.fulfill({ status: 204 }));
  await page.route(`**/api/visitor/${site.slug}`, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    const { view } = await post(page, `/api/visitor/${site.slug}/tasks`, { action: 'refresh', sessionId: body.context.taskSession.sessionId });
    const result = await post(page, `/api/visitor/${site.slug}/tasks`, { action: 'execute', sessionId: view.sessionId,
      call: { operationId: randomUUID(), expectedRevision: view.revision, capabilityId: 'selection.compare', input: { records: records.filter(record => comparedIds.includes(record.id)) } } });
    await route.fulfill({ contentType: 'application/x-ndjson', body: [
      { type: 'control', control: { id: randomUUID(), token: 'a'.repeat(43) } },
      { type: 'navigation', id: randomUUID(), target: { kind: 'task', view: result.view } },
      { type: 'done', text: 'Ready.', displaySatisfied: true, availability },
    ].map(event => JSON.stringify(event)).join('\n') + '\n' });
  });
  await ask(page, 'Compare these two');
  const comparison = surface(page).getByRole('region', { name: 'Selection comparison' });
  for (const width of [1440, 393]) {
    await page.setViewportSize({ width, height: width === 393 ? 852 : 1100 });
    await screenshot(page, info, `${kind}-comparison-${width}`);
    const names = records.filter(record => comparedIds.includes(record.id)).map(record => record.name);
    if (width === 1440) {
      await expect(comparison.getByRole('table')).toBeVisible();
      for (const name of names) await expect(comparison.getByRole('columnheader', { name, exact: true })).toBeVisible();
    } else {
      await expect(comparison.getByRole('table')).toBeHidden();
      for (const name of names) await expect(comparison.getByRole('heading', { name, exact: true })).toBeVisible();
      expect(await comparison.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
  }
  await back(page).click(); await expect(surface(page)).toContainText('14 items');
});

test('mock voice shares the restored surface and mode switching preserves committed information', async ({ page }) => {
  await prepareCarouselVoice(page); await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => { window.__visitorVoice.emit({ type: 'response_started', revision: 1 }); window.__visitorVoice.emit({ type: 'navigation', id: 'source', revision: 1, target: { kind: 'source', id: 'section:weddings' } }); });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'source')?.navigationAck?.status)).toBe('applied');
  await page.evaluate(() => { window.__visitorVoice.emit({ type: 'backend_idle', revision: 1, interactionRevision: 0 }); });
  await expect(surface(page)).toHaveAttribute('data-pending-request', '');
  const original = await surface(page).getByRole('article', { name: 'Current information' }).innerText();
  await page.evaluate(() => { window.__visitorVoice.emit({ type: 'response_started', revision: 2 }); window.__visitorVoice.emit({ type: 'navigation', id: 'answer', revision: 2, target: { kind: 'answer', text: 'A related explanation for the current occasion.' } }); });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'answer')?.navigationAck?.status)).toBe('applied');
  await page.evaluate(() => { window.__visitorVoice.emit({ type: 'backend_idle', revision: 2, interactionRevision: 0 }); });
  await expect(surface(page)).toHaveAttribute('data-pending-request', '');
  await page.evaluate(() => { window.__visitorVoice.emit({ type: 'transcript', id: 'back-question', role: 'user', text: 'Go back', revision: 3 }); window.__visitorVoice.emit({ type: 'response_started', revision: 3 }); window.__visitorVoice.emit({ type: 'navigation', id: 'back', revision: 3, target: { kind: 'carousel', action: 'back' } }); });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'back')?.navigationAck?.status)).toBe('applied');
  await page.evaluate(() => { window.__visitorVoice.emit({ type: 'backend_idle', revision: 3, interactionRevision: 0 }); });
  await expect(surface(page)).not.toContainText('A related explanation');
  await page.getByRole('button', { name: 'Chat', exact: true }).click(); await expect(surface(page).getByRole('article', { name: 'Current information' })).toHaveText(original, { useInnerText: true });
  await expect(surface(page).getByRole('button', { name: 'Forward to next information' })).toBeVisible();
  await page.getByRole('button', { name: 'Voice', exact: true }).click(); await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.requests.length)).toBe(2);
  const context = await page.evaluate(() => window.__visitorVoice.requests.at(-1)!.context);
  expect(context.surface?.status).toBe('committed'); expect(context.surface?.subject.join(' ')).toContain('weddings'); expect(context.screen).toBeUndefined();
  expect(context.surface?.next).toHaveLength(1);
  await page.evaluate(() => { window.__visitorVoice.emit({ type: 'transcript', id: 'forward-question', role: 'user', text: 'Go forward', revision: 4 }); window.__visitorVoice.emit({ type: 'response_started', revision: 4 }); window.__visitorVoice.emit({ type: 'navigation', id: 'forward', revision: 4, target: { kind: 'carousel', action: 'forward' } }); });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'forward')?.navigationAck?.status)).toBe('applied');
  await expect(surface(page)).toContainText('A related explanation');
});

test('spoken Home and Start over close the surface without hanging up their own voice session', async ({ page }) => {
  await prepareCarouselVoice(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  for (const [index, action] of ['home', 'start_over'].entries()) {
    const openRevision = index * 2 + 1, closeRevision = openRevision + 1;
    await page.evaluate(revision => {
      window.__visitorVoice.emit({ type: 'response_started', revision });
      window.__visitorVoice.emit({ type: 'navigation', id: `source-${revision}`, revision, target: { kind: 'source', id: 'section:weddings' } });
    }, openRevision);
    await expect.poll(() => page.evaluate(revision => window.__visitorVoice.controls.find(update => update.navigationAck?.id === `source-${revision}`)?.navigationAck?.status, openRevision)).toBe('applied');
    await page.evaluate(revision => window.__visitorVoice.emit({ type: 'backend_idle', revision, interactionRevision: 0 }), openRevision);
    await expect(surface(page)).toBeVisible();
    await page.evaluate(({ revision, action }) => {
      window.__visitorVoice.emit({ type: 'response_started', revision });
      window.__visitorVoice.emit({ type: 'navigation', id: `home-${revision}`, revision, target: { kind: 'carousel', action } });
    }, { revision: closeRevision, action });
    await expect.poll(() => page.evaluate(revision => window.__visitorVoice.controls.find(update => update.navigationAck?.id === `home-${revision}`)?.navigationAck?.status, closeRevision)).toBe('applied');
    await expect(surface(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__visitorVoice.closed)).toBe(0);
    await page.evaluate(revision => window.__visitorVoice.emit({ type: 'backend_idle', revision, interactionRevision: 0 }), closeRevision);
  }
});

test('transition sampling keeps a nonempty surface, bounded geometry and an unchanged media instance', async ({ page }, info) => {
  await harness(page); await ask(page, 'Watch the making process');
  await page.evaluate(() => {
    const samples: unknown[] = []; Object.assign(window, { __surfaceFrames: samples });
    const start = performance.now();
    const sample = () => { const card = document.querySelector('[aria-label="Current information"]')!, rect = card.getBoundingClientRect(); samples.push({ ms: Math.round(performance.now() - start), width: rect.width, height: rect.height, regions: document.querySelectorAll('[data-surface-region]').length, moving: document.querySelector('[data-information-surface]')?.getAttribute('data-workspace-transition') }); if (performance.now() - start < 1800) requestAnimationFrame(sample); }; requestAnimationFrame(sample);
  });
  await mkdir('docs/screenshots/information-surface', { recursive: true });
  const transition = ask(page, 'Explain the technique');
  for (const index of [0, 1, 2, 3]) {
    await page.screenshot({ path: `docs/screenshots/information-surface/transition-${index}.png` });
    await page.waitForTimeout(100); // Deliberate visual sampling of the transition, not state synchronization.
  }
  await transition;
  const frames = await page.evaluate(() => (window as unknown as { __surfaceFrames: { width: number; height: number; regions: number; moving: string }[] }).__surfaceFrames);
  expect(frames.every(frame => frame.regions >= 1 && frame.width <= page.viewportSize()!.width * .8 + 1 && frame.height > 0)).toBe(true);
  expect(new Set(frames.map(frame => Math.round(frame.width))).size).toBeGreaterThan(5);
  await writeFile(info.outputPath('transition-frames.json'), JSON.stringify(frames, null, 2));
  await writeFile('docs/screenshots/information-surface/transition-frames.json', JSON.stringify(frames, null, 2));
  await info.attach('transition-frames', { path: info.outputPath('transition-frames.json'), contentType: 'application/json' });
});
