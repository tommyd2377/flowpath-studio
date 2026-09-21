import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AssistantAnswer from '../../components/AssistantAnswer';

const render = (text: string) => renderToStaticMarkup(createElement(AssistantAnswer, { text }));

test('synthesized answers render concise source links while preserving prose formatting', () => {
  const html = render('## Conditions\n\n**18°C**, for the sealed example only. [Preservation reference](https://example.com/reference_(sealed)?format=full#conditions)\n\n- First condition\n- Read [**the source**](https://example.com/source).');
  assert.ok(html.includes('<h3>Conditions</h3>'));
  assert.ok(html.includes('<strong>18°C</strong>'));
  assert.ok(html.includes('<a href="https://example.com/reference_(sealed)?format=full#conditions" target="_blank" rel="noopener noreferrer">Preservation reference</a>'));
  assert.ok(html.includes('<ul><li>First condition</li><li>Read <a href="https://example.com/source" target="_blank" rel="noopener noreferrer"><strong>the source</strong></a>.</li></ul>'));
  assert.ok(html.includes('for the sealed example only.'));
});

test('answer citations reject script, credential, private-host and unsupported URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,unsafe', 'file:///private/example', 'http://example.com/source',
    'https://localhost/source', 'https://127.0.0.1/source', 'https://10.0.0.2/source', 'https://[::1]/source',
    'https://machine.local/source', 'https://service.internal/source', 'https://user:password@example.com/source',
    'https://example.com:8443/source', '//example.com/source']) {
    const html = render(`Read [source](${url}).`);
    assert.equal(html.includes('<a '), false, url);
    assert.ok(html.includes('Read [source]'), url);
  }
});

test('answer content remains escaped and image Markdown cannot load remote media', () => {
  const html = render('<script>alert(1)</script>\n\n![image](https://example.com/image.jpg)\n\n[<img src=x onerror=alert(1)>](https://example.com/source)');
  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('<img'), false);
  assert.ok(html.includes('![image](https://example.com/image.jpg)'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;</a>'));
});
