import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WebsiteDesignReview from '../../components/WebsiteDesignReview';
import { sampleContent } from '../../lib/site-model';
import { websiteProposalSchema } from '../../lib/website-import-model';

test('semantic incompleteness shows an acknowledgement even when every page imported', () => {
  const content = sampleContent('general');
  const proposal = websiteProposalSchema.parse({ incomplete: true,
    design: { name: content.name, headline: content.headline, description: content.description, accent: content.accent },
    pages: [{ url: 'https://workshop.example/', title: 'Workshop', status: 'imported', message: 'Captured.', characters: 100 }],
    capturedAt: '2026-09-24T12:00:00.000Z', notes: ['Two source schedules conflict.'] });
  const html = renderToStaticMarkup(createElement(WebsiteDesignReview, { proposal, design: proposal.design, content,
    catalog: { schemaVersion: 1, id: randomUUID(), name: 'Workshop', description: '', entities: [], attributes: [], collections: [], relationships: [], jobs: [] },
    disabled: false, onChange() {}, include: false, onInclude() {}, acceptPartial: false, onAcceptPartial() {} }));
  assert.match(html, /This is a partial website import/);
  assert.match(html, /I reviewed the incomplete import report/);
  assert.match(html, /Two source schedules conflict/);
  assert.doesNotMatch(html, /reviewed the missing pages/);
});
