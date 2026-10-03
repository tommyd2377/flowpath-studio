import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlDocument, textBlocks } from '../lib/html-document';

const instruction = 'Main content starts here, tab to start navigating';
const intro = 'Food for the everyday.';
const fixture = `<html><head><title>Harbor Cafe</title></head><body>
  <header><a class="skip" href="#main-content">Skip to main content</a></header>
  <main><h1 class="sr-only">Home</h1><span class="sr-only" id="main-content">${instruction}</span>
    <div class="gallery"><span class="sr-only">Slide 1 of 7</span></div>
    <h3>${intro}</h3><h2>Hours</h2><p>Monday: 8am to 5pm.</p></main></body></html>`;

test('visible heading metadata uses the first main H3 before a later H2 when the H1 is accessible-only chrome', () => {
  assert.equal(htmlDocument(fixture).headline, intro);
});

test('exact accessible interface nodes leave semantic text without deleting business content or raw evidence', () => {
  const document = htmlDocument(fixture);
  assert.doesNotMatch(document.text, /^# Home$/m);
  assert.ok(!document.text.includes(instruction));
  assert.ok(!document.text.includes('Slide 1 of 7'));
  assert.match(document.text, /Food for the everyday\./);
  assert.match(document.text, /Monday: 8am to 5pm\./);
  assert.equal(document.rawText, ['Harbor Cafe', 'Skip to main content', '# Home', instruction,
    'Slide 1 of 7', `### ${intro}`, '## Hours', 'Monday: 8am to 5pm.'].join('\n'));
  assert.equal(document.rawText, htmlDocument(fixture, false).rawText);
});

test('accessible-only business headings and dietary, price and access qualifications remain source content', () => {
  const html = `<main><h1 class="sr-only">Catering: advance orders only</h1>
    <h2>Seasonal catering</h2><p>Vegan <span class="sr-only">except accompanying dairy sauce.</span></p>
    <p>$25 <span class="sr-only">per person; minimum ten guests.</span></p>
    <p class="screen-reader-text">Access requires stairs.</p>
    <p class="visually-hidden">Availability varies by location.</p></main>`;
  const document = htmlDocument(html);
  assert.equal(document.headline, 'Seasonal catering');
  for (const expected of ['Catering: advance orders only', 'except accompanying dairy sauce.',
    'per person; minimum ten guests.', 'Access requires stairs.', 'Availability varies by location.']) {
    assert.ok(document.text.includes(expected), expected);
    assert.ok(document.rawText.includes(expected), expected);
    assert.ok(textBlocks(document.text).some(block => block.text.includes(expected)), expected);
  }
  assert.match(document.text, /Vegan except accompanying dairy sauce\./);
  assert.match(document.text, /\$25 per person; minimum ten guests\./);
});

test('class lookalikes, visible and outside-gallery counters, qualified counters and captions survive', () => {
  const html = `<main><h1 class="sr-only-note">Our cafe</h1><h2>Visit us</h2>
    <span class="sr-only">Slide 1 of 4</span><div class="gallery"><span>Slide 2 of 4</span>
      <span class="sr-only">Slide 3 of 4; catering availability varies.</span>
      <span class="sr-only-note">Slide 4 of 4</span>
      <span class="sr-only">Seasonal pastry examples; selection changes weekly.</span>
      <img class="sr-only" alt="Illustrative pastry assortment" src="pastries.png"></div>
    <p>${instruction}</p><p class="sr-only">${instruction}; our staff can assist you.</p></main>`;
  const document = htmlDocument(html);
  assert.equal(document.headline, 'Our cafe');
  for (const expected of ['Slide 1 of 4', 'Slide 2 of 4', 'Slide 3 of 4; catering availability varies.',
    'Slide 4 of 4', 'Seasonal pastry examples; selection changes weekly.', instruction,
    `${instruction}; our staff can assist you.`]) assert.ok(document.text.includes(expected), expected);
  assert.equal(document.root.querySelector('img')?.getAttribute('alt'), 'Illustrative pastry assortment');
});

test('visible Home and accessibility-class lookalike placeholders are not deleted', () => {
  const document = htmlDocument('<main><h1>Home</h1><h2 class="sr-only-note">Homepage</h2><h2>Visit us</h2></main>');
  assert.equal(document.headline, 'Home');
  assert.match(document.text, /^# Home$/m);
  assert.match(document.text, /^## Homepage$/m);
});

test('accessible Home is retained if no eligible alternate heading exists and metadata does not invent one', () => {
  for (const extra of ['', '<h2 hidden>Inactive heading</h2>', '<h2 style="display:none">Inactive heading</h2>']) {
    const document = htmlDocument(`<title>Harbor Cafe</title><main><h1 class="sr-only">Home</h1><p>Meaningful business introduction.</p>${extra}</main>`);
    assert.match(document.text, /^# Home$/m);
    assert.match(document.text, /Meaningful business introduction\./);
    assert.equal(document.headline, '');
    assert.equal(document.title, 'Harbor Cafe');
  }
});

for (const tag of ['article', 'section', 'blockquote', 'code']) {
  test(`a nested ${tag} Home heading remains business or quoted evidence despite a visible main heading`, () => {
    const document = htmlDocument(`<main><h2>Films</h2><${tag}><h1 class="sr-only">Home</h1><p>A short film.</p></${tag}></main>`);
    assert.match(document.text, /^# Home$/m);
    assert.match(document.text, /A short film\./);
    assert.match(document.rawText, /^# Home$/m);
    assert.equal(document.headline, 'Films');
  });
}

test('a preformatted Home heading example remains literal source evidence', () => {
  const document = htmlDocument('<main><h2>Examples</h2><pre>&lt;h1 class="sr-only"&gt;Home&lt;/h1&gt;</pre></main>');
  assert.ok(document.text.includes('<h1 class="sr-only">Home</h1>'));
  assert.ok(document.rawText.includes('<h1 class="sr-only">Home</h1>'));
});

test('body-only Home remains evidence even when another visible H1 can supply metadata', () => {
  const document = htmlDocument('<body><h1 class="sr-only">Home</h1><h1>Harbor Films</h1><p>A neighborhood film archive.</p></body>');
  assert.match(document.text, /^# Home$/m);
  assert.match(document.rawText, /^# Home$/m);
  assert.equal(document.headline, 'Harbor Films');
});

test('a visible heading in another main region does not authorize deleting the first main Home', () => {
  const document = htmlDocument('<main><h1 class="sr-only">Home</h1><p>A short film.</p></main><main><h1>Harbor Films</h1></main>');
  assert.match(document.text, /^# Home$/m);
  assert.match(document.rawText, /^# Home$/m);
  assert.match(document.text, /A short film\./);
});

for (const [kind, before] of [
  ['outer header', '<header><h1>Outer banner</h1></header>'],
  ['navigation', '<nav><h1>Navigation title</h1></nav>'],
  ['form', '<form><h1>Newsletter form</h1></form>'],
  ['template', '<template><h1>Unrendered template</h1></template>'],
] as const) {
  test(`heading metadata ignores ${kind} H1 before main content`, () => {
    assert.equal(htmlDocument(`${before}<main><h1>Our cafe</h1><p>Seasonal menu.</p></main>`).headline, 'Our cafe');
  });
}

for (const [kind, attributes, retained] of [
  ['hidden attribute', 'hidden', false],
  ['aria-hidden attribute', 'aria-hidden="true"', false],
  ['inline display', 'style="display:none"', true],
  ['inline visibility', 'style="visibility:hidden"', true],
  ['accessible-only ancestor', 'class="sr-only"', true],
] as const) {
  test(`heading metadata ignores ${kind} while preserving its existing evidence distinction`, () => {
    const document = htmlDocument(`<main><div ${attributes}><h1>Advance booking is required.</h1></div><h2>Visit the cafe</h2></main>`);
    assert.equal(document.headline, 'Visit the cafe');
    assert.equal(document.text.includes('Advance booking is required.'), retained);
    assert.ok(document.rawText.includes('Advance booking is required.'));
  });
}

test('ordinary style declarations and class lookalikes do not hide heading metadata', () => {
  for (const attributes of ['class="hidden-offer"', 'class="sr-only-note"', 'style="--display:none; color:red"', 'style="display:inline; visibility:visible"']) {
    assert.equal(htmlDocument(`<main><h1 ${attributes}>Seasonal cafe</h1><h2>Visit us</h2></main>`).headline, 'Seasonal cafe');
  }
});

test('main H1 takes precedence over earlier subsection headings and preserves main section headers', () => {
  const document = htmlDocument('<main><h2>Seasonal notice</h2><header><h1>Visit the cafe</h1><p>Availability requires confirmation.</p></header></main>');
  assert.equal(document.headline, 'Visit the cafe');
  assert.match(document.text, /Availability requires confirmation\./);
});

test('main-role regions provide fallback headings in document order', () => {
  assert.equal(htmlDocument('<div role="main"><h3>Seasonal cafe</h3><h2>Locations</h2></div>').headline, 'Seasonal cafe');
});

test('synthetic footer headings, navigation and aside headings cannot become metadata fallbacks', () => {
  const document = htmlDocument('<title>Harbor access</title><main><aside><h1>Related articles</h1></aside><p>Plan your visit.</p></main><footer><p>Step-free access uses the east door.</p></footer>');
  assert.equal(document.headline, '');
  assert.match(document.text, /# Website footer/);
  assert.match(document.text, /Step-free access uses the east door\./);
  assert.equal(document.title, 'Harbor access');
});

test('body-only fallback accepts a content H1 but does not choose lower-level or aside headings', () => {
  assert.equal(htmlDocument('<body><aside><h1>Related articles</h1></aside><h1>Visit us</h1><p>Seasonal pastries.</p></body>').headline, 'Visit us');
  assert.equal(htmlDocument('<body><aside><h2>Related articles</h2></aside><h2>Locations</h2><p>Seasonal pastries.</p></body>').headline, '');
});

test('heading metadata separates line breaks and preserves decoded text', () => {
  assert.equal(htmlDocument('<main><h1>Food<br>for <em>everyday</em> &amp; celebrations</h1></main>').headline, 'Food for everyday & celebrations');
});

test('closed native disclosures and near-duplicate location policies retain complete source evidence', () => {
  const document = htmlDocument('<main><h1>Policies</h1><details><summary>Cancellation policy</summary><p>Cancel at least 72 hours before the event.</p></details><p>Henry pickup: 8am–4pm.</p><p>Degraw pickup: 8am–5pm.</p></main>');
  for (const expected of ['Cancellation policy', 'Cancel at least 72 hours before the event.', 'Henry pickup: 8am–4pm.', 'Degraw pickup: 8am–5pm.']) {
    assert.ok(document.text.includes(expected), expected);
    assert.ok(document.rawText.includes(expected), expected);
  }
});

test('controlled hidden accordion remains an explicit raw-only existing limitation', () => {
  const document = htmlDocument('<main><h1>FAQ</h1><button aria-expanded="false" aria-controls="refunds">Refund policy?</button><div id="refunds" hidden>Refunds require 72 hours notice.</div><p>Contact us for details.</p></main>');
  for (const phrase of ['Refund policy?', 'Refunds require 72 hours notice.']) {
    assert.ok(document.rawText.includes(phrase));
    assert.ok(!document.text.includes(phrase));
  }
});

test('unstripped conversion does not acquire website-only chrome rules', () => {
  const text = htmlDocument(fixture, false).text;
  for (const phrase of ['# Home', instruction, 'Slide 1 of 7', intro]) assert.ok(text.includes(phrase), phrase);
});
