import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { WebsiteMigration } from '../../lib/website-migration-model';
import type { Site } from '../../lib/site-model';
import type { KnowledgeCandidate } from '../../lib/knowledge-model';

const origin = 'http://127.0.0.1:3225';
async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post(path, { headers: { Origin: origin }, data });
  const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); return body;
}
async function studio(page: Page, site: Site) {
  await page.goto('/');
  const picker = page.getByRole('combobox', { name: 'Current site', exact: true });
  await expect(picker).toBeEnabled(); await picker.selectOption(site.id);
  await expect(page.locator('.breadcrumbs strong')).toHaveText(site.draft.name);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Knowledge', exact: true }).click();
}
test('HTML import offers editable native design, mobile preview, publication and complete reading content', async ({ page, context }, info) => {
  const external: string[] = [], errors: string[] = [], providerRequests: string[] = [];
  await context.route(/^https?:\/\//, route => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && /^\/api\/visitor\/[^/]+(?:\/(?:session|explore))?$/.test(new URL(request.url()).pathname)) providerRequests.push(request.url()); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let site: Site = (await post(page, '/api/sites', { name: 'Website import proof', slug: `website-import-${Date.now()}`, kind: 'general' })).site;
  const html = `<html><head><title>Harbor Design</title><meta name="description" content="Thoughtful rooms for everyday living."></head><body><h1>Spaces with room to live.</h1><p>${'Thoughtful materials and careful work. '.repeat(65)}Final reading detail beyond the short summary.</p></body></html>`;
  const upload = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': 'text/html', 'X-File-Name': 'harbor.html', 'X-Site-Revision': String(site.revision) }, data: Buffer.from(html) });
  expect(upload.ok()).toBeTruthy(); const uploaded = await upload.json(); site = uploaded.site;
  const path = `/api/sites/${site.id}/knowledge`;
  let candidate: KnowledgeCandidate = (await post(page, path, { action: 'analyze', fileId: uploaded.fileId, revision: site.revision, requestId: randomUUID() })).candidates[0];
  expect(candidate.website).toBeTruthy();
  const decisions = candidate.assertionReviews!.filter(review => review.status === 'pending').map(review => ({ targetType: review.targetType, targetId: review.targetId, decision: 'approve' }));
  if (decisions.length) candidate = (await post(page, path, { action: 'assertions', candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, revision: site.revision, decisions })).candidates[0];
  await studio(page, site);
  const design = page.getByRole('region', { name: 'Website design proposal' });
  await expect(design.getByRole('heading', { name: 'Your FlowPath website' })).toBeVisible();
  await design.getByLabel('Website headline', { exact: true }).fill('Designed around your everyday.');
  const saved = page.waitForResponse(response => response.url().endsWith('/knowledge') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save corrections', exact: true }).click(); expect((await saved).ok()).toBeTruthy();
  await design.getByText('Preview proposed website', { exact: true }).click();
  await expect(design.locator('[data-published-website] h1')).toHaveText('Designed around your everyday.');
  await design.getByRole('button', { name: 'Show mobile preview' }).click();
  await expect(design.locator('.website-design-preview')).toHaveAttribute('data-mobile', 'true');
  await page.screenshot({ path: info.outputPath('website-design-mobile.png'), fullPage: true });
  const appliedResponse = page.waitForResponse(response => response.url().endsWith('/knowledge') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Apply to draft', exact: true }).click(); const applied = await appliedResponse; expect(applied.ok(), await applied.text()).toBeTruthy(); site = (await applied.json()).site;
  expect(site.published).toBeNull(); expect(site.draft.style?.entry).toBe('website');
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`);
  const website = page.locator('[data-published-website]');
  await expect(website).toBeVisible(); await expect(website.locator('h1')).toHaveText('Designed around your everyday.');
  // The persistent voice/chat dock is part of the current website layout;
  // it does not activate a conversation or make browsing depend on AI.
  await expect(page.locator('[data-voice-dock]')).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.reload(); await expect(website).toBeVisible();
  await page.route(`**/api/visitor/${site.slug}`, route=>route.fulfill({status:503,json:{error:'Assistant unavailable in this synthetic check.'}}));
  await page.setViewportSize({width:390,height:844});await page.reload();
  await expect(website.locator('h1')).toHaveText('Designed around your everyday.');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:info.outputPath('native-mobile-assistant-unavailable.png'),fullPage:true});
  // Native reading remains available even when the assistant availability
  // request fails, including content beyond the card's short summary.
  await website.getByRole('button', { name: 'Open Spaces with room to live.', exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'Spaces with room to live.', exact: true });
  await expect(detail.getByText(/Final reading detail beyond the short summary\./).last()).toBeVisible();
  await page.screenshot({ path: info.outputPath('website-published-reading.png'), fullPage: true });
  await detail.getByRole('button', { name: 'Close detail', exact: true }).click();
  await expect(detail).not.toBeVisible(); await expect(website).toBeVisible();
  expect(external).toEqual([]); expect(errors).toEqual([]); expect(providerRequests).toEqual([]);
});

test('migration review persists selections, reports failures and resumes without AI', async ({ page }) => {
  let site: Site = (await post(page, '/api/sites', { name: 'Migration proof', slug: `migration-${Date.now()}`, kind: 'general' })).site;
  const source = 'https://bakery.example/';
  let migration: WebsiteMigration | null = null;
  let downloads = 0;
  await page.route(`**/api/sites/${site.id}/website/migration`, async route => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      if (input.action === 'discover') migration = {id:randomUUID(),url:source,pages:[{url:source,title:'Home',status:'ready',message:'HTML available',characters:150},{url:source+'private',title:'Private',status:'failed',message:'Excluded by robots.txt',characters:0}],selectedPages:[source],images:[{url:source+'cake.png',pageUrl:source,alt:'Cake',caption:'Cake',placement:'source',role:'depicts',status:'excluded'}],notes:[],updatedAt:new Date().toISOString()};
      if (input.action === 'select') { if(input.selectedPages)migration!.selectedPages=input.selectedPages;if(input.images)migration!.images=input.images; }
      if (input.action === 'import-image') {downloads++;migration!.images[0].status='failed';migration!.images[0].error='Source image unavailable. Retry or exclude.';}
      site={...site,revision:site.revision+1};
    }
    return route.fulfill({json:{site,migration}});
  });
  await studio(page,site);
  const importer=page.getByRole('region',{name:'Import a website'});
  await importer.getByLabel('Domain or website URL').fill(source);
  await importer.getByRole('button',{name:'Find website pages'}).click();
  await expect(importer.getByRole('checkbox',{name:/Private/})).toBeDisabled();
  await importer.getByRole('button',{name:'Clear page selection'}).click();
  await expect(importer.getByRole('button',{name:'Import selected page knowledge'})).toBeDisabled();
  await importer.getByRole('button',{name:'Select all available pages'}).click();
  await importer.getByRole('button',{name:'Select next 20 images'}).click();
  await importer.getByRole('button',{name:'Import next 1 selected images'}).click();
  await expect(importer.getByRole('alert')).toContainText('Source image unavailable');
  await page.reload();
  await studio(page,site);
  await expect(importer.getByRole('checkbox',{name:/Cake/})).toBeChecked();
  await expect(importer.getByText(/failed: Source image unavailable/)).toBeVisible();
  expect(downloads).toBe(1);
});

test('Knowledge opens the latest proposal after returning or reloading and still allows an older review', async ({ page }) => {
  const site: Site = (await post(page, '/api/sites', { name: 'Proposal selection proof', slug: `proposals-${Date.now()}`, kind: 'general' })).site;
  const candidates = ['Older interpretation', 'Newest interpretation'].map(name => ({
    id: randomUUID(), baseRevision: site.revision, sourceName: 'Website migration repair', notes: [],
    catalog: { schemaVersion: 1, id: randomUUID(), name, description: '', attributes: [],
      entities: [{ id: 'story', kind: 'article', name, summary: 'Reviewable content.', attributes: {} }], collections: [], relationships: [], jobs: [] },
  }));
  await page.route(`**/api/sites/${site.id}/knowledge`, route => route.fulfill({ json: { catalog: null, candidates, jobs: [], sources: [], semanticMode: 'structured' } }));
  await studio(page, site);
  const picker = page.getByRole('combobox', { name: 'Proposal to review', exact: true });
  await expect(picker).toHaveValue(candidates[1].id);
  await expect(picker.locator('option').first()).toContainText('Latest');
  await picker.selectOption(candidates[0].id);
  await expect(picker).toHaveValue(candidates[0].id);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Editor', exact: true }).click();
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Knowledge', exact: true }).click();
  await expect(picker).toHaveValue(candidates[1].id);
  await page.reload();
  await studio(page, site);
  await expect(picker).toHaveValue(candidates[1].id);
});
