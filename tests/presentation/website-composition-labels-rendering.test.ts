import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublishedWebsite } from '../../packages/platform-ui/src/PublishedWebsite.js';
import { templateFixtures } from '../../fixtures/template-sites';
import { applyWebsiteCompositionSections, buildWebsiteCompositionManifest, proposeWebsiteComposition } from '../../lib/website-composition';
import { publishedWorkspace } from '../../lib/visitor-workspace';
import { websiteSections } from '../../lib/website-presentation';

test('generated class and program labels render on the same section anchors without rewriting headings or facts', () => {
  for (const [title, label] of [['Acting classes', 'Classes'], ['Treatment programs', 'Programs']]) {
    const { content, catalog } = structuredClone(templateFixtures[1]);
    catalog.collections[0].name = title;
    const sections = websiteSections(publishedWorkspace(content, catalog), content, catalog);
    const manifest = buildWebsiteCompositionManifest(content, catalog), plan = proposeWebsiteComposition(manifest);
    const html = renderToStaticMarkup(createElement(PublishedWebsite, {
      name: content.name, headline: content.headline, description: content.description,
      sections: applyWebsiteCompositionSections(sections, plan), primaryAction: plan.primaryAction,
      onOpen() {}, onHome() {}, onInteraction() {}, assistantEnabled: false,
    }));
    assert.match(html, new RegExp(`<h2[^>]*>${title}</h2>`));
    assert.match(html, new RegExp(`href="#[^"]+-collection-services"[^>]*>${label}(?: |<)`));
    assert.match(html, /scope agreed after an initial conversation/);
    assert.doesNotMatch(html, /href="(?:https?:|javascript:)|Book instantly|Guaranteed admission/);
  }
});
