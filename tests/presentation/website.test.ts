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
  assert.match(html, /<span>month<\/span><span>\$20.00<\/span>/);
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

test('imported unit prices and descriptions appear once without technical source labels', () => {
  const terms = 'Workshop (Limited Dates) Session: $40, Series: $150 Four weekly meetings. Materials vary; confirm details.';
  const entry = { id: 'workshop', name: 'Workshop (Limited Dates)', body: `Classes. ${terms} Listed information; availability is not verified.`, values: [
    { label: 'Listed Session price (USD)', text: 'USD 40 / Session' }, { label: 'Listed Series price (USD)', text: 'USD 150 / Series' },
    { label: 'Source category', text: 'Classes' }, { label: 'Price / size terms', text: terms },
  ] };
  const original = structuredClone(entry);
  const render = () => renderToStaticMarkup(createElement(PublishedWebsite, {
    name: 'A studio', headline: 'Classes', description: '', template: 'clarity', assistantEnabled: false,
    onOpen() {}, onHome() {}, onInteraction() {}, sections: [{ id: 'classes', title: 'Classes', kind: 'collection', entries: [entry] }],
  }));
  const html = render();
  assert.equal(html.split('Four weekly meetings.').length - 1, 1);
  assert.equal(html.split('Materials vary; confirm details.').length - 1, 1);
  assert.equal(html.split('<span>Session</span><span>$40.00</span>').length - 1, 1);
  assert.equal(html.split('<span>Series</span><span>$150.00</span>').length - 1, 1);
  assert.doesNotMatch(html, /Session: \$40|Series: \$150/);
  assert.match(html, /class="platform-content-card-description platform-website-price-description">Four weekly meetings\. Materials vary; confirm details\.<\/span>/);
  assert.match(html, /Limited Dates/);
  assert.match(html, /data-collection-layout="priced"/);
  assert.doesNotMatch(html, /Price \/ size terms:|Source category:|Listed Session price|Listed Series price|Listed information; availability is not verified/);
  assert.deepEqual(entry, original, 'full source details remain available when the card opens');
  entry.values[1].text = 'USD 180 / Series';
  const conflicting = render();
  assert.match(conflicting, /<span>Series<\/span><span>\$180.00<\/span>/);
  assert.match(conflicting, /Series: \$150/);
  assert.match(conflicting, /Price \/ size terms:/, 'different reviewed values must remain visible rather than silently folded into source wording');
});

test('menu and retail variants form compact price rows while conditions and descriptions stay outside the prices', () => {
  const cases = [
    { name: 'Example pizza', category: 'Menu', terms: 'Example pizza Slice: $12.50, Pie: $75 Slow cooked topping. Served on select days.', variants: [{ unit: 'Slice', value: 12.5 }, { unit: 'Pie', value: 75 }], expected: 'Slow cooked topping. Served on select days.' },
    { name: 'Example print', category: 'Prints', terms: 'Example print Small: £25; Large: £40 Paper selection changes weekly.', variants: [{ unit: 'Small', value: 25 }, { unit: 'Large', value: 40 }], currency: 'GBP', expected: 'Paper selection changes weekly.' },
    { name: 'Example lesson', category: 'Lessons', terms: 'Example lesson Hour: €35, Course: €140. Five sessions, subject to availability.', variants: [{ unit: 'Hour', value: 35 }, { unit: 'Course', value: 140 }], currency: 'EUR', expected: 'Five sessions, subject to availability.' },
  ];
  for (const example of cases) {
    const entry = { id: 'item', name: example.name, body: `${example.category}. ${example.terms} Listed information; availability is not verified.`, values: [
      ...example.variants.map(variant => ({ label: `Listed ${variant.unit} price (${example.currency ?? 'USD'})`, text: `${example.currency ?? 'USD'} ${variant.value} / ${variant.unit}` })),
      { label: 'Source category', text: example.category }, { label: 'Price / size terms', text: example.terms },
    ] };
    const html = renderToStaticMarkup(createElement(PublishedWebsite, { name: 'Example business', headline: 'Offerings', description: '', onOpen() {}, onHome() {}, onInteraction() {}, assistantEnabled: false,
      sections: [{ id: 'items', kind: 'collection', title: example.category, entries: [entry] }],
    }));
    assert.equal((html.match(/class="platform-website-price-variant"/g) ?? []).length, 2);
    assert.match(html, new RegExp(`platform-website-price-description">${example.expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`));
    const prices = html.slice(html.indexOf('<span class="platform-website-price">'), html.indexOf('<span class="platform-content-card-more">'));
    assert.equal(prices.includes(example.expected), false);
    assert.doesNotMatch(html, /Price \/ size terms:|Listed information; availability is not verified/);
  }
});

test('qualified, conflicting and range prices keep their source terms instead of becoming unconditional amounts', () => {
  const terms = ['From $20 per month; extra usage costs more.', '$20–$40 depending on materials.', '$20 to $40 depending on size.', 'Hour: $20; Weekend: $35 after 6pm.'];
  for (const source of terms) {
    const html = renderToStaticMarkup(createElement(PublishedWebsite, { name: 'Example services', headline: 'Services', description: '', onOpen() {}, onHome() {}, onInteraction() {}, assistantEnabled: false,
      sections: [{ id: 'services', kind: 'collection', title: 'Services', entries: [{ id: 'service', name: 'Session', body: `Services. ${source} Listed information; availability is not verified.`, values: [
        { label: 'Starting price', text: 'USD 20 / hour' }, { label: 'Source category', text: 'Services' }, { label: 'Price terms', text: source },
      ] }] }],
    }));
    assert.match(html, /<span>Starting price \/ hour<\/span>/);
    assert.ok(html.includes(`Price terms: ${source}`));
  }
});
