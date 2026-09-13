import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';
import sharp from 'sharp';
import type { Site } from '../../lib/site-model';
import type { KnowledgeCandidate } from '../../lib/knowledge-model';

const origin = 'http://127.0.0.1:3225';

function zip(files: Record<string, string>) {
  const entries: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const nameBytes = Buffer.from(name); const data = deflateRawSync(Buffer.from(value));
    const local = Buffer.alloc(30 + nameBytes.length); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(Buffer.byteLength(value), 22); local.writeUInt16LE(nameBytes.length, 26); nameBytes.copy(local, 30); entries.push(Buffer.concat([local, data]));
    const record = Buffer.alloc(46 + nameBytes.length); record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(8, 10); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(Buffer.byteLength(value), 24); record.writeUInt16LE(nameBytes.length, 28); record.writeUInt32LE(offset, 42); nameBytes.copy(record, 46); central.push(record); offset += local.length + data.length;
    entries[entries.length - 1].writeUInt32LE(crc32(Buffer.from(value)), 14); record.writeUInt32LE(crc32(Buffer.from(value)), 16);
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...entries, directory, end]);
}

async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post(path, { headers: { Origin: origin }, data }); const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); return body;
}
async function openKnowledge(page: Page, site: Site) {
  await page.goto('/');
  const picker = page.getByRole('combobox', { name: 'Current site', exact: true });
  await expect(picker).toBeEnabled();
  if (await picker.inputValue() !== site.id) await picker.selectOption(site.id);
  await expect(page.locator('.breadcrumbs strong')).toHaveText(site.draft.name);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Knowledge', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeVisible();
}

test('DOCX/XLSX/OCR and URL import stay reviewable, accessible, and private before publication', async ({ page, context }) => {
  const external: string[] = [];
  await context.route(/^https?:\/\//, route => { const url = new URL(route.request().url()); if (url.origin !== origin) { external.push(url.origin); return route.abort('blockedbyclient'); } return route.continue(); });
  let site: Site = (await post(page, '/api/sites', { name: 'Semantic Ingestion Proof', slug: `semantic-ingestion-${Date.now()}`, kind: 'general' })).site;
  async function upload(name: string, contentType: string, bytes: Buffer) {
    const response = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': contentType, 'X-File-Name': name, 'X-Site-Revision': String(site.revision) }, data: bytes }); const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); site = body.site; return body.fileId as string;
  }
  const path = `/api/sites/${site.id}/knowledge`;
  const docx = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Name: Document Alpha</w:t></w:r></w:p><w:p><w:r><w:t>Summary: Imported from DOCX</w:t></w:r></w:p></w:body></w:document>' });
  const docxId = await upload('catalog.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx);
  let state = await post(page, path, { action: 'analyze', fileId: docxId, revision: site.revision, requestId: randomUUID() });
  let candidate = state.candidates[0] as KnowledgeCandidate;
  expect(candidate.origins?.[0].provenance?.anchors[0].format).toBe('docx');
  expect(candidate.origins?.[0].provenance?.anchors[0].lineStart).toBe(1);
  await openKnowledge(page, site);
  await page.getByText('Source material (1)', { exact: true }).click();
  await page.locator('.knowledge-source-file > summary').filter({ hasText: 'catalog.docx' }).click();
  await expect(page.locator('.knowledge-source-excerpt pre')).toContainText(['Name: Document Alpha']);
  site = (await post(page, path, { action: 'apply', candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, revision: site.revision })).site;

  const xlsx = zip({
    'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Price</t></si><si><t>Sheet Alpha</t></si></sst>',
    'xl/workbook.xml': '<workbook xmlns:r="x"><sheets><sheet name="Catalog" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>19</v></c></row></sheetData></worksheet>',
  });
  const xlsxId = await upload('catalog.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsx);
  state = await post(page, path, { action: 'analyze', fileId: xlsxId, revision: site.revision, requestId: randomUUID() }); candidate = state.candidates[0] as KnowledgeCandidate;
  const xlsxOrigin = candidate.origins?.find(origin => origin.name === 'catalog.xlsx'); if (!xlsxOrigin) throw new Error('XLSX origin was not saved.');
  expect(xlsxOrigin.provenance?.anchors.some(anchor => anchor.cellRange === 'A2')).toBeTruthy();
  expect(xlsxOrigin.provenance?.anchors.some(anchor => anchor.cellRange === 'B2')).toBeTruthy();
  await openKnowledge(page, site);
  await page.getByText('Source material (2)', { exact: true }).click();
  await page.locator('.knowledge-source-file > summary').filter({ hasText: 'catalog.xlsx' }).click();
  await expect(page.locator('.knowledge-source-file .knowledge-source-excerpt figcaption').filter({ hasText: 'Cells B2' })).toBeVisible();
  site = (await post(page, path, { action: 'apply', candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, revision: site.revision })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  const htmlId = await upload('location.html', 'text/html', Buffer.from('<p>Name: Web Location</p><p>Kind: place</p><p>Address: 12 Example Lane</p>'));
  const htmlState = await post(page, path, { action: 'analyze', fileId: htmlId, revision: site.revision, requestId: randomUUID() });
  expect(htmlState.candidates[0].origins.at(-1).provenance.anchors[0].format).toBe('html');
  await post(page, path, { action: 'discard', candidateId: htmlState.candidates[0].id, revision: site.revision });

  const imageId = await upload('empty-scan.png', 'image/png', await sharp({ create: { width: 240, height: 120, channels: 3, background: '#ffffff' } }).png().toBuffer());
  const ocrState = await post(page, path, { action: 'analyze', fileId: imageId, revision: site.revision, requestId: randomUUID() });
  expect(ocrState.candidates).toHaveLength(0); expect(ocrState.jobs.at(-1).status).toBe('failed'); expect(ocrState.jobs.at(-1).message).toMatch(/OCR/i);

  await page.goto('/');
  const picker = page.getByRole('combobox', { name: 'Current site', exact: true }); if (await picker.inputValue() !== site.id) await picker.selectOption(site.id);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Knowledge', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Source file', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Site editor', exact: true }).getByRole('status')).toContainText(ocrState.jobs.at(-1).message);
  let websiteRequest: { action?: string; url?: string } | undefined;
  await page.route(`${origin}/api/sites/${site.id}/knowledge`, async route => {
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON() as { action?: string; url?: string };
      if (payload.action === 'analyze-url' && payload.url === 'https://example.test/about') {
        websiteRequest = payload;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ catalog: null, candidates: [], sources: [], semanticMode: 'structured', jobs: [{ id: randomUUID(), sourceName: payload.url, status: 'needs_review', message: 'Fixture website HTML import ready.', stage: 'review', startedAt: Date.now(), updatedAt: Date.now() }] }) });
        return;
      }
    }
    await route.continue();
  });
  await page.getByRole('textbox', { name: /^Website URL/ }).fill('https://example.test/about');
  await page.getByRole('button', { name: 'Interpret website', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Site editor', exact: true }).getByRole('status').filter({ hasText: 'Fixture website HTML import ready.' })).toBeVisible();
  expect(websiteRequest?.action).toBe('analyze-url'); expect(websiteRequest?.url).toBe('https://example.test/about');
  await page.getByRole('textbox', { name: /^Website URL/ }).fill('http://localhost:3225/private');
  await page.getByRole('button', { name: 'Interpret website', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'public HTTPS' })).toBeVisible();

  const publicRevision = site.published!.knowledgeRevisionId!;
  const projection = await page.request.get(`${path}?revisionId=${publicRevision}`); const projectionBody = await projection.json();
  expect(projection.ok()).toBeTruthy(); expect(projectionBody.origins).toBeUndefined(); expect(projectionBody.catalog?.origins).toBeUndefined();
  await page.goto(`/s/${site.slug}`); await expect(page.locator('.published-site')).toBeVisible(); await expect(page.getByText('Source material', { exact: true })).toHaveCount(0);
  const publicPage = await (await page.request.get(`/s/${site.slug}`)).text();
  for (const privateValue of ['catalog.docx', 'catalog.xlsx', 'anchorIds', 'valueHash', 'correctionHistory', 'Web Location']) expect(publicPage).not.toContain(privateValue);
  expect(external).toEqual([]);
});

test('publisher identity decisions, aliases and singleton corrections are keyboard accessible and rejected facts stay private', async ({ page, context }) => {
  await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let site: Site = (await post(page, '/api/sites', { name: 'Assertion Review Proof', slug: `assertion-review-${Date.now()}`, kind: 'general' })).site;
  const path = `/api/sites/${site.id}/knowledge`;
  for (const name of ['first.csv', 'second.csv']) {
    const response = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': 'text/csv', 'X-File-Name': name, 'X-Site-Revision': String(site.revision) }, data: Buffer.from('Name,Kind,Price [USD]\nAlpha,business,10') });
    const upload = await response.json(); expect(response.ok(), JSON.stringify(upload)).toBeTruthy(); site = upload.site;
    // Different source bytes avoid exact-file deduplication while names alone
    // still cannot establish identity.
    if (name === 'second.csv') {
      const changed = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': 'text/csv', 'X-File-Name': 'different.csv', 'X-Site-Revision': String(site.revision) }, data: Buffer.from('Name,Kind,Price [USD]\nAlpha,business,11') });
      const body = await changed.json(); site = body.site;
      await post(page, path, { action: 'analyze', fileId: body.fileId, revision: site.revision, requestId: randomUUID() });
    } else {
      const state = await post(page, path, { action: 'analyze', fileId: upload.fileId, revision: site.revision, requestId: randomUUID() });
      site = (await post(page, path, { action: 'apply', candidateId: state.candidates[0].id, revision: site.revision })).site;
    }
  }
  await openKnowledge(page, site);
  const match = page.locator('[data-identity-match]').first();
  await match.getByRole('button', { name: 'Keep separate', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(match).toContainText('Rejected'); await expect(match).toBeFocused();
  await page.locator('.knowledge-item > summary').first().click();
  await page.getByRole('textbox', { name: /^Approved alternate labels/ }).first().fill('Alpha A, AA');
  await expect(match.getByRole('button', { name: 'Save alias', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save corrections', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply to draft', exact: true })).toBeEnabled();
  let state = await (await page.request.get(path)).json();
  expect(state.candidates[0].catalog.entities[0].aliases).toEqual(['Alpha A', 'AA']);
  await page.getByText(/^Edit individual facts and relationships/).click();
  await page.getByRole('combobox', { name: /^Add a singleton fact to/ }).selectOption(state.candidates[0].catalog.entities[0].id);
  await page.getByText('Alpha · Detail · Unknown', { exact: true }).click();
  await page.getByLabel('Domain predicate', { exact: true }).fill('email');
  await page.getByLabel('Fact label', { exact: true }).fill('Email');
  await page.getByLabel('Assertion value', { exact: true }).fill('unpublished-claim@example.test');
  await page.getByRole('button', { name: 'Save corrections', exact: true }).click();
  const assertion = page.getByRole('article', { name: 'Alpha properties.email', exact: true });
  await expect(assertion).toBeVisible();
  await assertion.getByRole('button', { name: 'Reject assertion', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(assertion).toContainText('rejected'); await expect(assertion).toBeFocused();
  await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review draft knowledge', exact: true })).toBeEnabled();
  site = (await (await page.request.get(`/api/sites/${site.id}`)).json()).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  state = await (await page.request.get(`${path}?revisionId=${site.published!.knowledgeRevisionId}`)).json();
  expect(state.catalog.facts).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/s/${site.slug}`); await expect(page.locator('.published-site')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('unpublished-claim@example.test');
  expect(await (await page.request.get(`/s/${site.slug}`)).text()).not.toContain('unpublished-claim@example.test');
});
