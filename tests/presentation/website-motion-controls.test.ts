import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublishedWebsite, type WebsiteSection } from '../../packages/platform-ui/src/PublishedWebsite';

test('animated website disclosures retain native controls and complete qualified answers in server HTML', () => {
  const sections: WebsiteSection[] = [
    { id: 'questions', title: 'Questions', kind: 'faq', entries: [{ id: 'access', name: 'Can everyone attend?', body: 'Access depends on the venue. Contact the organiser before booking.', values: [{ label: 'Cost', text: 'From £12; materials cost extra.' }] }] },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `section-${i}`, title: `Guide ${i + 1}`, kind: 'information' as const, entries: [{ id: `entry-${i}`, name: `Guide ${i + 1}`, body: 'Published guide information.' }] })),
  ];
  const before = structuredClone(sections);
  for (const template of ['editorial', 'showcase', 'clarity'] as const) for (const websiteMotion of ['off', 'subtle', 'expressive'] as const) {
    const html = renderToStaticMarkup(createElement(PublishedWebsite, {
      name: 'Community guide', headline: 'Explore together', description: '', template, websiteMotion, sections,
      assistantEnabled: false, onOpen() {}, onHome() {}, onInteraction() {},
    }));
    assert.match(html, /<details[^>]*><summary>Can everyone attend\?/);
    assert.match(html, /<summary>More<svg[^>]*aria-hidden="true"/);
    assert.match(html, /<summary>Menu<svg[^>]*aria-hidden="true"/);
    assert.match(html, /Access depends on the venue\. Contact the organiser before booking\./);
    assert.match(html, /From £12; materials cost extra\./);
    assert.equal((html.match(/aria-label="Mobile website navigation"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /inert="|aria-hidden="true"[^>]*data-website-disclosure-content|style="[^"]*(?:height:0|visibility:hidden)/);
    for (const section of sections) assert.ok(html.includes(`>${section.title}<`), `${section.title} remains reachable through navigation`);
  }
  assert.deepEqual(sections, before, 'motion does not rewrite the publication');
});

test('collection expansion remains an accessible explicit control with a bounded initial collection', () => {
  const html = renderToStaticMarkup(createElement(PublishedWebsite, {
    name: 'Lessons', headline: 'Choose a lesson', description: '', template: 'clarity', assistantEnabled: false,
    onOpen() {}, onHome() {}, onInteraction() {},
    sections: [{ id: 'lessons', title: 'Lessons', kind: 'collection', entries: Array.from({ length: 15 }, (_, i) => ({ id: `lesson-${i}`, name: `Lesson ${i + 1}`, kind: 'service', body: 'Confirm dates before booking.' })) }],
  }));
  assert.equal((html.match(/class="platform-content-card platform-website-card"/g) ?? []).length, 6);
  assert.match(html, /type="button" class="platform-website-more" aria-expanded="false" aria-controls="[^"]+-entries"/);
  assert.match(html, />Explore all 15 <svg[^>]*aria-hidden="true"/);
  assert.equal((html.match(/Confirm dates before booking\./g) ?? []).length, 6);
  assert.doesNotMatch(html, /Lesson 7</);
});
