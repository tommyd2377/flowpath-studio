import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { templateFixtures } from '../../fixtures/template-sites';
import { CURATED_PALETTES, SITE_PALETTES, WEBSITE_TEMPLATES } from '@thevoice/platform-ui/site-design';
import type { Site } from '../../lib/site-model';
import { textPdf } from '../knowledge-fixtures';
import { websiteTaskFixture } from '../../fixtures/visitor-tasks';

import { createFixture, origin, post, read, studio } from './website-fixtures';
for (const [index, fixture] of templateFixtures.entries()) test(`${fixture.id}: all templates on desktop, mobile and embedded preview`, async ({ page, context }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [], external: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await context.route(/^https?:\/\//, route => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  let site = await createFixture(page, index); const original = { ...site.draft, style: undefined };
  for (const [id, template] of Object.entries(WEBSITE_TEMPLATES)) {
    site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, style: { ...template.defaults, entry: 'website' } } })).site;
    expect({ ...site.draft, style: undefined }).toEqual(original);
    site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`/s/${site.slug}`);
    const website = page.locator(`[data-published-website][data-template=${id}]`); await expect(website).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(website).toHaveCSS('opacity', '1');
    await expect(website.getByRole('heading', { level: 1 })).toHaveText(fixture.content.headline);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const photo of await website.locator('img').all()) { await photo.scrollIntoViewIfNeeded(); await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true); }
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`${fixture.id}-${id}-desktop.png`), fullPage: true });
    const entry = website.locator('.platform-website-content').getByRole('button', { name: /^Open / }).first(); await entry.click();
    await expect(page.getByRole('dialog', { name: /./ })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${fixture.id}-${id}-detail.png`) }); await page.keyboard.press('Escape');
    await expect(page.locator('.website-detail')).not.toBeVisible(); await expect(entry).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.evaluate(() => scrollTo(0, 0));
    await website.locator('.platform-website-mobile-nav summary').click();
    await expect(website.getByRole('navigation', { name: 'Mobile website navigation' })).toBeVisible();
    await website.getByRole('navigation', { name: 'Mobile website navigation' }).getByRole('link').first().click();
    await expect(website.getByRole('navigation', { name: 'Mobile website navigation' })).not.toBeVisible();
    await page.evaluate(() => scrollTo(0, 0)); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${fixture.id}-${id}-mobile.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 }); await studio(page, site);
    await expect(page.locator('.preview-scroll [data-template]')).toHaveAttribute('data-template', id);
    await page.getByRole('button', { name: 'Mobile preview', exact: true }).click();
    await expect(page.locator('.preview-scroll .platform-website-mobile-nav summary')).toBeVisible();
    await expect.poll(() => page.locator('.preview-scroll .platform-website-mobile-nav summary').evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(48);
    await expect.poll(() => page.locator('.preview-scroll [data-template]').evaluate(element => parseFloat(getComputedStyle(element).paddingLeft))).toBeLessThanOrEqual(22);
    expect(await page.locator('.preview-scroll').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${fixture.id}-${id}-studio.png`) });
  }
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('Branding saves independent options, reset preserves content, and drafts remain private', async ({ page }, info) => {
  let site = await createFixture(page, 1);
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  const original = { ...site.draft, style: undefined }; const publication = structuredClone(site.published);
  await studio(page, site);
  await page.getByRole('button', { name: /Showcase Confident headlines/ }).click();
  await page.getByRole('button', { name: 'Sage', exact: true }).click();
  await page.getByRole('combobox', { name: 'Text size', exact: true }).selectOption('larger');
  await page.getByRole('combobox', { name: 'Spacing', exact: true }).selectOption('compact');
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'The Voice', exact: true }).click();
  await page.getByRole('combobox', { name: 'Website / assistant preference' }).selectOption('assistant');
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Branding', exact: true }).click();
  await page.getByLabel('Use a custom accent color').check(); await page.getByLabel('Brand color', { exact: true }).fill('#ffff00');
  await page.getByRole('region', { name: 'Site editor' }).getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Site editor' }).getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  site = await read(page, site.id); expect(site.draft.style).toMatchObject({ template: 'showcase', palette: 'sage', spacing: 'compact', textSize: 'larger', entry: 'assistant', customAccent: true }); expect(site.published).toEqual(publication);
  await studio(page, site);
  await expect(page.getByRole('combobox', { name: 'Text size', exact: true })).toHaveValue('larger');
  await page.getByRole('button', { name: 'Reset styling to template defaults', exact: true }).click();
  await page.getByRole('region', { name: 'Site editor' }).getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Site editor' }).getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled(); site = await read(page, site.id);
  expect(site.draft.style).toMatchObject({ ...WEBSITE_TEMPLATES.showcase.defaults, entry: 'assistant' });
  expect({ ...site.draft, style: undefined, accent: original.accent }).toEqual(original); expect(site.published).toEqual(publication);
  await page.screenshot({ path: info.outputPath('branding-customization.png') });
});

test('eight palettes preview immediately and preserve independent settings, saved colors and publication boundaries', async ({ page, context }, info) => {
  test.setTimeout(120_000);
  const external: string[] = [];
  await context.route(/^https?:\/\//, route => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let site = await createFixture(page, 1);
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, style: { ...site.draft.style, paletteVersion: undefined, typography: 'modern', textSize: 'larger', spacing: 'compact', entry: 'assistant' } } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  const content = { ...site.draft, style: undefined };
  await studio(page, site);
  const colors = page.getByRole('group', { name: 'Colors', exact: true });
  for (const palette of CURATED_PALETTES) await expect(colors.getByRole('button', { name: SITE_PALETTES[palette].label, exact: true })).toBeVisible();
  await expect(colors).toContainText('Your saved colors are retained');
  const preview = page.locator('.preview-scroll [data-site-template]');
  expect(await preview.evaluate(element => getComputedStyle(element).getPropertyValue('--platform-bg'))).toBe('#f6f2ea');
  for (const palette of ['cobalt', 'coral', 'orchid', 'sunshine'] as const) {
    const publication = structuredClone(site.published);
    await colors.getByRole('button', { name: SITE_PALETTES[palette].label, exact: true }).click();
    await expect.poll(() => preview.evaluate(element => getComputedStyle(element).getPropertyValue('--platform-bg'))).toBe(SITE_PALETTES[palette].background);
    if (palette === 'cobalt') { await colors.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('palettes-branding-desktop.png') }); }
    const save = page.getByRole('region', { name: 'Site editor' }).getByRole('button', { name: 'Save draft', exact: true });
    await save.click(); await expect(save).toBeDisabled(); site = await read(page, site.id);
    expect(site.draft.style).toMatchObject({ palette, paletteVersion: 2, typography: 'modern', textSize: 'larger', spacing: 'compact', entry: 'assistant', customized: ['palette'] });
    expect({ ...site.draft, style: undefined }).toEqual(content); expect(site.published).toEqual(publication);
    await studio(page, site); await expect(colors.getByRole('button', { name: SITE_PALETTES[palette].label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('combobox', { name: 'Text size', exact: true })).toHaveValue('larger');
    site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
    await page.goto(`/s/${site.slug}`); await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('[data-published-website]')).toBeVisible();
    expect(await page.locator('[data-site-template]').evaluate(element => getComputedStyle(element).getPropertyValue('--platform-bg'))).toBe(SITE_PALETTES[palette].background);
    await page.screenshot({ path: info.outputPath(`${palette}-desktop.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${palette}-mobile.png`) });
    await page.setViewportSize({ width: 1440, height: 1100 }); await studio(page, site);
  }
  await page.setViewportSize({ width: 390, height: 844 }); await colors.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await colors.screenshot({ path: info.outputPath('palettes-branding-mobile.png') });
  expect(external).toEqual([]);
});

test('related sources show partial results, require review, and withdraw contributions without deleting uploads', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let site: Site = (await post(page, '/api/sites', { name: 'Related source proof', slug: `source-batch-${Date.now()}`, kind: 'general' })).site;
  const files: string[] = [];
  for (const [name, bytes, mime] of [
    ['menu.pdf', textPdf([['Name: Shared lunch', 'Kind: offering', 'Summary: Seasonal dishes for a gathering.', 'Price: from 18 per person; minimum 6 people']]), 'application/pdf'],
    ['practical.pdf', textPdf([['Name: Dietary requests', 'Kind: policy', 'Summary: Discuss requirements before confirming.']]), 'application/pdf'],
    ['incomplete.csv', Buffer.from('ID,Name\n'), 'text/csv'],
  ] as const) {
    const response = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': mime, 'X-File-Name': name, 'X-Site-Revision': String(site.revision) }, data: Buffer.from(bytes) });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); site = body.site; files.push(body.fileId);
  }
  await studio(page, site, 'Knowledge');
  await page.getByRole('combobox', { name: 'Source file', exact: true }).selectOption(files[0]);
  await page.getByText('Include related files in this review', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'practical.pdf', exact: true }).check();
  await page.getByRole('checkbox', { name: 'incomplete.csv', exact: true }).check();
  await page.getByRole('button', { name: 'Interpret related sources', exact: true }).click();
  const proposal = page.getByRole('region', { name: 'Knowledge proposal', exact: true });
  await expect(proposal).toBeVisible();
  await expect(page.getByRole('list', { name: 'File processing results' })).toContainText('incomplete.csv');
  await expect(page.getByRole('list', { name: 'File processing results' })).toContainText('failed');
  await expect(proposal.getByRole('region', { name: 'Impact on your draft' })).toContainText('Shared lunch');
  await expect(proposal.getByRole('button', { name: 'Apply to draft', exact: true })).toBeDisabled();
  await proposal.getByRole('checkbox', { name: /I reviewed the incomplete file report/ }).check();
  await proposal.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('source-batch-partial-review.png') });
  await proposal.getByRole('button', { name: 'Apply to draft', exact: true }).click(); await expect(proposal).toBeHidden();
  site = await read(page, site.id); expect(site.published).toBeNull();
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  const published = site.published!.knowledgeRevisionId;
  await studio(page, site, 'Knowledge');
  await page.getByText('Manage contributing sources (2)', { exact: true }).click();
  await page.getByRole('button', { name: 'Review removal of menu.pdf', exact: true }).click();
  await expect(proposal.getByRole('region', { name: 'Impact on your draft' })).toContainText('Shared lunch');
  await expect(proposal.getByRole('checkbox', { name: /I reviewed the incomplete/ })).toHaveCount(0);
  await proposal.getByRole('button', { name: 'Apply to draft', exact: true }).click(); await expect(proposal).toBeHidden();
  site = await read(page, site.id); expect(site.files.map(file => file.id)).toEqual(files); expect(site.published!.knowledgeRevisionId).toBe(published);
  const draft = await (await page.request.get(`/api/sites/${site.id}/knowledge?revisionId=${site.draft.knowledgeRevisionId}`)).json();
  expect(draft.catalog.entities.map((entity: { name: string }) => entity.name)).toEqual(['Dietary requests']);
  const replay = await post(page, `/api/sites/${site.id}/knowledge`, { action: 'analyze', revision: site.revision, fileId: files[0], requestId: randomUUID() });
  expect(replay.jobs.at(-1).status).toBe('discarded'); expect(replay.candidates).toHaveLength(0);
});

test('sparse content, larger type and a hundred long labels remain usable in every template', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let site: Site = (await post(page, '/api/sites', { name: 'A thoughtful independent practice', slug: `template-stress-${Date.now()}`, kind: 'general' })).site;
  for (const [id, template] of Object.entries(WEBSITE_TEMPLATES)) {
    site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, headline: 'A space for useful ideas.', description: '', sections: [], contact: '', hours: '', visitor: { ...site.draft.visitor, enabled: false }, style: { ...template.defaults, textSize: 'larger' } } })).site;
    site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
    await page.setViewportSize({ width: 320, height: 740 }); await page.goto(`/s/${site.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('A space for useful ideas.');
    await expect(page.locator('.platform-website-section')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`sparse-${id}.png`), fullPage: true });
  }
  const rows = 'ID,Name,Summary\n' + Array.from({ length: 100 }, (_, i) => `record-${i},Thoughtful approaches to a complex and changing world — edition ${i},A substantial supporting description for this distinct offering.`).join('\n');
  const response = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': 'text/csv', 'X-File-Name': 'hundred.csv', 'X-Site-Revision': String(site.revision) }, data: Buffer.from(rows) });
  const upload = await response.json(); expect(response.ok(), JSON.stringify(upload)).toBe(true); site = upload.site;
  const candidate = (await post(page, `/api/sites/${site.id}/knowledge`, { action: 'analyze', revision: site.revision, fileId: upload.fileId, requestId: randomUUID() })).candidates.at(-1);
  site = (await post(page, `/api/sites/${site.id}/knowledge`, { action: 'apply', revision: site.revision, candidateId: candidate.id, candidateRevisionId: candidate.catalog.id })).site;
  for (const [id, template] of Object.entries(WEBSITE_TEMPLATES)) {
    site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, style: { ...template.defaults, textSize: 'larger', spacing: 'compact' } } })).site;
    site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
    await page.goto(`/s/${site.slug}`);
    const website = page.locator('[data-published-website]');
    await expect(website.locator('.platform-content-card')).toHaveCount(6);
    await website.getByRole('button', { name: 'Explore all 100', exact: true }).click();
    await expect(website.locator('.platform-content-card')).toHaveCount(100);
    const last = website.locator('.platform-content-card').last(); await last.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toContainText('edition 99'); await page.keyboard.press('Escape'); await expect(last).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await website.getByRole('button', { name: 'Show fewer', exact: true }).click();
    await website.getByRole('button', { name: `${site.draft.name} home`, exact: true }).click();
    await website.locator('.platform-content-card').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`long-collection-${id}.png`) });
  }
});

test('assistant information shares template tokens and stable published references, closes and reopens without changing the website', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let site = await createFixture(page, 0);
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, visitor: { ...site.draft.visitor, enabled: true, mode: 'chat' }, style: { ...WEBSITE_TEMPLATES.editorial.defaults, entry: 'website' } } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`);
  const website = page.locator('[data-published-website]'), carousel = page.locator('[data-ai-carousel]');
  const before = await website.innerText();
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  if (!await input.isVisible()) await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await input.fill('Show me your photos'); await input.press('Enter');
  await expect(carousel).toContainText('2 matching items'); await expect(carousel).toHaveAttribute('aria-busy', 'false');
  await expect(carousel.locator('[data-surface-region] img').first()).toBeVisible();
  expect(await carousel.evaluate(element => getComputedStyle(element).getPropertyValue('--platform-heading-font'))).toContain('Newsreader');
  const websiteBackground = await page.locator('[data-site-template]').evaluate(element => getComputedStyle(element).backgroundColor);
  await expect(page.locator('.platform-conversation-dock')).toHaveCSS('background-color', websiteBackground);
  await carousel.getByRole('button', { name: /Read details/ }).last().click();
  await expect(carousel.getByRole('region', { name: 'Record detail' })).toBeVisible();
  await expect(carousel).toHaveAttribute('aria-busy', 'false');
  const active = await carousel.getAttribute('data-active-card');
  await page.screenshot({ path: info.outputPath('editorial-assistant.png') });
  await page.keyboard.press('Escape'); await expect(carousel).toBeHidden(); expect(await website.innerText()).toBe(before);
  await input.click(); await expect(carousel).toHaveAttribute('data-active-card', active!);
  await page.keyboard.press('Escape'); await expect(carousel).toBeHidden();
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, visitor: { ...site.draft.visitor, mode: 'both' } } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`); await expect(page.getByRole('button', { name: 'Preview voice', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('editorial-voice-controls.png') });
});

test('paged website details preserve conditions and reject stale publication references', async ({ page }) => {
  let site: Site = (await post(page, '/api/sites', { name: 'Paged website', slug: `template-paged-${Date.now()}`, kind: 'general' })).site;
  const { records, memberships, relationships, publication, ...metadata } = websiteTaskFixture('services', 49);
  expect(publication).toBeTruthy(); records[1].assertions.find(fact => fact.fieldId === 'price')!.conditions = ['Minimum two sessions; from this amount; seven days notice'];
  let review = (await post(page, `/api/sites/${site.id}/collections`, { action: 'begin', siteRevision: site.revision, metadata })).review;
  review = (await post(page, `/api/sites/${site.id}/collections`, { action: 'append', reviewId: review.id, revision: review.revision, chunk: { records, memberships, relationships } })).review;
  review = (await post(page, `/api/sites/${site.id}/collections`, { action: 'finish', reviewId: review.id, revision: review.revision })).review;
  site = (await post(page, `/api/sites/${site.id}/collections`, { action: 'apply', reviewId: review.id, revision: review.revision, siteRevision: site.revision })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, visitor: { ...site.draft.visitor, enabled: false }, style: WEBSITE_TEMPLATES.showcase.defaults } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  const path = `/api/visitor/${site.slug}/catalog`;
  const detail = await (await page.request.get(`${path}?record=${records[1].id}&publicationId=${site.published!.catalogPublicationId}`)).json();
  expect(detail.publicationId).toBe(site.published!.catalogPublicationId); expect(JSON.stringify(detail.entry)).toContain('seven days notice');
  const stale = await page.request.get(`${path}?record=${records[1].id}&publicationId=previous-publication`); expect(stale.status()).toBe(409);
  await page.goto(`/s/${site.slug}`); const website = page.locator('[data-published-website]');
  await expect(website.locator('[data-task-record]')).toHaveCount(24);
  await website.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(website.getByRole('navigation', { name: 'Collection pages' })).toContainText('2 / 3');
  await website.getByRole('button', { name: `Open ${records[1].name}`, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('seven days notice'); await page.keyboard.press('Escape');
  await website.getByRole('button', { name: 'Next page', exact: true }).click(); await expect(website.locator('[data-task-record]')).toHaveCount(1);
});
