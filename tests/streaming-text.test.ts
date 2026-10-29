import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StreamingText from '../components/StreamingText';
import LiveTextPanel from '../components/LiveTextPanel';

const render = (text: string) => renderToStaticMarkup(createElement(StreamingText, { text }));
const withoutAnimationSpans = (markup: string) => markup.replace(/<span[^>]*data-sd-animate[^>]*>/g, '').replace(/<\/span>/g, '');

test('Streamdown renders structured and incomplete streamed Markdown without extra controls', () => {
  const markup = render('# Franklin\n\n**Useful inventions**\n\n- Bifocals\n- Lightning rods\n\n| Project | Purpose |\n| --- | --- |\n| Library | Reading |');
  assert.match(markup, /data-streamdown="heading-1"/);
  assert.match(withoutAnimationSpans(markup), /<strong(?:\s[^>]+)?>Useful inventions<\/strong>/);
  assert.match(withoutAnimationSpans(markup), /<li[^>]*>Bifocals<\/li>/);
  assert.match(markup, /<table/);
  assert.doesNotMatch(markup, /<button|<a\b|<img\b/);
  const partial = render('An **unfinished phrase');
  assert.match(partial, /<strong(?:\s[^>]+)?>/);
  assert.match(partial, /data-sd-animate/);
  assert.doesNotMatch(partial, /\*\*unfinished/);
});

test('untrusted Markdown cannot execute HTML, navigate links or fetch embedded media', () => {
  const markup = render('<script>attack()</script>\n\n<img src="https://invalid.test/pixel" onerror="attack()">\n\n<iframe src="https://invalid.test/frame"></iframe>\n\n[unsafe](javascript:attack()) [external](https://invalid.test/) ![beacon](https://invalid.test/pixel)');
  assert.doesNotMatch(markup, /<(?:script|img|iframe|svg|a|video|audio)\b/i);
  assert.doesNotMatch(markup, /(?:src|href)="/i);
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /external/);
  const code = render('```html\n<script>example()</script>\n```');
  assert.match(code, /&lt;script&gt;example\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(code, /<script\b/);
});

test('Text Box and Knowledge share Streamdown while source quotations remain exact escaped text', () => {
  for (const display of ['text', 'knowledge'] as const) {
    const quote = '**verbatim** <img src="invalid">';
    const markup = renderToStaticMarkup(createElement(LiveTextPanel, { display, text: '**Readable result**', writing: false,
      canUndo: false, onStop() {}, onClear() {}, onUndo() {}, onHide() {}, sources: display === 'knowledge' ? [{
        id: 'source_1', documentId: '00000000-0000-4000-8000-000000000001', filename: 'synthetic.txt', quote,
      }] : [] }));
    assert.match(markup, /class="[^"]*streaming-text/);
    assert.match(withoutAnimationSpans(markup), /<strong(?:\s[^>]+)?>Readable result<\/strong>/);
    if (display === 'knowledge') {
      assert.match(markup, /<blockquote>\*\*verbatim\*\* &lt;img src=&quot;invalid&quot;&gt;<\/blockquote>/);
      assert.doesNotMatch(markup, /Jump to latest/);
    }
  }
});
