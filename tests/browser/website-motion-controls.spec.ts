import { test, expect, type Locator, type Page } from '@playwright/test';
import { WEBSITE_TEMPLATES, type WebsiteTemplate } from '@thevoice/platform-ui/site-design';
import { templateFixtures } from '../../fixtures/template-sites';
import { createFixture, post } from './website-fixtures';

test.use({ video: 'on' });

async function publishStyle(page: Page, site: Awaited<ReturnType<typeof createFixture>>, template: WebsiteTemplate, mode: 'off' | 'subtle' = 'subtle') {
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, style: { ...WEBSITE_TEMPLATES[template].defaults, websiteMotion: mode, entry: 'website' } } })).site;
  return (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
}

// Sample actual geometry, including the first frames. Playwright's ordinary
// click waits for stability and would miss the early part of a reversal.
async function measureClick(control: Locator, kind: 'disclosure' | 'collection') {
  return control.evaluate((node, kind) => new Promise<number[]>(resolve => {
    const body = kind === 'disclosure' ? node.closest('details')!.querySelector<HTMLElement>('[data-website-disclosure-content]')! : node.closest('.platform-website-section-body')!;
    const frames = [body.getBoundingClientRect().height], start = performance.now();
    (node as HTMLElement).click();
    const sample = () => { frames.push(body.getBoundingClientRect().height); if (performance.now() - start < 750) requestAnimationFrame(sample); else resolve(frames); };
    requestAnimationFrame(sample);
  }), kind);
}

test('native FAQ disclosures animate both directions, reverse safely and keep their answers intact', async ({ page }, info) => {
  let site = await createFixture(page, 2);
  for (const template of ['editorial', 'showcase', 'clarity'] as const) {
    site = await publishStyle(page, site, template);
    await page.goto(`/s/${site.slug}`);
    const details = page.locator('.platform-website-faq details').first(), summary = details.locator('summary'), body = details.locator('[data-website-disclosure-content]');
    await summary.scrollIntoViewIfNeeded(); await page.waitForTimeout(1200);
    const opening = await measureClick(summary, 'disclosure');
    expect(new Set(opening.map(n => n.toFixed(1))).size).toBeGreaterThan(5);
    await expect(details).toHaveAttribute('open', '');
    await expect(body).toContainText('Contact the relevant venue to confirm your requirements.');
    expect(await body.evaluate(node => node.style.height)).toBe('');
    await info.attach(`${template}-expanded-question`, { body: await page.screenshot(), contentType: 'image/png' });
    const closing = await measureClick(summary, 'disclosure');
    expect(new Set(closing.map(n => n.toFixed(1))).size).toBeGreaterThan(5);
    await expect(details).not.toHaveAttribute('open');
    await summary.evaluate(node => new Promise<void>(resolve => {
      (node as HTMLElement).click();
      setTimeout(() => (node as HTMLElement).click(), 70);
      setTimeout(() => (node as HTMLElement).click(), 130);
      setTimeout(resolve, 800);
    }));
    await expect(details).toHaveAttribute('open', '');
    expect(await body.evaluate(node => ({ inert: (node as HTMLElement).inert, height: node.style.height, hidden: node.getAttribute('aria-hidden') }))).toEqual({ inert: false, height: '', hidden: null });
    await info.attach(`${template}-disclosure-heights`, { body: JSON.stringify({ opening, closing }), contentType: 'application/json' });
  }
});

test('live reduced motion settles an in-flight disclosure and Off keeps native details usable', async ({ page }) => {
  let site = await createFixture(page, 2); site = await publishStyle(page, site, 'clarity');
  await page.goto(`/s/${site.slug}`);
  const details = page.locator('.platform-website-faq details').first(), summary = details.locator('summary'), body = details.locator('[data-website-disclosure-content]');
  await summary.scrollIntoViewIfNeeded(); await page.waitForTimeout(1000);
  await summary.evaluate(node => (node as HTMLElement).click());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(details).toHaveAttribute('open', '');
  await expect.poll(() => body.evaluate(node => node.style.height)).toBe('');
  await summary.click(); await expect(details).not.toHaveAttribute('open');
  await summary.click(); await expect(body).toBeVisible();
  expect(await body.evaluate(node => ({ inert: (node as HTMLElement).inert, height: node.style.height }))).toEqual({ inert: false, height: '' });
  site = await publishStyle(page, site, 'clarity', 'off');
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto(`/s/${site.slug}`);
  await summary.click(); await expect(details).toHaveAttribute('open', '');
  expect(await body.evaluate(node => node.style.height)).toBe('');
  await summary.press('Enter'); await expect(details).not.toHaveAttribute('open');
});

test('mobile menu restores focus before closing becomes inert and native anchor navigation wins', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let site = await createFixture(page, 2); site = await publishStyle(page, site, 'editorial');
  await page.goto(`/s/${site.slug}`); await page.waitForTimeout(1200);
  const menu = page.locator('.platform-website-mobile-nav'), summary = menu.locator('summary'), body = menu.locator('[data-website-disclosure-content]');
  await summary.click(); await expect(menu.getByRole('link').first()).toBeVisible();
  await page.waitForTimeout(450);
  const closing = await menu.evaluate(details => {
    const summary = details.querySelector('summary')!, body = details.querySelector<HTMLElement>('[data-website-disclosure-content]')!;
    details.querySelector<HTMLElement>('a')!.focus(); summary.click();
    return { focused: document.activeElement === summary, inert: body.inert };
  });
  expect(closing).toEqual({ focused: true, inert: true });
  await expect(menu).not.toHaveAttribute('open');
  await summary.click(); await summary.press('Escape'); await expect(menu).not.toHaveAttribute('open'); await expect(summary).toBeFocused();
  await summary.click(); await page.waitForTimeout(450);
  const link = menu.getByRole('link').first(), href = await link.getAttribute('href');
  await link.click(); await expect(menu).not.toHaveAttribute('open');
  await expect(page.locator(href!)).toBeFocused();
  expect(await body.evaluate(node => ({ inert: (node as HTMLElement).inert, height: node.style.height }))).toEqual({ inert: false, height: '' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('collection expands and contracts over real frames while retaining existing cards and keyboard focus', async ({ page }, info) => {
  const fixture = structuredClone(templateFixtures[0]);
  for (let i = 0; i < 9; i++) { const id = `extra-${i}`; fixture.catalog.entities.push({ ...fixture.catalog.entities[0], id, name: `Seasonal selection ${i + 1}` }); fixture.catalog.collections[0].entityIds.push(id); }
  let site = await createFixture(page, 0, undefined, fixture); site = await publishStyle(page, site, 'showcase');
  await page.goto(`/s/${site.slug}`);
  const section = page.getByRole('region', { name: 'Menus to share', exact: true }), more = section.locator('.platform-website-more'), body = section.locator('.platform-website-section-body');
  await more.scrollIntoViewIfNeeded(); await page.waitForTimeout(1200);
  await section.evaluate(node => { Object.assign(window, { originalWebsiteCard: node.querySelector('.platform-website-card') }); });
  const opening = await measureClick(more, 'collection');
  expect(new Set(opening.map(n => n.toFixed(1))).size).toBeGreaterThan(5);
  await expect(more).toHaveAttribute('aria-expanded', 'true'); await expect(section.locator('.platform-website-card')).toHaveCount(12);
  expect(await body.evaluate(node => node.style.height)).toBe('');
  expect(await section.evaluate(node => node.querySelector('.platform-website-card') === (window as unknown as { originalWebsiteCard: Element }).originalWebsiteCard)).toBe(true);
  await info.attach('expanded-collection', { body: await page.screenshot(), contentType: 'image/png' });
  await section.locator('.platform-website-card').last().focus();
  const closing = await measureClick(more, 'collection');
  expect(new Set(closing.map(n => n.toFixed(1))).size).toBeGreaterThan(5);
  await expect(more).toHaveAttribute('aria-expanded', 'false'); await expect(section.locator('.platform-website-card')).toHaveCount(6); await expect(more).toBeFocused();
  expect(await body.evaluate(node => node.style.height)).toBe('');
  await info.attach('collection-height-frames', { body: JSON.stringify({ opening, closing }), contentType: 'application/json' });
  await more.evaluate(node => (node as HTMLElement).click()); await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => body.evaluate(node => node.style.height)).toBe('');
  await expect(section.locator('.platform-website-card')).toHaveCount(12);
  await more.click(); await expect(more).toHaveAttribute('aria-expanded', 'false');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('[data-published-website]')).toHaveAttribute('data-website-reduced', 'false');
  await more.evaluate(node => new Promise<void>(resolve => {
    (node as HTMLElement).click();
    setTimeout(() => (node as HTMLElement).click(), 70);
    setTimeout(() => (node as HTMLElement).click(), 130);
    setTimeout(resolve, 800);
  }));
  await expect(more).toHaveAttribute('aria-expanded', 'true'); await expect(section.locator('.platform-website-card')).toHaveCount(12);
  expect(await body.evaluate(node => node.style.height)).toBe('');
  await info.attach('collection-after-rapid-reversal', { body: await page.screenshot(), contentType: 'image/png' });
});
