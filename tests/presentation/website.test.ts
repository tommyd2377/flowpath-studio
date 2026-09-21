import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublishedWebsite } from '@thevoice/platform-ui';

test('website server HTML is visible without observers, preserves qualifiers and uses native disclosures', () => {
  for (const template of ['editorial', 'showcase', 'clarity'] as const) {
    const html = renderToStaticMarkup(createElement(PublishedWebsite, {
      name: 'Synthetic studio', headline: 'Considered work', description: '', template, websiteMotion: 'expressive',
      onOpen() {}, onHome() {}, onInteraction() {}, assistantEnabled: false,
      sections: [{ id: 'services', title: 'Services', kind: 'collection', entries: [{ id: 'service', kind: 'service', name: 'Design', body: 'A careful process.', values: [{ label: 'Price', text: 'From $80; minimum two sessions' }] }] }, { id: 'faq', title: 'Questions', kind: 'faq', entries: [{ id: 'question', name: 'How does it work?', body: 'Contact us to discuss your requirements.' }] }, { id: 'reading', title: 'Approach', kind: 'stories', entries: [{ id: 'approach', name: 'Approach', blocks: [{ id: 'heading', kind: 'heading', text: 'A considered process' }] }] }],
    }));
    assert.ok(!/opacity:0|visibility:hidden/.test(html), 'essential server content must not start hidden');
    assert.match(html, /From \$80; minimum two sessions/);
    assert.match(html, /<details[^>]*><summary>/);
    assert.match(html, /data-collection-layout="services"/);
    assert.match(html, /data-website-motion="expressive"/);
    assert.match(html, /<h3 class="platform-website-story-subheading">A considered process<\/h3>/);
    assert.ok(!html.includes('Explore the collection'));
  }
});

test('generated menu summaries and repeated reading headings do not repeat while all meaningful qualifications stay visible', () => {
  const terms = 'Half Sheet ~ $150.00* Starting Price - Additional charges may apply based on order.';
  const entries = [{ id: 'cake', name: 'Half Sheet', body: `Catering / Cakes. ${terms}. Listed information; availability is not verified.`, values: [
    { label: 'Listed price (USD)', text: 'USD 150' }, { label: 'Source category', text: 'Catering / Cakes' }, { label: 'Price / size terms', text: terms },
  ] }, { id: 'bread', name: 'Bread', body: 'Our bakers prepare this every morning.', values: [{ label: 'Price', text: 'USD 8' }] },
  { id: 'subscription', name: 'Membership', body: 'Plans. From $20. Listed information; availability is not verified.', values: [{ label: 'Price', text: 'USD 20 / month' }, { label: 'Category', text: 'Plans' }, { label: 'Price terms', text: 'From $20' }] }];
  const sections = [{ id: 'menu', title: 'Catering / Cakes', kind: 'collection' as const, entries }, { id: 'guide', title: 'Guide', kind: 'stories' as const, entries: [{ id: 'climate', name: 'Climate', blocks: [{ id: 'h', kind: 'heading' as const, text: 'Climate' }, { id: 'p', kind: 'paragraph' as const, text: 'Four distinct seasons.' }] }] }];
  const original = structuredClone(sections);
  const html = renderToStaticMarkup(createElement(PublishedWebsite, {
    name: 'Published business', headline: 'Welcome', description: '', sections, onOpen() {}, onHome() {}, onInteraction() {}, assistantEnabled: false,
  }));
  assert.equal(html.split('Additional charges may apply').length - 1, 1);
  assert.ok(!html.includes('Source category:'));
  assert.ok(!html.includes('Listed information; availability is not verified'));
  assert.match(html, /Starting Price - Additional charges may apply/);
  assert.match(html, /\$8.00/);
  assert.match(html, /Our bakers prepare this every morning/);
  assert.match(html, /\$20.00 \/ month/);
  assert.match(html, /Price terms: From \$20/);
  assert.equal((html.match(/>Climate<\/h[34]>/g) ?? []).length, 1);
  assert.match(html, /Four distinct seasons/);
  assert.deepEqual(sections, original, 'details and canonical source wording remain untouched');
});

test('old publications render the refined website and qualified imported prices without selecting or publishing a template', () => {
  for (const [layout, template] of [['editorial', 'editorial'], ['compact', 'clarity'], ['balanced', 'clarity']] as const) {
    const html = renderToStaticMarkup(createElement(PublishedWebsite, {
      name: 'A published bakery', headline: 'Our menu', description: '', layout,
      styleSettings: { layout, palette: 'forest', typography: 'literary', textSize: 'larger', websiteMotion: 'off' }, websiteMotion: 'off',
      onOpen() {}, onHome() {}, onInteraction() {}, assistantEnabled: false,
      sections: [{ id: 'offerings', title: 'Catering', kind: 'collection', entries: [{ id: 'sheet', kind: 'offering', name: 'Half Sheet', values: [
        { label: 'Listed price (USD)', text: 'USD 150' }, { label: 'Category', text: 'Catering' }, { label: 'Size', text: 'Half sheet' },
        { label: 'Price / size terms', text: 'Starting price; additional charges may apply based on order.' },
      ] }] }],
    }));
    assert.match(html, new RegExp(`data-template="${template}"`));
    assert.match(html, /data-website-design="refined"/);
    assert.match(html, /data-collection-layout="priced"/);
    assert.match(html, /class="platform-website-price"/);
    assert.match(html, /Starting price; additional charges may apply based on order/);
    assert.match(html, /--platform-text-scale:1.125/);
    assert.ok(!html.includes('--platform-bg:'), 'website fallbacks must retain inherited publisher colors');
  }
});
