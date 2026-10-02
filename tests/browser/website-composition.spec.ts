import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { WebsiteCompositionPlan } from '@thevoice/platform-ui/website-composition';
import type { KnowledgeCandidate } from '../../lib/knowledge-model';
import type { Site } from '../../lib/site-model';
import { textPdf } from '../knowledge-fixtures';
import { createFixture, origin, post, read, studio } from './website-fixtures';

// These are generated synthetic sources passed through the actual upload and
// extraction APIs. No revised catalog fixture or model response supplies records.
const htmlTail = 'Final synthetic qualification: access requires advance approval.';
const htmlBody = `${'This synthetic guide describes a fictional shared workshop and its visitor arrangements. '.repeat(145)}${htmlTail}`;
const sources = [
  { kind: 'csv', name: 'synthetic-workshops.csv', mime: 'text/csv', entity: 'Synthetic Clay Workshop', detail: 'Materials included; advance registration required.',
    bytes: () => Buffer.from('ID,Name,Kind,Summary,Price [USD]\nclay,Synthetic Clay Workshop,session,Materials included; advance registration required.,40\nprint,Synthetic Print Workshop,session,Bring an apron; ages sixteen and above.,55\napproach,Synthetic Workshop Approach,article,A fictional practice guide; ask questions and take your time.,\n') },
  { kind: 'html', name: 'synthetic-access-guide.html', mime: 'text/html', entity: 'Synthetic Access Guide', detail: htmlTail,
    bytes: () => Buffer.from(`<html><head><title>Synthetic Access Guide</title><meta name="description" content="A fictional workshop guide for browser verification."></head><body><main><p>${htmlBody}</p></main></body></html>`) },
  { kind: 'pdf', name: 'synthetic-workshop.pdf', mime: 'application/pdf', entity: 'Synthetic Paper Workshop', detail: 'Fictional workshop; bring an apron and register in advance.',
    bytes: () => Buffer.from(textPdf([['ID: paper-workshop', 'Name: Synthetic Paper Workshop', 'Kind: session', 'Summary: Fictional workshop; bring an apron and register in advance.', 'Price [USD]: 24', 'Duration: 60']])) },
] as const;

async function isolate(page: Page, context: BrowserContext) {
  const external: string[] = [], errors: string[] = [], visitorAttempts: string[] = [];
  await context.route(/^https?:\/\//, route => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && /^\/api\/visitor\//.test(new URL(request.url()).pathname)) visitorAttempts.push(request.url());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return () => { expect(external).toEqual([]); expect(errors).toEqual([]); expect(visitorAttempts).toEqual([]); };
}

async function importSource(page: Page, source: typeof sources[number]) {
  let site: Site = (await post(page, '/api/sites', { name: `Synthetic ${source.kind.toUpperCase()} layout proof`, slug: `composition-${source.kind}-${randomUUID().slice(0, 10)}`, kind: 'general' })).site;
  const uploaded = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': source.mime, 'X-File-Name': source.name, 'X-Site-Revision': String(site.revision) }, data: source.bytes() });
  const upload = await uploaded.json(); expect(uploaded.ok(), JSON.stringify(upload)).toBe(true); site = upload.site;
  const path = `/api/sites/${site.id}/knowledge`;
  const state = await post(page, path, { action: 'analyze', revision: site.revision, fileId: upload.fileId, requestId: randomUUID() });
  expect(state.candidates, JSON.stringify(state.jobs)).toHaveLength(1);
  let candidate: KnowledgeCandidate = state.candidates[0];
  expect(candidate.catalog.entities.some(entity => entity.name === source.entity)).toBe(true);
  expect(candidate.origins?.flatMap(origin => origin.provenance?.anchors ?? []).some(anchor => anchor.format === source.kind)).toBe(true);
  if (source.kind === 'html') {
    expect(htmlBody.length).toBeGreaterThan(8000);
    expect(candidate.catalog.entities.find(entity => entity.name === source.entity)?.blocks?.map(block => block.text).join('')).toBe(htmlBody);
  }
  const decisions = candidate.assertionReviews?.filter(review => review.status === 'pending').map(review => ({ targetType: review.targetType, targetId: review.targetId, decision: 'approve' })) ?? [];
  if (decisions.length) candidate = (await post(page, path, { action: 'assertions', revision: site.revision, candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, decisions })).candidates[0];
  site = (await post(page, path, { action: 'apply', revision: site.revision, candidateId: candidate.id, candidateRevisionId: candidate.catalog.id })).site;
  // Publisher settings select a quiet native website; extracted records and
  // qualifications remain exactly those produced by the importer.
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft,
    headline: `Explore our synthetic ${source.kind.toUpperCase()} source`, description: 'A fictional publisher used to verify source import and website layout review.',
    sections: [], contact: 'hello@synthetic.example', hours: '', visitor: { ...site.draft.visitor, enabled: false },
    opening: { ...site.draft.opening, copyMode: 'personalized' },
    style: { ...site.draft.style, layout: 'balanced', palette: 'parchment', entry: 'website', websiteMotion: 'off' },
  } })).site;
  const catalog: KnowledgeCatalog = (await (await page.request.get(`${path}?revisionId=${site.draft.knowledgeRevisionId}`)).json()).catalog;
  expect(catalog.entities.some(entity => entity.name === source.entity)).toBe(true);
  return { site, catalog };
}

async function localProposal(page: Page, site: Site): Promise<WebsiteCompositionPlan> {
  const result = await post(page, `/api/sites/${site.id}/website-composition`, { revision: site.revision, mode: 'local' });
  expect(result.mode).toBe('local');
  return result.plan;
}

async function saveDraft(page: Page, site: Site) {
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/sites/${site.id}` && response.request().method() === 'POST');
  await page.getByRole('region', { name: 'Site editor', exact: true }).getByRole('button', { name: 'Save draft', exact: true }).click();
  const response = await saved; const result = await response.json(); expect(response.ok(), JSON.stringify(result)).toBe(true);
  await expect(page.getByRole('region', { name: 'Site editor', exact: true }).getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  return result.site as Site;
}

async function publish(page: Page, site: Site) {
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const published = page.waitForResponse(response => new URL(response.url()).pathname === `/api/sites/${site.id}` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Publish locally', exact: true }).click();
  const response = await published; const result = await response.json(); expect(response.ok(), JSON.stringify(result)).toBe(true);
  return result.site as Site;
}

for (const source of sources) test(`${source.kind}: real synthetic source import reaches reviewed composition and a complete desktop/mobile publication`, async ({ page, context }, info) => {
  const assertIsolated = await isolate(page, context);
  const imported = await importSource(page, source); let site = imported.site;
  const before = await read(page, site.id);
  const plan = await localProposal(page, site);
  expect(await localProposal(page, site)).toEqual(plan);
  expect(await read(page, site.id)).toEqual(before);
  expect(plan.reviewNotes.length).toBeGreaterThan(0);
  if (source.kind === 'csv') expect(plan.sectionOrder.length).toBeGreaterThan(1);

  await studio(page, site);
  const suggest = page.getByRole('button', { name: 'Suggest layout', exact: true });
  await expect(suggest).toBeEnabled(); await suggest.click();
  const proposal = page.getByRole('region', { name: 'Website layout proposal', exact: true });
  await expect(proposal).toBeVisible(); await expect(proposal.locator('ol > li')).toHaveCount(plan.sectionOrder.length);
  await page.screenshot({ path: info.outputPath(`synthetic-${source.kind}-layout-review.png`), fullPage: true });
  if (source.kind === 'csv') {
    await proposal.getByRole('button', { name: 'Discard layout proposal', exact: true }).click();
    await expect(proposal).toHaveCount(0); await expect(suggest).toBeFocused();
    expect(await read(page, site.id)).toEqual(before);
    await suggest.click(); await expect(proposal).toBeVisible();
  }
  await proposal.getByRole('button', { name: 'Apply layout to draft', exact: true }).click();
  const save = page.getByRole('region', { name: 'Site editor', exact: true }).getByRole('button', { name: 'Save draft', exact: true });
  await expect(save).toBeEnabled(); await expect(save).toBeFocused();
  expect(await read(page, site.id)).toEqual(before);
  site = await saveDraft(page, site);
  expect(site.draft.websiteComposition).toEqual(plan);
  expect(site.published).toBeNull();
  expect(site.draft.knowledgeRevisionId).toBe(imported.site.draft.knowledgeRevisionId);
  site = await publish(page, site);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
  expect(site.published?.websiteComposition?.reviewNotes).toEqual([]);
  expect(site.draft.websiteComposition?.reviewNotes).toEqual(plan.reviewNotes);
  const publishedCatalog = (await (await page.request.get(`/api/sites/${site.id}/knowledge?revisionId=${site.published!.knowledgeRevisionId}`)).json()).catalog;
  expect(publishedCatalog).toEqual(imported.catalog);
  const publicHtml = await (await page.request.get(`/s/${site.slug}`)).text();
  for (const note of plan.reviewNotes) expect(publicHtml).not.toContain(note);
  expect(publicHtml).not.toContain(source.name);

  const measurements: Array<Record<string, string | number | boolean>> = [];
  for (const viewport of [{ label: 'desktop', width: 1440, height: 1000 }, { label: 'mobile', width: 390, height: 844 }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height }); await page.goto(`/s/${site.slug}`);
    const website = page.locator('[data-published-website]'); await expect(website).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(website.locator('h1')).toHaveText(site.published!.headline);
    const sectionIds = await website.locator('.platform-website-section').evaluateAll(sections => sections.map(section => section.id));
    expect(sectionIds).toHaveLength(plan.sectionOrder.length);
    expect(sectionIds.every((id, index) => id.endsWith(`-${plan.sectionOrder[index]}`))).toBe(true);
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: info.outputPath(`synthetic-${source.kind}-${viewport.label}.png`), fullPage: true });
    const entry = website.getByRole('button', { name: `Open ${source.entity}`, exact: true }); await entry.click();
    const detail = page.getByRole('dialog', { name: source.entity, exact: true });
    await expect(detail).toContainText(source.detail);
    await detail.getByText(source.detail, { exact: false }).last().scrollIntoViewIfNeeded();
    if (source.kind === 'html') await detail.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const detailSize = await detail.evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, textCharacters: element.textContent?.length ?? 0 }));
    expect(detailSize.scrollWidth).toBeLessThanOrEqual(detailSize.clientWidth + 1);
    measurements.push({ viewport: viewport.label, width: viewport.width, height: viewport.height, pageWidth, detailWidth: detailSize.clientWidth,
      detailScrollWidth: detailSize.scrollWidth, detailTextCharacters: detailSize.textCharacters, qualificationPresent: (await detail.textContent())!.includes(source.detail) });
    await page.screenshot({ path: info.outputPath(`synthetic-${source.kind}-${viewport.label}-qualification.png`) });
    await detail.getByRole('button', { name: 'Close detail', exact: true }).click();
    await expect(detail).not.toBeVisible(); await expect(entry).toBeFocused();
  }
  await writeFile(info.outputPath(`synthetic-${source.kind}-measurements.json`), JSON.stringify({ source: source.name, sourceBytes: source.bytes().length,
    entityCount: imported.catalog.entities.length, preservedKnowledgeRevision: site.published!.knowledgeRevisionId === imported.site.draft.knowledgeRevisionId,
    localProposalReadOnly: true, privateReviewNotesStripped: true, sectionCount: plan.sectionOrder.length, measurements }, null, 2));
  assertIsolated();
});

test('stale proposal requests and changed invalid plans are rejected; an unchanged stale plan keeps the useful default website', async ({ page, context }, info) => {
  const assertIsolated = await isolate(page, context);
  let { site } = await importSource(page, sources[0]);
  const plan = await localProposal(page, site), saved = await read(page, site.id);
  const stale = await page.request.post(`/api/sites/${site.id}/website-composition`, { headers: { Origin: origin }, data: { revision: site.revision - 1, mode: 'local' } });
  expect(stale.status()).toBe(409);
  const invalid = await page.request.post(`/api/sites/${site.id}`, { headers: { Origin: origin }, data: { action: 'save', revision: site.revision,
    content: { ...site.draft, websiteComposition: { ...plan, sectionOrder: ['missing-approved-section', ...plan.sectionOrder.slice(1)] } } } });
  expect(invalid.status()).toBe(400); expect(await read(page, site.id)).toEqual(saved);
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, websiteComposition: plan } })).site;
  const changedHeadline = 'Synthetic publisher correction after layout review';
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, headline: changedHeadline } })).site;
  expect(site.draft.websiteComposition).toEqual(plan);
  await studio(page, site);
  await expect(page.getByText('Your content or styling has changed since the last layout suggestion. The website uses its default arrangement until you review a fresh suggestion.', { exact: true })).toBeVisible();
  await expect(page.locator('.preview-scroll [data-published-website] h1')).toHaveText(changedHeadline);
  await page.screenshot({ path: info.outputPath('stale-layout-default-preview.png') });
  site = await publish(page, site);
  expect(site.published?.websiteComposition).toBeUndefined();
  await page.goto(`/s/${site.slug}`);
  await expect(page.locator('[data-published-website] h1')).toHaveText(changedHeadline);
  await expect(page.locator('[data-published-website]').getByRole('button', { name: `Open ${sources[0].entity}`, exact: true })).toBeVisible();
  assertIsolated();
});

test('cancelled and delayed layout responses cannot replace newer styling or survive leaving Branding', async ({ page, context }, info) => {
  const assertIsolated = await isolate(page, context);
  let { site } = await importSource(page, sources[0]);
  await studio(page, site);
  const endpoint = `**/api/sites/${site.id}/website-composition`;
  const suggest = page.getByRole('button', { name: 'Suggest layout', exact: true });
  const proposal = page.getByRole('region', { name: 'Website layout proposal', exact: true });
  async function delaySuggestion() {
    let release!: () => void, entered!: () => void, finished!: () => void;
    let failed!: (error: unknown) => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>((resolve, reject) => { entered = resolve; failed = reject; });
    const completed = new Promise<void>(resolve => { finished = resolve; });
    const handler = async (route: Route) => {
      try {
        const response = await route.fetch(), result = await response.json();
        expect(response.ok(), JSON.stringify(result)).toBe(true); expect(result.mode).toBe('local');
        expect(result.plan.snapshot.knowledgeRevisionId).toBe(site.draft.knowledgeRevisionId);
        entered(); await gate;
        try { await route.fulfill({ response }); } catch { /* The browser may already have aborted this stale request. */ }
      } catch (error) { failed(error); await route.abort().catch(() => undefined); }
      finally { finished(); }
    };
    await page.route(endpoint, handler);
    await expect(suggest).toBeEnabled(); await suggest.click(); await started;
    await expect(page.getByRole('button', { name: 'Cancel layout suggestion', exact: true })).toBeVisible();
    return async () => { release(); await completed; await page.unroute(endpoint, handler); };
  }

  let release = await delaySuggestion();
  await page.getByRole('button', { name: 'Cancel layout suggestion', exact: true }).click();
  await release(); await expect(proposal).toHaveCount(0); await expect(suggest).toBeFocused();
  expect((await read(page, site.id)).draft.websiteComposition).toBeUndefined();

  release = await delaySuggestion();
  await page.getByRole('combobox', { name: 'Text size', exact: true }).selectOption('larger');
  await release(); await expect(proposal).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Text size', exact: true })).toHaveValue('larger');
  await expect(suggest).toBeDisabled();
  site = await saveDraft(page, site);
  expect(site.draft.style?.textSize).toBe('larger'); expect(site.draft.websiteComposition).toBeUndefined();
  const savedStyling = await read(page, site.id);

  release = await delaySuggestion();
  const navigation = page.getByRole('navigation', { name: 'Workspace', exact: true });
  await navigation.getByRole('button', { name: 'Editor', exact: true }).click();
  await release(); await navigation.getByRole('button', { name: 'Branding', exact: true }).click();
  await expect(suggest).toBeEnabled(); await expect(proposal).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Text size', exact: true })).toHaveValue('larger');
  expect(await read(page, site.id)).toEqual(savedStyling);
  await page.screenshot({ path: info.outputPath('interrupted-layout-preserves-styling.png') });
  assertIsolated();
});

test('curated synthetic services fixture: composition changes the opening destination while preserving all content and display images', async ({ page, context }, info) => {
  const assertIsolated = await isolate(page, context);
  // Unlike the three source-import cases above, this is an explicitly curated
  // graph/media fixture for a controlled before/after composition comparison.
  let site = await createFixture(page, 1);
  const originalDraft = structuredClone(site.draft);
  const catalogPath = `/api/sites/${site.id}/knowledge?revisionId=${site.draft.knowledgeRevisionId}`;
  const originalCatalog: KnowledgeCatalog = (await (await page.request.get(catalogPath)).json()).catalog;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;

  async function capture(phase: 'baseline' | 'planned', viewport: { label: string; width: number; height: number }) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height }); await page.goto(`/s/${site.slug}`);
    const website = page.locator('[data-published-website]'); await expect(website).toBeVisible(); await page.evaluate(() => document.fonts.ready);
    for (const photo of await website.locator('img').all()) {
      await photo.scrollIntoViewIfNeeded();
      await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    }
    await page.evaluate(() => scrollTo(0, 0));
    const metrics = await website.evaluate(element => {
      const action = element.querySelector<HTMLAnchorElement>('.platform-website-hero-actions a');
      const sectionHeadings = [...element.querySelectorAll('.platform-website-section > header h2')].map(heading => heading.textContent?.trim() ?? '');
      return { pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
        firstHeroAction: { label: action?.textContent?.trim() ?? '', target: action?.getAttribute('href') ?? '' },
        navigationLabels: [...element.querySelectorAll('nav[aria-label="Website navigation"] a')].map(link => link.textContent?.trim() ?? ''),
        firstSectionHeading: sectionHeadings[0], sectionHeadings,
        allHeadings: [...element.querySelectorAll('h1,h2,h3')].map(heading => heading.textContent?.trim() ?? '').sort(),
        images: [...element.querySelectorAll<HTMLImageElement>('img')].map(image => ({ source: image.currentSrc || image.src,
          naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, renderedWidth: image.getBoundingClientRect().width,
          inCard: !!image.closest('.platform-website-card') })),
      };
    });
    expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.images.length).toBeGreaterThan(0);
    expect(metrics.images.every(image => image.naturalWidth > 0)).toBe(true);
    const cardImages = metrics.images.filter(image => image.inCard);
    expect(cardImages.length).toBeGreaterThan(0);
    expect(cardImages.every(image => image.naturalWidth > 480 && !new URL(image.source).searchParams.has('size'))).toBe(true);
    await page.screenshot({ path: info.outputPath(`curated-services-${phase}-${viewport.label}.png`), fullPage: true });
    return metrics;
  }
  const viewports = [{ label: 'desktop', width: 1440, height: 1000 }, { label: 'mobile', width: 390, height: 844 }];
  const baseline = [];
  for (const viewport of viewports) baseline.push({ viewport: viewport.label, ...await capture('baseline', viewport) });
  const plan = await localProposal(page, site);
  expect(plan.sectionOrder[0]).toBe('collection-services');
  expect(plan.navigation[0]).toMatchObject({ sectionId: 'collection-services', label: 'Services' });
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, websiteComposition: plan } })).site;
  const { websiteComposition: savedPlan, ...savedContent } = site.draft;
  expect(savedPlan).toEqual(plan); expect(savedContent).toEqual(originalDraft);
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  expect((await (await page.request.get(catalogPath)).json()).catalog).toEqual(originalCatalog);
  const planned = [];
  for (const [index, viewport] of viewports.entries()) {
    const actual = await capture('planned', viewport); planned.push({ viewport: viewport.label, ...actual });
    expect(baseline[index].firstSectionHeading).toBe('Good work begins with listening.');
    expect(actual.firstSectionHeading).toBe('Ways we can work together');
    expect(actual.firstHeroAction.target).toMatch(/-collection-services$/);
    expect(baseline[index].firstHeroAction.target).toMatch(/-introduction$/);
    expect(actual.firstHeroAction.label).toContain('Services'); expect(actual.navigationLabels[0]).toBe('Services');
    expect(actual.allHeadings).toEqual(baseline[index].allHeadings);
    expect([...actual.sectionHeadings].sort()).toEqual([...baseline[index].sectionHeadings].sort());
  }
  await writeFile(info.outputPath('curated-services-composition-ab.json'), JSON.stringify({ sourceMethod: 'Curated synthetic graph/media fixture; not an actual source import or live model result',
    canonicalContentUnchanged: true, canonicalCatalogUnchanged: true, styleUnchanged: true, plan, baseline, planned }, null, 2));
  assertIsolated();
});
