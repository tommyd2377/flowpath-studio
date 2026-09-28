import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RichAnswer } from '@thevoice/platform-ui/answer';
import { CatalogDiagram } from '@thevoice/platform-ui/diagram';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import classes from '../../fixtures/catalogs/classes.json';

test('rich answers render tables, ordered and nested lists, and code as semantic HTML', () => {
  const html = renderToStaticMarkup(createElement(RichAnswer, { text: '## Compare\n\n| Item | Price |\n| :--- | ---: |\n| Clay | $60 |\n\n3. Choose a date\n   - Bring a notebook\n4. Save it\n\n```js\n<script>neverExecute()</script>\n```' }));
  assert.match(html, /role="region" aria-label="Answer table" tabindex="0"/);
  assert.match(html, /<th scope="col" style="text-align:right">Price<\/th>/);
  assert.match(html, /<ol start="3">/); assert.match(html, /<ul>\s*<li>Bring a notebook/);
  assert.match(html, /&lt;script&gt;neverExecute\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|<iframe/);
});

test('incomplete streaming Markdown stays readable without loading code, HTML or arbitrary images', () => {
  const html = renderToStaticMarkup(createElement(RichAnswer, { streaming: true, text: 'A **partial answer\n\n![remote image](https://example.com/pixel.png)\n\n<iframe src="https://example.com/embed"></iframe>' }));
  assert.match(html, /partial answer/); assert.match(html, /remote image/);
  assert.doesNotMatch(html, /<img|<iframe|rel="preload"|src="https/);
});

test('verified evidence uses a compact native disclosure; unsafe and invented citations are not linked', () => {
  const text = 'Materials included. [ref]', source = { title: '<script>Guide</script>', url: 'https://example.com/guide' };
  const html = renderToStaticMarkup(createElement(RichAnswer, { text, sources: [source, { title: 'Private', url: 'https://localhost/source' }], citations: [{ ...source, start: 20, end: text.length }] }));
  assert.match(html, /<details class="platform-answer-sources"><summary>/);
  assert.match(html, /<span>1 source<\/span>/); assert.match(html, /&lt;script&gt;Guide&lt;\/script&gt;/);
  assert.match(html, /rel="noopener noreferrer">1<\/a>/);
  assert.doesNotMatch(html, /<script|localhost|<details[^>]*open/);
});

test('relationship list is server-rendered without loading the interactive canvas', () => {
  const html = renderToStaticMarkup(createElement(CatalogDiagram, { catalog: validateCatalog(classes), rootId: 'class-wheel' }));
  assert.match(html, /aria-label="Published relationships"/); assert.match(html, /Requires introductory experience such as/);
  assert.doesNotMatch(html, /react-flow__|<canvas/);
});
