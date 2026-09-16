import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Site } from '../../../lib/site-model';
import { semanticFixture } from '../../../fixtures/semantic-knowledge/graph';
import { DEFAULT_OPENING } from '../../../lib/site-opening';
import { DEFAULT_EXPLORE_SETTINGS } from '../../../lib/explore-model';

const origin = 'http://127.0.0.1:3225';
export async function carouselFixture(page: Page, generalPhotos = false, websiteFirst = true) {
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { headers: { Origin: origin }, data });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body;
  };
  let site: Site = (await post('/api/sites', { name: 'Harbor Journal', slug: `website-${Date.now()}`, kind: 'general' })).site;
  const upload = async (name: string, mime: string, data: Buffer) => {
    const response = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': mime, 'X-File-Name': name, 'X-Site-Revision': String(site.revision) }, data });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); site = body.site; return body.fileId as string;
  };
  const fileId = await upload('synthetic-guide.txt', 'text/plain', await readFile('fixtures/semantic-knowledge/business.txt'));
  let review = await post(`/api/sites/${site.id}/knowledge`, { action: 'analyze', revision: site.revision, fileId, requestId: randomUUID() });
  const graph = structuredClone(semanticFixture); graph.id = review.candidates[0].catalog.id;
  graph.name = 'An invitation to slow down.'; graph.description = 'Meet the makers, discover workshops, and explore objects shaped by hand. A collection of stories from Harbor Studio.';
  graph.entities.find(entity => entity.id === 'blue')!.summary = 'A soft blue glaze, an open shape, and room for everyday rituals.';
  graph.entities.push({ ...graph.entities.find(entity => entity.id === 'blue')!, id: 'blue-other-source', summary: 'A second published description, with a different price.', attributes: { price: 40 } });
  graph.collections.push({ id: 'overlap', name: 'Another selection', entityIds: ['blue-other-source', 'white'] });
  review = await post(`/api/sites/${site.id}/knowledge`, { action: 'revise', revision: site.revision, candidateId: review.candidates[0].id, catalog: graph });
  site = (await post(`/api/sites/${site.id}/knowledge`, { action: 'apply', revision: site.revision, candidateId: review.candidates[0].id })).site;
  const ids: string[] = [];
  const colors = generalPhotos ? ['#698ca1', '#c1a782', '#859982', '#94a1bf', '#b68778', '#647980', '#ac9772', '#547a68', '#c4a8b2'] : ['#698ca1', '#c1a782', '#859982'];
  for (const [index, color] of colors.entries()) {
    // Test-only illustration; no external images or model calls.
    const svg = `<svg width="900" height="680" xmlns="http://www.w3.org/2000/svg"><rect width="900" height="680" fill="${color}"/><ellipse cx="450" cy="520" rx="270" ry="55" fill="#243636" opacity=".15"/><path d="M220 275 Q450 720 680 275Z" fill="#ede5d5"/><ellipse cx="450" cy="275" rx="230" ry="70" fill="#e2d6bf"/><ellipse cx="450" cy="275" rx="197" ry="48" fill="${color}"/></svg>`;
    ids.push(await upload(`illustration-${index}.png`, 'image/png', await sharp(Buffer.from(svg)).png().toBuffer()));
  }
  site = (await post(`/api/sites/${site.id}/media`, { revision: site.revision, library: { schemaVersion: 1, id: randomUUID(),
    assets: ids.map((id, index) => ({ id, width: 900, height: 680, caption: `Studio study ${index + 1}`, alt: `Synthetic ceramic bowl illustration ${index + 1}`, credit: 'Local test illustration' })),
    albums: [{ id: 'studies', title: 'Studio studies', description: 'An illustrated collection.', assetIds: ids }],
    associations: ids.map((assetId, index) => ({ id: `association-${index}`, assetId, ...(generalPhotos ? { targetType: 'site' } : { targetType: 'entity', targetId: index === 1 ? 'white' : 'blue' }), role: 'example', primary: index === 0 })),
  } })).site;
  site = (await post(`/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft,
    contact: 'hello@harbor.example', hours: 'Tuesday–Sunday, 10am–5pm', style: { layout: 'editorial', palette: 'parchment', ...(websiteFirst ? { entry: 'website' } : {}) },
    opening: { ...DEFAULT_OPENING, initialAssetIds: [ids[0]], visibility: 'intro-only' },
    sections: [{ id: 'story', title: 'Made with time and intention.', body: 'A small studio with a generous spirit. Explore a practice grounded in material, place, and the people who make it their own.' }],
    visitorSpeaksFirst: true, visitor: { ...site.draft.visitor, enabled: true, mode: 'voice' }, explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled: true, annotations: true },
  } })).site;
  site = (await post(`/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`); return site;
}
