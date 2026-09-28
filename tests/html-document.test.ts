import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlDocument } from '../lib/html-document';
import { extractWebsitePage, importWebsitePages } from '../lib/website-import';
import { websiteOfferings } from '../lib/website-structure';
import { unlinkedSourceProvenance } from '../lib/source-extractors';
import type { WebsiteTransport } from '../lib/website-fetch';

const html = `<html><head><title>Harbor Workshop</title></head><body>
  <header><nav>Home About Services</nav></header>
  <main><h1>Harbor Workshop</h1><p>Our neighborhood workshop offers classes and studio access.</p>
  <h2>Hours</h2><p>Monday–Thursday: 10am–6pm</p><h2>Classes</h2><h3>Intro to ceramics</h3><p>Session: $40</p><p>Materials included.</p></main>
  <footer><nav><a href="/about">About us</a><a href="/classes">Browse classes</a></nav>
  <div><h3>Quick links</h3><a href="/privacy">Privacy</a><a href="https://instagram.com/harbor">Instagram</a></div>
  <h3>Harbor location</h3><address><a href="https://maps.example/harbor">12 Harbor Road</a></address>
  <p><a href="tel:2125550100">212-555-0100</a> · <a href="mailto:hello@harbor.example">hello@harbor.example</a></p>
  <h3>Hours</h3><p>Monday–Thursday: 10am–8pm</p><p>Sunday: Closed</p>
  <p>Shared equipment may contain latex. Tell the instructor about allergies.</p>
  <p>For copyright questions, contact our studio manager.</p>
  <p>Check <a href="https://instagram.com/harbor">Instagram</a> for temporary closures.</p>
  <p>© 2026 Harbor Workshop. All rights reserved.</p></footer></body></html>`;

test('website semantic text retains footer facts and conflicting hours while removing footer navigation noise', () => {
  const document = htmlDocument(html);
  for (const text of ['Monday–Thursday: 10am–6pm', 'Monday–Thursday: 10am–8pm', 'Sunday: Closed', '12 Harbor Road', '212-555-0100', 'hello@harbor.example', 'Shared equipment may contain latex.', 'For copyright questions, contact our studio manager.', 'Check Instagram for temporary closures.']) assert.ok(document.text.includes(text), text);
  for (const text of ['Home About Services', 'About us', 'Browse classes', 'Privacy', 'Quick links', 'All rights reserved']) assert.ok(!document.text.includes(text), text);
  assert.equal(document.text.match(/Instagram/g)?.length, 1, 'bare social links are omitted; substantive prose is retained');
  assert.ok(document.rawText.includes('All rights reserved'), 'raw evidence remains available');
  assert.equal(document.contact, '2125550100 · hello@harbor.example');
  assert.equal(document.hours, 'Monday–Thursday: 10am–8pm; Sunday: Closed');
});

test('footer evidence reaches the exact imported source text without becoming the last offering description', async () => {
  const page = extractWebsitePage(html, 'https://harbor.example/');
  const offerings = websiteOfferings([page], { strict: true });
  assert.equal(offerings.entities.length, 1);
  assert.match(offerings.entities[0].summary, /Materials included/);
  assert.doesNotMatch(offerings.entities[0].summary, /latex|Closed|Website footer/);
  assert.ok(page.blocks?.some(block => block.text.includes('Shared equipment may contain latex.')));
  const io: WebsiteTransport = { resolve: async () => [{ address: '93.184.216.34', family: 4 }], connect: async url => ({ remoteAddress: '93.184.216.34', status: 200, contentType: url.pathname === '/robots.txt' ? 'text/plain' : 'text/html', bytes: Buffer.from(url.pathname === '/robots.txt' ? '' : html) }) };
  const imported = await importWebsitePages('https://harbor.example/', ['https://harbor.example/'], io);
  assert.equal(imported.text, `[Webpage: ${page.url}]\n${page.text}`);
  const footerLine = page.text.split('\n').findIndex(line => line.startsWith('Shared equipment'));
  assert.ok(footerLine > 0);
  assert.equal(imported.pages[0].text.split('\n')[footerLine], 'Shared equipment may contain latex. Tell the instructor about allergies.');
  const provenance = unlinkedSourceProvenance({ format: 'html', text: imported.text });
  const anchor = provenance.anchors.find(anchor => anchor.excerpt.includes('Shared equipment may contain latex.'));
  assert.ok(anchor);
  assert.ok(anchor.lineStart! <= footerLine + 2 && anchor.lineEnd! >= footerLine + 2);
  assert.equal(imported.text.slice(anchor.characterStart, anchor.characterEnd), anchor.excerpt);
});

test('footer variants retain nested information once and source text cannot become markup', () => {
  const document = htmlDocument('<main><h1>Studio</h1></main><div data-elementor-type="footer"><section role="contentinfo"><h2>Access</h2><p>Step-free entry at the east door.</p><p>Printed example: &lt;script&gt;bad()&lt;/script&gt;</p><p hidden>Private hidden copy</p></section></div>');
  assert.equal(document.text.match(/Step-free/g)?.length, 1);
  assert.equal(document.text.match(/# Website footer/g)?.length, 1);
  assert.ok(document.text.includes('Printed example: <script>bad()</script>'));
  assert.ok(!document.text.includes('Private hidden copy'));
  assert.equal(document.root.querySelectorAll('script').length, 0);
  const unstripped = htmlDocument('<footer><nav>Navigation</nav><p>Copyright sample</p></footer>', false);
  assert.equal(unstripped.text, 'Navigation\nCopyright sample');
});
