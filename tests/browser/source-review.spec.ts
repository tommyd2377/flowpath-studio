import { test, expect, type Page, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Site } from '../../lib/site-model';
import type { KnowledgeCandidate } from '../../lib/knowledge-model';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';

const origin = 'http://127.0.0.1:3225';
async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post(path, { headers: { Origin: origin }, data });
  const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); return body;
}
async function readSite(page: Page, id: string): Promise<Site> {
  const response = await page.request.get(`/api/sites/${id}`); expect(response.ok()).toBeTruthy(); return (await response.json()).site;
}
async function clickAction(page: Page, siteId: string, button: Locator) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === `/api/sites/${siteId}/knowledge` && response.request().method() === 'POST');
  await button.click(); const response = await pending; const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBeTruthy(); return body;
}

test('source excerpts and explicit replacement preserve corrections, resolve updates and publish reusable visitor data', async ({ page, context }, info) => {
  const external: string[] = []; const visitorCalls: string[] = []; const errors: string[] = [];
  await context.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort('blockedbyclient'); }
    if (route.request().method() === 'POST' && /^\/api\/visitor\/[^/]+$/.test(url.pathname)) { visitorCalls.push(url.pathname); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  await context.addInitScript(() => {
    const current = window as typeof window & { __sourceMicrophones: number }; current.__sourceMicrophones = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { current.__sourceMicrophones++; throw new Error('No microphone in source review tests.'); };
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let site: Site = (await post(page, '/api/sites', { name: 'Source Review Proof', slug: `source-review-${Date.now()}`, kind: 'general' })).site;
  async function upload(name: string, contentType: string, bytes: Buffer) {
    const response = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': contentType, 'X-File-Name': name, 'X-Site-Revision': String(site.revision) }, data: bytes });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); site = body.site; return body.fileId as string;
  }
  const source = 'ID,Name,Summary,Price [USD]\nalpha,Alpha Workshop,Small group introduction,10\nbeta,Beta Workshop,Practice with an instructor,20\ngamma,Gamma Workshop,Independent practice,30\n';
  const fileId = await upload('workshops.csv', 'text/csv', Buffer.from(source));
  const path = `/api/sites/${site.id}/knowledge`;
  let candidate: KnowledgeCandidate = (await post(page, path, { action: 'analyze', revision: site.revision, fileId, requestId: randomUUID() })).candidates[0];
  const alphaId = candidate.catalog.entities.find(entity => entity.name === 'Alpha Workshop')!.id;
  const gammaId = candidate.catalog.entities.find(entity => entity.name === 'Gamma Workshop')!.id;
  const priceId = candidate.catalog.attributes.find(attribute => attribute.type === 'money')!.id;
  const corrected = structuredClone(candidate.catalog);
  corrected.entities.find(entity => entity.id === alphaId)!.attributes[priceId] = 12;
  candidate = (await post(page, path, { action: 'revise', revision: site.revision, candidateId: candidate.id, catalog: corrected })).candidates[0];
  site = (await post(page, path, { action: 'apply', revision: site.revision, candidateId: candidate.id, candidateRevisionId: candidate.catalog.id })).site;
  const photoId = await upload('workshop-photo.png', 'image/png', await sharp({ create: { width: 720, height: 480, channels: 3, background: '#91a7b5' } }).png().toBuffer());
  const photo = site.files.find(file => file.id === photoId)!.image!;
  const library: MediaLibrary = { schemaVersion: 1, id: randomUUID(), assets: [{ id: photoId, width: photo.width, height: photo.height, caption: 'Workshop space', alt: 'Synthetic workshop photo' }],
    albums: [{ id: 'workshops', title: 'Workshop photos', description: '', assetIds: [photoId] }],
    associations: [alphaId, gammaId].map(targetId => ({ id: randomUUID(), assetId: photoId, targetType: 'entity', targetId, role: 'depicts', primary: true })) };
  site = (await post(page, `/api/sites/${site.id}/media`, { revision: site.revision, library })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  const publishedRevision = site.published!.knowledgeRevisionId;
  const changed = 'ID,Name,Summary,Price [USD]\nalpha,Alpha Workshop,Small group introduction,15\nbeta,Beta Workshop,Practice with an instructor,22\ndelta,Delta Workshop,Advanced practice,40\n';
  const replacement = await upload('workshops-september.csv', 'text/csv', Buffer.from(changed));

  await page.goto('/');
  const picker = page.getByRole('combobox', { name: 'Current site', exact: true });
  if (await picker.inputValue() !== site.id) {
    const switched = page.waitForResponse(response => new URL(response.url()).pathname === `/api/sites/${site.id}` && response.request().method() === 'GET');
    await picker.selectOption(site.id); expect((await switched).ok()).toBeTruthy();
  }
  await expect(picker).toHaveValue(site.id); await expect(picker).toBeEnabled();
  await expect(page.locator('.breadcrumbs strong')).toHaveText('Source Review Proof');
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Knowledge', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Source file', exact: true }).selectOption(replacement);
  const target = page.getByRole('combobox', { name: /^How should this file be used\?/ });
  await expect(target.locator('option:checked')).toHaveText('Add as new source');
  await target.selectOption({ label: 'Replace workshops.csv' });
  const imported = await clickAction(page, site.id, page.getByRole('button', { name: 'Interpret source', exact: true }));
  candidate = imported.candidates[0];
  expect(candidate.catalog.entities.find(entity => entity.id === alphaId)!.attributes[priceId]).toBe(12);
  expect(candidate.catalog.entities.some(entity => entity.id === gammaId)).toBe(true);
  const proposal = page.getByRole('region', { name: 'Knowledge proposal' });
  const updates = proposal.getByRole('region', { name: 'Source update review' });
  await expect(updates).toContainText('Corrections kept: 1');
  await updates.locator(':scope > details > summary').click();
  const conflict = updates.getByRole('article', { name: /Alpha Workshop.*Price/ });
  const values = conflict.locator('.knowledge-source-values dd');
  await expect(values).toHaveText(['10', '12', '15']);
  await conflict.getByText('Compare source excerpts', { exact: true }).click();
  await expect(conflict.locator('.knowledge-source-excerpt')).toHaveCount(2);
  await expect(conflict.locator('.knowledge-source-excerpt').first()).toContainText('Row 2');
  await expect(conflict.locator('.knowledge-source-excerpt').first()).toContainText('10');
  await expect(conflict.locator('.knowledge-source-excerpt').last()).toContainText('15');
  const missing = updates.getByRole('article', { name: 'Gamma Workshop', exact: true });
  await expect(missing.getByRole('button', { name: 'Keep item for Gamma Workshop', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(missing).toContainText('Photos stay in your library');

  const alpha = proposal.locator('.knowledge-item').filter({ has: page.locator('summary', { hasText: 'Alpha Workshop' }) });
  await alpha.locator(':scope > summary').click();
  const sourceToggle = alpha.locator('.knowledge-field-source').filter({ has: page.locator('summary', { hasText: 'Source for Price' }) });
  await sourceToggle.locator('summary').focus(); await page.keyboard.press('Enter');
  await expect(sourceToggle).toHaveAttribute('open', ''); await expect(sourceToggle).toContainText('Row 2');
  const unlinked = alpha.locator('.knowledge-field-source').filter({ has: page.locator('summary', { hasText: 'Source for Type' }) });
  await unlinked.locator('summary').click(); await expect(unlinked).toContainText('This field is not linked to a source excerpt');
  await alpha.getByRole('textbox', { name: 'Description', exact: true }).fill('A local unsaved correction');
  await expect(conflict.getByRole('button', { name: /Use source for Alpha/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Interpret source', exact: true })).toBeDisabled();
  await expect(alpha.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('A local unsaved correction');
  await proposal.getByRole('button', { name: 'Discard field edits', exact: true }).click();
  await expect(conflict.getByRole('button', { name: /Use source for Alpha/ })).toBeEnabled();
  await alpha.locator(':scope > summary').click();
  await updates.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('source-update-review-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await conflict.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(values).toHaveText(['10', '12', '15']);
  await page.screenshot({ path: info.outputPath('source-update-review-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1100 });

  const resolved = await clickAction(page, site.id, conflict.getByRole('button', { name: /Use source for Alpha/ }));
  expect(resolved.candidates[0].catalog.entities.find((entity: { id: string }) => entity.id === alphaId).attributes[priceId]).toBe(15);
  await expect(conflict).toBeFocused();
  if (!await updates.locator(':scope > details').getAttribute('open').then(value => value !== null)) await updates.locator(':scope > details > summary').click();
  const removed = await clickAction(page, site.id, missing.getByRole('button', { name: 'Remove item for Gamma Workshop', exact: true }));
  expect(removed.candidates[0].catalog.entities.some((entity: { id: string }) => entity.id === gammaId)).toBe(false);
  await clickAction(page, site.id, proposal.getByRole('button', { name: 'Apply to draft', exact: true }));
  site = await readSite(page, site.id); expect(site.published!.knowledgeRevisionId).toBe(publishedRevision);
  const mediaResponse = await page.request.get(`/api/sites/${site.id}/media`); expect(mediaResponse.ok()).toBeTruthy();
  const draftMedia: MediaLibrary = (await mediaResponse.json()).library;
  expect(draftMedia.assets.some(asset => asset.id === photoId)).toBe(true);
  expect(draftMedia.associations.some(link => link.targetId === alphaId && link.assetId === photoId)).toBe(true);
  expect(draftMedia.associations.some(link => link.targetId === gammaId)).toBe(false);
  const oldResponse = await page.request.get(`${path}?revisionId=${publishedRevision}`); expect(oldResponse.ok()).toBeTruthy();
  const oldCatalog: KnowledgeCatalog = (await oldResponse.json()).catalog;
  expect(oldCatalog.entities.find(entity => entity.id === alphaId)!.attributes[priceId]).toBe(12);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const published = page.waitForResponse(response => new URL(response.url()).pathname === `/api/sites/${site.id}` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Publish locally', exact: true }).click(); expect((await published).ok()).toBeTruthy();
  await page.goto(`/s/${site.slug}`); const explorer = page.locator('.platform-explorer');
  const card = explorer.locator(`.platform-item[data-entity-id="${alphaId}"]`);
  await expect(card.locator('img')).toHaveAttribute('src', new RegExp(photoId));
  await card.locator('img').evaluate(async (image: HTMLImageElement) => { await image.decode(); });
  await explorer.getByRole('spinbutton', { name: /Price/ }).fill('14'); await expect(explorer.locator('.platform-item')).toHaveCount(0);
  await explorer.getByRole('spinbutton', { name: /Price/ }).fill('16'); await expect(explorer.locator('.platform-item')).toHaveCount(1);
  await explorer.getByRole('spinbutton', { name: /Price/ }).fill('25'); await expect(explorer.locator('.platform-item')).toHaveCount(2);
  for (const name of ['Alpha Workshop', 'Beta Workshop']) await explorer.getByRole('button', { name: `Select ${name} for comparison`, exact: true }).click();
  await explorer.getByRole('button', { name: 'Compare selections', exact: true }).click();
  await expect(explorer.getByRole('region', { name: 'Compare published attributes' })).toBeVisible();
  await expect(explorer.getByRole('row', { name: /Price/ })).toContainText('$15.00');
  await expect(explorer.getByRole('row', { name: /Price/ })).toContainText('$22.00');
  await expect(explorer.getByRole('table').locator('img')).toHaveAttribute('src', new RegExp(photoId));
  await page.screenshot({ path: info.outputPath('visitor-updated-comparison.png'), fullPage: true });
  expect(external).toEqual([]); expect(visitorCalls).toEqual([]); expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as typeof window & { __sourceMicrophones: number }).__sourceMicrophones)).toBe(0);
});
