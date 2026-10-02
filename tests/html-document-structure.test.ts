import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlDocument } from '../lib/html-document';
import { htmlToText } from '../lib/source-adapters';
import { extractWebsitePage } from '../lib/website-import';

test('a main page header retains its title, complete introduction and conditions while outer banners and navigation are removed', () => {
  const html = `<!DOCTYPE html><html><head><title>Admissions information</title></head><body>
    <header class="site-header"><nav><a href="/">Home</a><a href="/login">Member login</a></nav><p>Global site banner</p></header>
    <div role="banner">Repeated campaign banner</div><div role="navigation"><a href="/menu">Global menu</a></div>
    <main class="main-wrapper"><header class="section_header new home v2">
      <p>ADMISSIONS</p><h1>The Admissions Process</h1><p>For inpatient intake, call 800-555-0101. Outpatient services use their separate clinic contacts.</p>
      <p>Transportation is discussed individually; a request does not confirm availability.</p>
    </header><section><h2>Accommodation requests</h2><p>Please tell the intake coordinator about interpretation needs in advance.</p></section></main>
  </body></html>`;
  const page = extractWebsitePage(html, 'https://synthetic.example/admissions');
  assert.match(page.text, /# The Admissions Process/);
  assert.match(page.text, /For inpatient intake, call 800-555-0101\. Outpatient services use their separate clinic contacts\./);
  assert.match(page.text, /Transportation is discussed individually; a request does not confirm availability\./);
  assert.match(page.text, /interpretation needs in advance/);
  assert.doesNotMatch(page.text, /DOCTYPE|Global site banner|Repeated campaign banner|Global menu|Member login/);
  assert.ok(page.rawText?.includes('Global site banner'), 'raw private evidence still records the removed site chrome');
  assert.ok(page.blocks?.some(block => block.text.includes('a request does not confirm availability.')), 'the qualification reaches the canonical reading blocks');
});

test('article, section and main-role headers are content even without a main element', () => {
  for (const [open, close] of [['article', 'article'], ['section', 'section'], ['div role="main"', 'div']]) {
    const text = htmlDocument(`<body><${open}><header><h1>Terms</h1><p>Rates apply only after an individual assessment.</p></header><p>Full details remain available.</p></${close}></body>`).text;
    assert.match(text, /# Terms/);
    assert.match(text, /only after an individual assessment/);
    assert.match(text, /Full details remain available/);
  }
});

test('body-only documents keep their fallback content when no semantic main container exists', () => {
  const text = htmlDocument('<body><header><nav>Repeated navigation</nav></header><h1>Conditions</h1><p>Enrollment remains subject to confirmation.</p><p>The final exception applies on holidays.</p></body>').text;
  assert.match(text, /# Conditions/);
  assert.match(text, /subject to confirmation/);
  assert.match(text, /final exception applies on holidays/);
  assert.doesNotMatch(text, /Repeated navigation/);
});

test('document prologs are markup rather than readable text in both extraction paths', () => {
  for (const prolog of ['<!DOCTYPE html>', '\uFEFF \n<!-- document comment --><!dOcTyPe html>', '<?xml version="1.0"?><!DOCTYPE html>', '<!DOCTYPE html PUBLIC "example > identifier" "example.dtd">', '<!DOCTYPE html [<!ENTITY example "a > b">]>']) {
    const html = `${prolog}<html><body><p>Meaningful final qualification.</p></body></html>`;
    for (const text of [htmlDocument(html).text, htmlDocument(html).rawText, htmlToText(html)]) {
      assert.equal(text, 'Meaningful final qualification.');
    }
  }
  assert.equal(htmlToText('<!DOCTYPE html>', { allowEmpty: true }), '');
  assert.throws(() => htmlToText('<!DOCTYPE html>'), /did not contain readable text/);
});

test('literal declaration examples in readable content are preserved', () => {
  for (const content of ['<pre>&lt;!DOCTYPE html&gt;</pre>', '<pre><!DOCTYPE html></pre>', '<code>&lt;!DOCTYPE html&gt;</code>', '<code><!DOCTYPE html></code>', '&lt;!DOCTYPE html&gt;']) {
    assert.match(htmlDocument(`<!DOCTYPE html><body>${content}<p>This is an example.</p></body>`).text, /<!DOCTYPE html>/);
    assert.match(htmlToText(content), /<!DOCTYPE html>/);
  }
  assert.match(htmlDocument('Introductory prose. <!DOCTYPE html><p>Keep the ending.</p>').text, /Introductory prose\. <!DOCTYPE html>/, 'cleanup stops at the first content instead of globally deleting matching prose');
  assert.match(htmlDocument('<!DOCTYPE html malformed <p>Keep this entire paragraph.</p>').text, /Keep this entire paragraph\./, 'malformed prologs cannot consume subsequent body content');
});
