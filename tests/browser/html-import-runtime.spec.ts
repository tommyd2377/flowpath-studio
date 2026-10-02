import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const origin = 'http://127.0.0.1:3225';

// Exercise the actual production Route Handler. Source-only parser tests do not
// detect a dependency that breaks when Next bundles the server application.
test('production HTML import decodes entities and retains a complete unpublished proposal', async ({ request }) => {
  const created = await request.post('/api/sites', {
    headers: { Origin: origin },
    data: { name: 'HTML runtime proof', slug: `html-runtime-${randomUUID()}`, kind: 'general' },
  });
  expect(created.ok()).toBeTruthy();
  let { site } = await created.json();
  const originalDraft = structuredClone(site.draft);
  const closing = 'Final qualification: reservations are subject to confirmation & availability.';
  const html = `<!DOCTYPE html><html><head><title>Harbor &amp; Pine</title></head><body>
    <header><nav>Site navigation</nav></header><main><article>
      <header><h1>Harbor &amp; Pine &#8212; dinner</h1><p>Prices aren&rsquo;t a promise of availability.</p></header>
      <p>${'Seasonal dinner information. '.repeat(90)}</p>
      <p>${closing.replaceAll('&', '&amp;')}</p>
    </article></main></body></html>`;
  const uploaded = await request.post(`/api/sites/${site.id}/files`, {
    headers: { Origin: origin, 'Content-Type': 'text/html', 'X-File-Name': 'harbor.html', 'X-Site-Revision': String(site.revision) },
    data: Buffer.from(html),
  });
  expect(uploaded.ok()).toBeTruthy();
  const file = await uploaded.json();
  site = file.site;
  const analyzed = await request.post(`/api/sites/${site.id}/knowledge`, {
    headers: { Origin: origin },
    data: { action: 'analyze', fileId: file.fileId, revision: site.revision, requestId: randomUUID() },
  });
  expect(analyzed.ok()).toBeTruthy();
  const state = await analyzed.json();
  expect(state.semanticMode).toBe('structured');
  expect(state.candidates, JSON.stringify(state.jobs)).toHaveLength(1);
  const catalog = state.candidates[0].catalog;
  const dinner = catalog.entities.find((entity: { name: string }) => entity.name === 'Harbor & Pine — dinner');
  expect(dinner).toBeDefined();
  const retained = dinner.blocks.map((block: { text?: string }) => block.text ?? '').join('\n');
  expect(retained).toContain('Prices aren’t a promise of availability.');
  expect(retained).toContain(closing);
  expect(retained).not.toContain('<!DOCTYPE');
  const current = await (await request.get(`/api/sites/${site.id}`)).json();
  expect(current.site.draft).toEqual(originalDraft);
  expect(current.site.published).toBeNull();
});
