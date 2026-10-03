// Copy to tests/website-visible-headline.test.ts after integrating the companion consumer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWebsitePage, designWebsite } from '../lib/website-import';

test('the website importer and design use visible main source heading instead of hidden Home', () => {
  const page = extractWebsitePage('<title>Harbor Cafe | Our neighborhood</title><main><h1 class="sr-only">Home</h1><h3>Food for the everyday.</h3><h2>Our cafes</h2><p>Seasonal pastries, subject to availability.</p></main>', 'https://synthetic.example/');
  assert.equal(page.headline, 'Food for the everyday.');
  assert.equal(designWebsite(page, 1).headline, 'Food for the everyday.');
  assert.equal(page.title, 'Harbor Cafe | Our neighborhood');
  assert.ok(page.rawText?.includes('# Home'));
  assert.ok(page.text.includes('Seasonal pastries, subject to availability.'));
});

test('the website importer preserves title then hostname fallback when visible headings are absent', () => {
  const text = '<main><h1 class="sr-only">Home</h1><p>Seasonal pastries, subject to availability.</p></main>';
  assert.equal(extractWebsitePage(`<title>Harbor Cafe</title>${text}`, 'https://synthetic.example/').headline, 'Harbor Cafe');
  assert.equal(extractWebsitePage(text, 'https://synthetic.example/').headline, 'synthetic.example');
});
