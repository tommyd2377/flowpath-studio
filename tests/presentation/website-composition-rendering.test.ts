import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublishedWebsite, type WebsiteSection } from '../../packages/platform-ui/src/PublishedWebsite.js';
import WebsiteSurface from '../../components/WebsiteSurface';
import { buildWebsiteCompositionManifest, proposeWebsiteComposition } from '../../lib/website-composition';
import { templateFixtures } from '../../fixtures/template-sites';

const sections: WebsiteSection[] = [{ id: 'services', title: 'Ways we can work together', navLabel: 'Services', kind: 'collection', entries: [{ id: 'consultation', name: 'Initial consultation', body: 'Scope agreed after discussion. No availability guarantee.' }] }];
const render = (options: Partial<Parameters<typeof PublishedWebsite>[0]> = {}) => renderToStaticMarkup(createElement(PublishedWebsite, {
  name: 'Synthetic studio', headline: 'Considered work', description: '', sections,
  onOpen() {}, onHome() {}, onInteraction() {}, assistantEnabled: false, ...options,
}));

test('short navigation and primary-action labels do not change headings, facts or destinations', () => {
  const html = render({ template: 'clarity', primaryAction: { actionId: 'section:services', label: 'View Services' } });
  assert.match(html, /<h2[^>]*>Ways we can work together<\/h2>/);
  assert.match(html, />Services</);
  assert.match(html, /href="#[^"]+-services"[^>]*>View Services /);
  assert.match(html, /Scope agreed after discussion\. No availability guarantee\./);
  assert.doesNotMatch(html, /href="(?:https?:|javascript:)/);
});

test('contact primary actions render without sections in each registered template', () => {
  for (const template of ['editorial', 'showcase', 'clarity'] as const) {
    const html = render({ template, sections: [], contact: 'hello@example.test', primaryAction: { actionId: 'contact', label: 'Get in touch' } });
    assert.match(html, /href="#[^"]+-contact"[^>]*>Get in touch /);
  }
});

test('unavailable primary destinations fall back to useful browsing and never create an external action', () => {
  const invalid = render({ primaryAction: { actionId: 'https://unapproved.example/buy', label: 'Buy now' } });
  assert.doesNotMatch(invalid, /Buy now|unapproved/);
  assert.match(invalid, /href="#[^"]+-services"[^>]*>Services /);
  const disabled = render({ primaryAction: { actionId: 'assistant', label: 'Ask a question' } });
  assert.doesNotMatch(disabled, /Ask a question/);
  assert.match(disabled, /href="#[^"]+-services"[^>]*>Services /);
  const enabled = render({ assistantEnabled: true, primaryAction: { actionId: 'assistant', label: 'Ask a question' } });
  const hero = enabled.split('platform-website-hero-actions')[1].split('</div>')[0];
  assert.match(hero, /Ask a question/);
  assert.doesNotMatch(hero, /href=/);
});

test('a v2 collection preview uses the same canonical composition as publication even with retained legacy knowledge', () => {
  const fixture = structuredClone(templateFixtures[1]);
  const content = { ...fixture.content, catalogPublicationId: '22222222-2222-4222-8222-222222222222' };
  const plan = proposeWebsiteComposition(buildWebsiteCompositionManifest(content, null));
  const applied = { ...content, style: content.style ?? plan.style, websiteComposition: plan };
  const preview = renderToStaticMarkup(createElement(WebsiteSurface, { content: applied, catalog: fixture.catalog, onAsk() {} }));
  const published = renderToStaticMarkup(createElement(WebsiteSurface, { content: applied, catalog: null, onAsk() {} }));
  assert.equal(preview, published);
  assert.ok(!preview.includes(fixture.catalog.entities[0].name), 'superseded knowledge does not leak into the website preview');
});
