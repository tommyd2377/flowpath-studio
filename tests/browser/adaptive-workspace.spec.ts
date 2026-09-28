import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { semanticFixture } from '../../fixtures/semantic-knowledge/graph';
import type { Site } from '../../lib/site-model';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { WorkspaceScene } from '@thevoice/platform-ui/workspace';

const origin = 'http://127.0.0.1:3225';
async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post(path, { headers: { Origin: origin }, data });
  const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body;
}
async function prepare(page: Page, domain = 'studio', reviewGraph?: (graph: KnowledgeCatalog) => void) {
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  await page.addInitScript(() => {
    const win = window as typeof window & { __workspaceContexts: { scene?: WorkspaceScene }[] };
    win.__workspaceContexts = [];
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (init?.method === 'POST' && /\/api\/visitor\/[^/]+$/.test(String(input))) win.__workspaceContexts.push(JSON.parse(String(init.body)).context);
      return original(input, init);
    };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error('Offline fixture: no microphone'); };
  });
  let site: Site = (await post(page, '/api/sites', { name: domain === 'bookstore' ? 'Harbor Books' : 'Harbor Studio', slug: `adaptive-${domain}-${Date.now()}`, kind: 'general' })).site;
  async function upload(name: string, contentType: string, data: Buffer) {
    const response = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': contentType, 'X-File-Name': name, 'X-Site-Revision': String(site.revision) }, data });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); site = body.site; return body.fileId as string;
  }
  // Real local extraction first, then an explicit synthetic publisher review of the handoff graph.
  const fileId = await upload('reviewed-business.txt', 'text/plain', await readFile('fixtures/semantic-knowledge/business.txt'));
  const path = `/api/sites/${site.id}/knowledge`;
  let review = await post(page, path, { action: 'analyze', revision: site.revision, fileId, requestId: randomUUID() });
  let graph = JSON.parse(JSON.stringify({ ...semanticFixture, id: review.candidates[0].catalog.id })) as KnowledgeCatalog;
  graph.entities = graph.entities.map(entity => ({ ...entity, summary: entity.id === 'blue' ? 'A reviewed item with extensive reading context. '.repeat(30) : entity.summary }));
  if (domain === 'bookstore') { graph.entities.find(entity => entity.id === 'blue')!.name = 'Harbor Almanac'; graph.entities.find(entity => entity.id === 'white')!.name = 'Field Guide'; }
  reviewGraph?.(graph);
  review = await post(page, path, { action: 'revise', revision: site.revision, candidateId: review.candidates[0].id, catalog: graph });
  const applied = await post(page, path, { action: 'apply', revision: site.revision, candidateId: review.candidates[0].id });
  site = applied.site; graph = applied.catalog;
  const ids = [];
  for (const color of ['#698aa0', '#bdaf78']) ids.push(await upload(`synthetic-${ids.length}.png`, 'image/png', await sharp({ create: { width: 640, height: 480, channels: 3, background: color } }).png().toBuffer()));
  const result = await post(page, `/api/sites/${site.id}/media`, { revision: site.revision, library: { schemaVersion: 1, id: randomUUID(),
    assets: ids.map((id, index) => ({ id, width: 640, height: 480, caption: `Reviewed photo ${index + 1}`, alt: `Synthetic approved item ${index + 1}`, credit: 'Synthetic publisher credit' })),
    albums: [{ id: 'items', title: 'Items', description: 'Publisher-chosen order', assetIds: [ids[1], ids[0]] }],
    associations: ids.map((assetId, index) => ({ id: `link-${index}`, assetId, targetType: 'entity', targetId: 'blue', role: index ? 'example' : 'depicts', primary: !index })),
  } }); site = result.site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft,
    style: { layout: domain === 'bookstore' ? 'compact' : 'balanced', palette: domain === 'bookstore' ? 'parchment' : 'midnight' },
    visitorSpeaksFirst: true, visitor: { ...site.draft.visitor, enabled: true, mode: 'chat' },
    greetingPoints: [{ kind: 'fact', id: 'address' }, null, { kind: 'custom', text: 'Explore at your own pace.' }],
  } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`);
  return { site, catalog: graph, ids, media: result.library };
}
const cards = (page: Page) => page.locator('.platform-workspace-card');
const focus = (page: Page) => page.locator('[data-workspace-focused]:not([inert])');
async function ask(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill(text); await page.getByRole('button', { name: 'Show me', exact: true }).click();
  await expect(input).toHaveValue('');
  // Input clears at dispatch; wait for the completed request before inspecting its context.
  await expect(page.getByRole('button', { name: 'Show me', exact: true })).toBeVisible();
  await expect(page.locator('.visitor-workspace [role="alert"]')).toHaveCount(0);
}
async function settled(page: Page) { await expect(focus(page)).toHaveAttribute('data-workspace-transition', 'settled'); }

for (const mobile of [false, true]) test(`typed chat navigates the complete panel lifecycle${mobile ? ' on mobile' : ''}`, async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); }
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  let site: Site = (await post(page, '/api/sites', { name: 'Panel navigation walkthrough', slug: `panel-chat-${randomUUID().slice(0, 10)}`, kind: 'photographer' })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft,
    visitorSpeaksFirst: true, visitor: { ...site.draft.visitor, enabled: true, mode: 'chat' },
  } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`);
  await ask(page, 'Open Wedding stories'); await settled(page);
  await expect(focus(page).getByRole('heading', { name: 'Wedding stories', exact: true })).toBeVisible();
  await ask(page, 'Open Portrait sessions'); await settled(page);
  await expect(cards(page)).toHaveCount(2);
  await expect(focus(page).getByRole('heading', { name: 'Portrait sessions', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('01-two-panels.png') });
  await ask(page, 'Go back to the workspace');
  await expect(page.locator('[data-workspace-focused]')).toHaveCount(0);
  await expect(cards(page)).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('02-workspace-overview.png') });
  await ask(page, 'Open Wedding stories'); await settled(page);
  await ask(page, 'Close Portrait sessions');
  await expect(cards(page)).toHaveCount(1);
  await expect(focus(page).getByRole('heading', { name: 'Wedding stories', exact: true })).toBeVisible();
  // Repeating a named close must not substitute the remaining foreground panel.
  await page.getByRole('textbox', { name: 'What would you like to see?', exact: true }).fill('Close Portrait sessions');
  await page.getByRole('button', { name: 'Show me', exact: true }).click();
  await expect(page.locator('.visitor-workspace [role="alert"]')).toContainText('Which open object do you mean?');
  await expect(cards(page)).toHaveCount(1);
  await expect(focus(page).getByRole('heading', { name: 'Wedding stories', exact: true })).toBeVisible();
  await ask(page, 'Expand this panel'); await expect(cards(page).first()).toHaveAttribute('data-expanded', 'true');
  await ask(page, 'Collapse this panel');
  await expect(page.locator('[data-workspace-focused]')).toHaveCount(0);
  await expect(cards(page).first()).toHaveAttribute('data-expanded', 'false');
  await ask(page, 'Open Portrait sessions'); await settled(page);
  await ask(page, 'Close this panel'); await expect(cards(page)).toHaveCount(1);
  await expect(page.locator('[data-workspace-focused]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('03-partial-close.png') });
  await ask(page, 'Close all panels');
  await expect(cards(page)).toHaveCount(0); await expect(page.locator('[data-workspace-focused]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('04-cleared.png') });
  await ask(page, 'Open Contact'); await settled(page);
  await expect(focus(page)).toContainText('hello@sophie.example');
  await ask(page, 'Go home'); await expect(cards(page)).toHaveCount(0);
  await ask(page, 'Browse the website'); await expect(page.locator('[data-published-website]')).toBeVisible();
  await ask(page, 'Open Wedding stories'); await settled(page);
  await ask(page, 'Go back to the workspace');
  await expect(page.locator('[data-workspace-focused]')).toHaveCount(0);
  await expect(page.locator('[data-published-website]')).toHaveCount(0);
  await expect(cards(page)).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('05-reopened.png') });
  // Exercise keyboard focus/return on these same panels, independently of the
  // catalog's website-query surface. The mobile case has reduced motion enabled.
  await expect(page.locator('.platform-conversation-backdrop')).toHaveCount(0);
  const opener = cards(page).first().locator('[data-workspace-open]');
  await opener.scrollIntoViewIfNeeded(); await opener.focus(); await opener.press('Enter'); await settled(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-workspace-focused]')).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(cards(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('address/email/photo/map objects coexist, return symmetrically, and keyboard lightbox is modal', async ({ page }, info) => {
  const { site, ids } = await prepare(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('.platform-workspace-content-list')).toHaveCount(0);
  await ask(page, 'Show me the address'); await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText('12 Example Lane');
  await ask(page, 'Show me the email too'); await expect(cards(page)).toHaveCount(2);
  await ask(page, 'Show Items collection'); await expect(cards(page)).toHaveCount(3);
  const gallery = page.locator('.platform-workspace-card[data-workspace-component="gallery"]');
  await expect(gallery.locator('img').first()).toHaveAttribute('src', new RegExp(ids[1]));
  await ask(page, 'Open the first photo from Items collection'); await settled(page); await expect(cards(page)).toHaveCount(4);
  await expect(focus(page)).toContainText('Reviewed photo 2'); await expect(focus(page)).toContainText('Example photo');
  await focus(page).getByRole('button', { name: 'Back to workspace' }).click(); await expect(focus(page)).toHaveCount(0);
  await ask(page, 'Show a map too'); await expect(cards(page)).toHaveCount(5);
  await expect(page.locator('[data-workspace-component="map"]')).toContainText('No pin was invented');
  await ask(page, 'Close the map but keep the photo'); await expect(cards(page)).toHaveCount(4);
  const photo = page.locator('.platform-workspace-card[data-workspace-component="photo"]');
  const opener = photo.getByRole('button', { name: 'Open Reviewed photo 2', exact: true });
  // Request completion can precede the composer/backdrop exit. Measure the
  // source position after that transition, before the separate photo motion.
  await expect(page.locator('.platform-conversation-backdrop')).toHaveCount(0);
  await expect.poll(() => page.locator('.platform-conversation-surface').evaluate(element => Number(getComputedStyle(element).getPropertyValue('--composer-progress')))).toBe(0);
  await opener.scrollIntoViewIfNeeded();
  const originRect = await photo.boundingBox();
  const scroll = await page.evaluate(() => scrollY);
  // Measure during both directions, not just the final screenshot.
  await opener.click(); await page.waitForTimeout(120); const entering = await focus(page).boundingBox();
  await settled(page); const centered = await focus(page).boundingBox();
  expect(Math.abs(entering!.y - centered!.y) + Math.abs(entering!.width - centered!.width)).toBeGreaterThan(3);
  expect(Math.abs(centered!.x + centered!.width / 2 - 720)).toBeLessThan(20);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await page.screenshot({ path: info.outputPath('desktop-photo-focus.png') });
  await focus(page).getByRole('button', { name: 'Back to workspace' }).click();
  const returning = page.locator('[data-workspace-transition="returning"]'); await expect(returning).toHaveCount(1);
  await page.waitForTimeout(120); const midway = await returning.boundingBox();
  expect(midway!.width).toBeLessThan(centered!.width); expect(midway!.width).toBeGreaterThan(originRect!.width - 3);
  await page.screenshot({ path: info.outputPath('desktop-photo-return-intermediate.png') });
  await expect(returning).toHaveCount(0); await expect(opener).toBeFocused();
  await expect(photo).toBeVisible(); expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await opener.press('Enter'); await settled(page);
  await focus(page).getByRole('button', { name: 'Open photo: Reviewed photo 2', exact: true }).click();
  const modal = page.getByRole('dialog'); await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Close photo' })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(modal.getByRole('button', { name: 'Home', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(modal.getByRole('button', { name: 'Close photo' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0); await expect(focus(page)).toHaveCount(1);
  await focus(page).getByRole('button', { name: 'Open photo: Reviewed photo 2', exact: true }).click();
  await modal.getByRole('img').click(); await expect(modal).toHaveCount(0); await expect(focus(page)).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(focus(page)).toHaveCount(0); await expect(opener).toBeFocused();
  await ask(page, "I'm done with this photo"); await expect(cards(page)).toHaveCount(3);
  await ask(page, 'Replace everything with the email'); await expect(cards(page)).toHaveCount(1);
  expect(await (await page.request.get(`/api/public-files/${site.slug}/${site.files[0].id}`)).status()).toBe(404);
  const html = await (await page.request.get(`/s/${site.slug}`)).text();
  expect(html).not.toContain('reviewed-business.txt'); expect(html).not.toContain('sourceArtifacts');
  expect(errors).toEqual([]);
});

for (const domain of ['studio', 'bookstore']) test(`${domain}: narrow/mobile reduced-motion fallback keeps instances, filters and reading position`, async ({ page }, info) => {
  const { site } = await prepare(page, domain);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize({ width: 390, height: 844 });
  await ask(page, domain === 'studio' ? 'Show Blue Bowl and White Bowl' : 'Show Harbor Almanac and Field Guide');
  await expect(cards(page)).toHaveCount(2);
  const first = cards(page).first(), opener = first.locator('[data-workspace-open]');
  await opener.scrollIntoViewIfNeeded(); await opener.focus(); await page.keyboard.press('Enter');
  await settled(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const reading = focus(page).locator('[data-workspace-scroll]');
  await reading.evaluate(node => { node.scrollTop = 200; });
  await page.keyboard.press('Escape'); await expect(focus(page)).toHaveCount(0); await expect(opener).toBeFocused();
  await opener.press('Enter'); await settled(page); expect(await reading.evaluate(node => node.scrollTop)).toBeGreaterThan(150);
  const focusedBounds = await focus(page).boundingBox();
  const composerBounds = await page.locator('.platform-conversation-surface').boundingBox();
  expect(focusedBounds!.y).toBeGreaterThanOrEqual(composerBounds!.y + composerBounds!.height + 8);
  await page.screenshot({ path: info.outputPath(`${domain}-phone-focus.png`) });
  await page.keyboard.press('Escape'); await expect(focus(page)).toHaveCount(0);
  await ask(page, 'Show Classes and events collection'); await expect(cards(page)).toHaveCount(3);
  const collection = page.locator('.platform-workspace-card[data-workspace-component="collection"]');
  const filter = collection.getByRole('textbox', { name: 'Filter this collection' });
  await filter.fill('Clay'); await expect(collection.locator('.platform-workspace-content-list > li')).toHaveCount(1);
  await collection.locator('[data-workspace-open]').click(); await settled(page);
  await page.keyboard.press('Escape'); await expect(focus(page)).toHaveCount(0); await expect(filter).toHaveValue('Clay');
  // AI exhaustion does not remove the content browser or its local controls.
  await page.route(`**/api/visitor/${site.slug}`, route => route.fulfill({ json: { availability: { enabled: true, mode: 'chat', live: false, chatRemaining: 0, voiceRemaining: 0, resetsAt: '' } } }));
  await page.reload(); await page.getByRole('button', { name: 'Browse published content' }).click();
  const directory = page.getByRole('region', { name: 'Browse approved information' });
  await directory.getByRole('textbox').fill('Address'); await directory.locator('[data-workspace-content]').first().press('Enter');
  await settled(page); await expect(focus(page)).toContainText('12 Example Lane');
  await page.keyboard.press('Escape'); await expect(focus(page)).toHaveCount(0);
  await expect(directory.locator('[data-workspace-content]').first()).toBeFocused();
});

test('nested gallery return restores its filter, reading position and exact photo control', async ({ page }) => {
  await prepare(page); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize({ width: 390, height: 844 });
  await ask(page, 'Show Items collection');
  await cards(page).locator('[data-workspace-open]').click(); await settled(page);
  await focus(page).getByRole('textbox', { name: 'Filter this gallery' }).fill('Reviewed');
  const secondPhoto = focus(page).getByRole('button', { name: 'Open Reviewed photo 1', exact: true });
  await secondPhoto.scrollIntoViewIfNeeded();
  const before = await focus(page).locator('[data-workspace-scroll]').evaluate(node => node.scrollTop);
  expect(before).toBeGreaterThan(40);
  await secondPhoto.click(); await settled(page); await expect(focus(page)).toContainText('Synthetic publisher credit');
  await focus(page).getByRole('button', { name: 'Back to workspace' }).click();
  await expect(focus(page)).toHaveAttribute('data-workspace-component', 'gallery'); await settled(page);
  await expect(focus(page).getByRole('textbox', { name: 'Filter this gallery' })).toHaveValue('Reviewed');
  await expect(focus(page).getByRole('button', { name: 'Open Reviewed photo 1', exact: true })).toBeFocused();
  expect(await focus(page).locator('[data-workspace-scroll]').evaluate(node => node.scrollTop)).toBeCloseTo(before, 0);
  await expect(cards(page)).toHaveCount(2);
});

test('publisher presets and three greeting slots work in a narrow Studio preview and publication', async ({ page }, info) => {
  const { site } = await prepare(page); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await page.getByRole('combobox', { name: 'Current site', exact: true }).selectOption(site.id);
  await expect(page.locator('.breadcrumbs strong')).toHaveText(site.draft.name);
  const navigation = page.getByRole('navigation', { name: 'Workspace', exact: true });
  await navigation.getByRole('button', { name: 'Branding', exact: true }).click();
  await page.getByRole('button', { name: 'Mobile preview', exact: true }).click();
  const preview = page.locator('.preview-scroll');
  for (const [layout, palette] of [['balanced', 'midnight'], ['editorial', 'forest'], ['compact', 'parchment']]) {
    await page.getByRole('combobox', { name: 'Visitor layout', exact: true }).selectOption(layout);
    await page.getByRole('combobox', { name: /Visitor palette/ }).selectOption(palette);
    await expect(preview.locator('[data-workspace-palette]')).toHaveAttribute('data-workspace-palette', palette);
    await expect(preview.locator('[data-workspace-layout]')).toHaveAttribute('data-workspace-layout', layout);
    await preview.getByRole('button', { name: 'Browse published content', exact: true }).click();
    const directory = preview.getByRole('region', { name: 'Browse approved information' });
    await directory.getByRole('textbox').fill('Blue Bowl');
    await directory.getByRole('button', { name: 'Open Blue Bowl', exact: true }).click(); await settled(page);
    const bounds = (await preview.boundingBox())!, active = (await focus(page).boundingBox())!;
    expect(active.x).toBeGreaterThanOrEqual(bounds.x); expect(active.x + active.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    expect(active.y).toBeGreaterThanOrEqual(bounds.y); expect(active.y + active.height).toBeLessThanOrEqual(Math.min(1100, bounds.y + bounds.height) + 1);
    await page.screenshot({ path: info.outputPath(`studio-${layout}-${palette}.png`) });
    await focus(page).getByRole('button', { name: 'Back to workspace' }).click(); await expect(focus(page)).toHaveCount(0);
  }
  await navigation.getByRole('button', { name: 'The Voice', exact: true }).click();
  const welcome = page.getByRole('region', { name: 'Voice welcome', exact: true });
  await welcome.getByRole('combobox', { name: 'Who speaks first?' }).selectOption('assistant');
  await welcome.getByRole('combobox', { name: 'Greeting point 1', exact: true }).selectOption('fact:address');
  await welcome.getByRole('combobox', { name: 'Greeting point 2', exact: true }).selectOption('fact:email');
  await welcome.getByRole('combobox', { name: 'Greeting point 3', exact: true }).selectOption('');
  await welcome.getByText('Preview introduction', { exact: true }).click();
  await expect(welcome.getByLabel('Spoken greeting text preview')).toContainText('12 Example Lane');
  await expect(welcome.getByLabel('Spoken greeting text preview')).toContainText('hello@harbor.example');
  await welcome.getByRole('combobox', { name: 'Who speaks first?' }).selectOption('visitor');
  await expect(welcome.getByRole('combobox', { name: 'Who speaks first?' })).toHaveValue('visitor');
  const save = page.getByRole('region', { name: 'Site editor', exact: true }).getByRole('button', { name: 'Save draft', exact: true });
  await save.click(); await expect(save).toBeDisabled();
  const draft = (await (await page.request.get(`/api/sites/${site.id}`)).json()).site as Site;
  expect(draft.draft.greetingPoints).toEqual([{ kind: 'fact', id: 'address' }, { kind: 'fact', id: 'email' }, null]);
  expect(draft.published!.style?.palette).toBe('midnight');
  await page.locator('.publish-button').click(); await page.getByRole('button', { name: 'Publish locally', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish locally', exact: true })).toHaveCount(0);
  await page.goto(`/s/${site.slug}`); await expect(page.locator('[data-workspace-palette]')).toHaveAttribute('data-workspace-palette', 'parchment');
  await expect(cards(page)).toHaveCount(0);
});

test('integration: approved conditional relationships reach the public page and remain qualified in the next request', async ({ page }, info) => {
  const { site } = await prepare(page, 'studio', graph => {
    graph.relationships = [{ id: 'mentor', fromEntityId: 'mira', toEntityId: 'glaze', kind: 'mentors', label: 'Mentors', qualifiers: [{ predicate: 'during', value: 'summer' }] }];
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const html = await (await page.request.get(`/s/${site.slug}`)).text();
  expect(html.includes('mentors'), 'the public snapshot must retain the approved relationship').toBe(true);
  await ask(page, 'Open Mira'); await settled(page);
  await focus(page).getByRole('button', { name: 'More context', exact: true }).click();
  await expect(focus(page)).toContainText('Mentors');
  await expect(focus(page)).toContainText('conditional: during: summer');
  await expect(focus(page).getByRole('button', { name: 'Glaze Lab', exact: true })).toBeVisible();
  await ask(page, 'Show me the email too');
  const context = await page.evaluate(() => (window as typeof window & { __workspaceContexts: { scene: WorkspaceScene }[] }).__workspaceContexts.at(-1)!);
  expect(context.scene.objects.find(object => object.name === 'Mira')?.expanded).toBe(true);
  expect(JSON.stringify(context)).not.toMatch(/reviewed-business.txt|anchorIds|correctionHistory|sourceKey/);
  await page.screenshot({ path: info.outputPath('qualified-relationship.png') });
  await focus(page).getByRole('button', { name: 'Back to workspace' }).click(); await expect(focus(page)).toHaveCount(0);
  await page.route('**/api/public-files/**', route => route.abort('failed'));
  await ask(page, 'Open Reviewed photo 1'); await settled(page);
  await expect(focus(page)).toContainText('Photo unavailable');
  await focus(page).getByRole('button', { name: 'Back to workspace' }).click(); await expect(focus(page)).toHaveCount(0);
  await expect(cards(page)).toHaveCount(3);
});

test('integration: reading-container clipping is reflected in the acknowledged child scene', async ({ page }, info) => {
  await prepare(page); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await ask(page, 'Show Items collection'); await cards(page).locator('[data-workspace-open]').click(); await settled(page);
  // Put an entire child behind the reading viewport's top edge, but still
  // inside the outer focused card. The geometric oracle does not use scene code.
  const clipped = await focus(page).evaluate(node => {
    const reading = node.querySelector<HTMLElement>('[data-workspace-scroll]')!;
    const items = node.querySelectorAll<HTMLElement>('[data-workspace-content]');
    const spacer = document.createElement('div'); spacer.style.height = '700px'; reading.append(spacer);
    const top = reading.getBoundingClientRect().top;
    reading.scrollTop += items[0].getBoundingClientRect().bottom - top + 8;
    return { key: items[0].dataset.workspaceContent!, bottom: items[0].getBoundingClientRect().bottom, readingTop: top, outerTop: node.getBoundingClientRect().top };
  });
  expect(clipped.bottom).toBeLessThan(clipped.readingTop);
  expect(clipped.bottom).toBeGreaterThan(clipped.outerTop);
  await ask(page, 'Show me the email too');
  const observed = await page.evaluate(() => (window as typeof window & { __workspaceContexts: { scene: WorkspaceScene }[] }).__workspaceContexts.at(-1)!.scene);
  const item = observed.objects.flatMap(object => object.items ?? []).find(item => `${item.reference.kind}:${item.reference.revisionId}:${item.reference.id}` === clipped.key);
  expect(item).toBeDefined(); expect(item!.visible).toBe(false);
  await page.screenshot({ path: info.outputPath('clipped-gallery-scene.png') });
});

test('integration: real CSV Apply and Publish exposes separately controlled contact facts without a replacement graph', async ({ page }) => {
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  let site: Site = (await post(page, '/api/sites', { name: 'Contact fixture', slug: `contact-${Date.now()}`, kind: 'general' })).site;
  const uploaded = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': 'text/csv', 'X-File-Name': 'independent-contact.csv', 'X-Site-Revision': String(site.revision) }, data: Buffer.from('Name,Kind,Address,Email\nHarbor Studio,business,12 Example Lane,hello@harbor.example') });
  expect(uploaded.ok()).toBe(true); const body = await uploaded.json(); site = body.site;
  const path = `/api/sites/${site.id}/knowledge`;
  const review = await post(page, path, { action: 'analyze', revision: site.revision, fileId: body.fileId, requestId: randomUUID() });
  site = (await post(page, path, { action: 'apply', revision: site.revision, candidateId: review.candidates[0].id })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, visitor: { ...site.draft.visitor, enabled: true, mode: 'chat' } } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`);
  await ask(page, 'Show me the address'); await expect(cards(page)).toHaveCount(1); await expect(cards(page)).toContainText('12 Example Lane');
  await ask(page, 'Show me the email too'); await expect(cards(page)).toHaveCount(2); await expect(cards(page).last()).toContainText('hello@harbor.example');
  await cards(page).first().getByRole('button', { name: /Close Address/ }).click(); await expect(cards(page)).toHaveCount(1); await expect(cards(page)).toContainText('hello@harbor.example');
  expect((await (await page.request.get(`/s/${site.slug}`)).text()).includes('independent-contact.csv')).toBe(false);
});

test('integration: long published details use bounded native field pages', async ({ page }) => {
  await prepare(page, 'studio', graph => {
    for (let i = 0; i < 23; i++) {
      graph.attributes.push({ id: `long-${i}`, label: `Long field ${i}`, type: 'text' });
      graph.entities.find(entity => entity.id === 'blue')!.attributes[`long-${i}`] = 'Long approved description. '.repeat(35);
    }
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Browse published content' }).click();
  const directory = page.getByRole('region', { name: 'Browse approved information' });
  await ask(page, 'Search for Blue Bowl');
  await expect(directory.getByRole('region', { name: 'Website content' })).toHaveAttribute('aria-busy', 'false');
  await directory.getByRole('button', { name: 'Open Blue Bowl', exact: true }).click();
  const detail = directory.getByRole('region', { name: 'Record detail' });
  await expect(detail).toContainText('Long field 0'); await expect(detail).toContainText('Long approved description.');
  await expect(directory.getByRole('region', { name: 'Website content' })).toHaveAttribute('aria-busy', 'false');
  await detail.getByRole('button', { name: 'More published details' }).click();
  await expect(detail).toContainText('Long field 22');
  await expect(directory.getByRole('region', { name: 'Website content' })).toHaveAttribute('aria-busy', 'false');
  await directory.getByRole('button', { name: 'Back to results' }).click();
  await expect(detail).toHaveCount(0); expect(errors).toEqual([]);
});

test('explicit v2 migration keeps publisher links and shared photo albums in query browsing', async ({ page }) => {
  let { site } = await prepare(page, 'studio', graph => { graph.capabilities = [{ id: 'publisher-contact', kind: 'link', label: 'Publisher contact', url: 'https://example.com/contact', entityIds: ['mira'] }]; });
  const migration = await post(page, `/api/sites/${site.id}/collections`, { action: 'migrate', siteRevision: site.revision });
  expect(migration.review.metadata.links[0].id).toBe('publisher-contact');
  site = (await post(page, `/api/sites/${site.id}/collections`, { action: 'apply', reviewId: migration.review.id, revision: migration.review.revision, siteRevision: site.revision })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`); await page.getByRole('button', { name: 'Browse published content' }).click();
  const results = page.getByRole('region', { name: 'Website content', exact: true });
  await expect(results.getByRole('link', { name: 'Publisher contact' })).toHaveAttribute('href', 'https://example.com/contact');
  await ask(page, 'Show me Published photos');
  await expect(results.getByRole('status')).toHaveText('2 matching items');
  await expect(results).toHaveAttribute('aria-busy', 'false');
  await expect(results.getByRole('img', { name: 'Synthetic approved item 1', exact: true })).toBeVisible();
  await expect(results.getByText('Example photo', { exact: true })).toBeVisible();
  await ask(page, 'Show me Items');
  await expect(results.locator('[data-task-record]')).toHaveCount(2);
});
