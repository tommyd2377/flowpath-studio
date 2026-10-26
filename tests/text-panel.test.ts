import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TextPanel from '../components/TextPanel';
import { projectTextPanelConfiguration, textPanelResetKey, TEXT_PANEL_MAX_CHARACTERS,
  validateTextPanelConfiguration, type TextPanelConfiguration } from '../lib/text-panel';

const configuration = (text: string): TextPanelConfiguration => ({ type: 'text', version: 1, text });
const render = (text: TextPanelConfiguration | null, enabled = true, initiallyVisible = false) =>
  renderToStaticMarkup(createElement(TextPanel, { configuration: text, scopeKey: 'synthetic-owner:waveform-a', enabled, initiallyVisible }));

test('text configuration is optional, versioned and bounded without coercion or truncation', () => {
  assert.deepEqual(validateTextPanelConfiguration(undefined), { ok: true, value: null });
  assert.deepEqual(validateTextPanelConfiguration(null), { ok: true, value: null });
  const boundary = configuration('x'.repeat(TEXT_PANEL_MAX_CHARACTERS));
  assert.deepEqual(validateTextPanelConfiguration(boundary), { ok: true, value: boundary });
  assert.deepEqual(validateTextPanelConfiguration(configuration('x'.repeat(TEXT_PANEL_MAX_CHARACTERS + 1))), { ok: false, error: 'text_too_long' });
  assert.deepEqual(validateTextPanelConfiguration({ ...boundary, type: 'html' }), { ok: false, error: 'unsupported_type' });
  assert.deepEqual(validateTextPanelConfiguration({ ...boundary, version: 2 }), { ok: false, error: 'unsupported_version' });
  assert.deepEqual(validateTextPanelConfiguration({ ...boundary, text: 42 }), { ok: false, error: 'invalid_text' });
  assert.deepEqual(validateTextPanelConfiguration(configuration('')), { ok: true, value: configuration('') });
});

test('private fields, accessors and non-data shapes cannot enter the public text projection', () => {
  let accessed = false;
  const getter = { type: 'text', version: 1, get text() { accessed = true; throw new Error('private error'); } };
  for (const input of [[], 'text', 1, {}, { ...configuration('safe'), ownerUid: 'private-owner' },
    { ...configuration('safe'), initialPrompt: 'private-prompt' }, { ...configuration('safe'), [Symbol('hidden')]: 'private' },
    getter, Object.assign(Object.create({ private: 'inherited' }), configuration('safe')),
    new Proxy({}, { ownKeys() { throw new Error('private proxy'); } })]) {
    assert.equal(projectTextPanelConfiguration(input), null);
  }
  assert.equal(accessed, false);
  const original = configuration('First line\nSecond line');
  const projected = projectTextPanelConfiguration(original);
  assert.deepEqual(projected, original);
  assert.notEqual(projected, original);
  original.text = 'Changed elsewhere';
  assert.equal(projected?.text, 'First line\nSecond line');
});

test('creator content renders as escaped plain text with preserved line breaks and no executable nodes', () => {
  const malicious = '<script>window.attack = true</script>\n<img src="https://private.invalid" onerror="attack()">\n[link](javascript:attack()) **plain**';
  const html = render(configuration(malicious), true, true);
  assert.match(html, /&lt;script&gt;window.attack = true&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=&quot;https:\/\/private.invalid&quot; onerror=&quot;attack\(\)&quot;&gt;/);
  assert.match(html, /\[link\]\(javascript:attack\(\)\) \*\*plain\*\*/);
  assert.match(html, /white-space:pre-wrap/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.match(html, /Text from this waveform’s creator/);
  assert.doesNotMatch(html, /<script|<img|<iframe|<a\b|synthetic-owner/);
});

test('text stays out of the DOM until requested, and disabled or invalid content stays unavailable', () => {
  const privateText = configuration('Creator-approved text');
  const hidden = render(privateText);
  assert.match(hidden, /Show text/);
  assert.match(hidden, /aria-expanded="false"/);
  assert.match(hidden, /hidden=""/);
  assert.doesNotMatch(hidden, /Creator-approved text/);
  const shown = render(privateText, true, true);
  assert.match(shown, /Hide text/);
  assert.match(shown, /aria-expanded="true"/);
  assert.match(shown, /Creator-approved text/);
  const disabled = render(privateText, false, true);
  assert.match(disabled, /disabled=""/);
  assert.match(disabled, /Text is unavailable/);
  assert.doesNotMatch(disabled, /Creator-approved text/);
  assert.equal(render(null), '');
  assert.equal(render(configuration('x'.repeat(4_001))), '');
});

test('waveform, identity, creator edits and disable/re-enable transitions reset local reveal state', () => {
  const content = configuration('Approved version');
  const initial = textPanelResetKey('owner-a:waveform-a', content, true, false);
  assert.equal(textPanelResetKey('owner-a:waveform-a', { ...content }, true, false), initial);
  assert.notEqual(textPanelResetKey('owner-b:waveform-a', content, true, false), initial);
  assert.notEqual(textPanelResetKey('owner-a:waveform-b', content, true, false), initial);
  assert.notEqual(textPanelResetKey('owner-a:waveform-a', configuration('New approved version'), true, false), initial);
  assert.notEqual(textPanelResetKey('owner-a:waveform-a', content, false, false), initial);
  assert.notEqual(textPanelResetKey('owner-a:waveform-a', content, true, true), initial);
});
