import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { templateFixtures } from '../../fixtures/template-sites';
import { WEBSITE_TEMPLATES } from '@thevoice/platform-ui/site-design';
import type { Site } from '../../lib/site-model';

export const origin = process.env.WEBSITE_TEST_ORIGIN ?? 'http://127.0.0.1:3225';
export async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post(path, { headers: { Origin: origin }, data });
  const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body;
}
export async function read(page: Page, id: string): Promise<Site> { return (await (await page.request.get(`/api/sites/${id}`)).json()).site; }
export async function studio(page: Page, site: Site, panel = 'Branding') {
  await page.goto('/'); const picker = page.getByRole('combobox', { name: 'Current site', exact: true }); await expect(picker).toBeEnabled();
  if (await picker.inputValue() !== site.id) await picker.selectOption(site.id);
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: panel, exact: true }).click();
}
export async function createFixture(page: Page, index: number, imageSize = { width: 1400, height: 1100 }, fixture = templateFixtures[index]) {
  let site: Site = (await post(page, '/api/sites', { name: fixture.content.name, slug: `template-${fixture.id}-${Date.now()}`, kind: 'general' })).site;
  const upload = async (name: string, contentType: string, bytes: Buffer) => {
    const response = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': contentType, 'X-File-Name': name, 'X-Site-Revision': String(site.revision) }, data: bytes });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); site = body.site; return body.fileId as string;
  };
  const seed = await upload('synthetic.txt', 'text/plain', Buffer.from('Name: Synthetic starting point\nKind: item\nSummary: Replaced by the fixture in review.'));
  let state = await post(page, `/api/sites/${site.id}/knowledge`, { action: 'analyze', revision: site.revision, fileId: seed, requestId: randomUUID() });
  let candidate = state.candidates.at(-1);
  state = await post(page, `/api/sites/${site.id}/knowledge`, { action: 'revise', revision: site.revision, candidateId: candidate.id, catalog: { ...fixture.catalog, id: candidate.catalog.id } }); candidate = state.candidates.at(-1);
  site = (await post(page, `/api/sites/${site.id}/knowledge`, { action: 'apply', revision: site.revision, candidateId: candidate.id, candidateRevisionId: candidate.catalog.id })).site;
  if (index !== 2) {
    // Original synthetic still-life illustrations; no stock photos or external requests.
    const images: string[] = [];
    for (let i = 0; i < 2; i++) {
      const stillLife = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1100"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${i ? '#abb9ae' : '#d2c0a6'}"/><stop offset="1" stop-color="${i ? '#455e52' : '#998570'}"/></linearGradient><filter id="s"><feGaussianBlur stdDeviation="25"/></filter></defs><rect width="1400" height="1100" fill="url(#g)"/><ellipse cx="720" cy="830" rx="440" ry="85" fill="#202319" opacity=".2" filter="url(#s)"/><path d="M270 530 Q700 330 1140 540 L1010 790 Q700 920 380 790Z" fill="#eae2d2"/><ellipse cx="705" cy="525" rx="435" ry="160" fill="#f5efe5"/><ellipse cx="705" cy="520" rx="370" ry="115" fill="#b9aa8e"/><path d="M380 510 Q650 260 920 580 Q1000 460 1080 460 Q830 670 380 510" fill="#687953"/><circle cx="750" cy="510" r="65" fill="#b98450"/><circle cx="570" cy="535" r="48" fill="#c99355"/></svg>`;
      const portfolio = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1100"><defs><linearGradient id="desk" x2="1" y2="1"><stop stop-color="#ddc9b2"/><stop offset="1" stop-color="#9d8777"/></linearGradient><filter id="shadow"><feGaussianBlur stdDeviation="22"/></filter></defs><rect width="1400" height="1100" fill="url(#desk)"/><ellipse cx="720" cy="840" rx="450" ry="65" fill="#202522" opacity=".22" filter="url(#shadow)"/><g transform="translate(360 210) rotate(-8 340 350)"><rect x="15" y="20" width="680" height="680" fill="#e6e0d3"/><rect width="680" height="680" fill="${i ? '#264841' : '#ebe7d9'}"/><path d="M0 460Q180 180 360 470T680 370V680H0Z" fill="${i ? '#c6d2aa' : '#ad583e'}"/><circle cx="500" cy="230" r="95" fill="${i ? '#e6ccad' : '#c4b789'}"/><path d="M30 600Q190 320 400 590T680 510V680H30Z" fill="${i ? '#82916e' : '#40594a'}"/><text x="54" y="105" font-family="Georgia,serif" font-size="64" fill="${i ? '#f7f0e2' : '#26382f'}">Field Notes</text><path d="M54 132H625" stroke="${i ? '#f7f0e2' : '#26382f'}"/><text x="54" y="166" font-family="Arial,sans-serif" font-size="17" letter-spacing="3" fill="${i ? '#f7f0e2' : '#26382f'}">A SYNTHETIC DESIGN STUDY</text></g></svg>`;
      const svg = index === 1 ? portfolio : stillLife;
      images.push(await upload(`synthetic-study-${i}.png`, 'image/png', await sharp(Buffer.from(svg)).resize(imageSize).png().toBuffer()));
    }
    site = (await post(page, `/api/sites/${site.id}/media`, { revision: site.revision, library: { schemaVersion: 1, id: randomUUID(), assets: images.map((id, i) => ({ id, ...imageSize, caption: index === 1 ? `Field Notes — design study ${i + 1}` : `A study in form ${i + 1}`, alt: index === 1 ? 'Synthetic journal design on a studio desk' : 'Synthetic still-life illustration', credit: 'Original synthetic test illustration' })), albums: [{ id: 'studies', title: 'A closer look', description: 'Illustrative studies for this synthetic website.', assetIds: images }], associations: [...images.map((assetId, i) => ({ id: `site-${i}`, assetId, targetType: 'site', primary: i === 0, role: 'example' })), ...(index === 1 ? [{ id: 'project-example', assetId: images[1], targetType: 'entity', targetId: 'field-notes', role: 'example' }] : [])] } })).site;
  }
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, ...fixture.content, visitor: { ...site.draft.visitor, enabled: false }, opening: { ...site.draft.opening, copyMode: 'personalized' }, style: { ...WEBSITE_TEMPLATES.editorial.defaults, entry: 'website' } } })).site;
  return site;
}
