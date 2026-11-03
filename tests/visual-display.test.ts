import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { validateVisualDisplay, visualDisplayAction, type VisualDisplayConfiguration, type VisualDisplayState, VISUAL_CONFIGURATION_MAX_BYTES, VISUAL_IMAGE_MAX_BYTES } from '../lib/visual-display';
import { normalizeVisualDisplay } from '../lib/visual-display-images';
import { createVisualDisplaySession } from '../lib/visual-display-session';
import { createLiveTextSession, type LiveTextState } from '../lib/live-text-session';
import { canonicalCreationCandidate, creationContentDigest } from '../lib/creation-safety';
import { canonicalCreationReviewCandidate } from '../lib/creation-review-client';
import { voiceSessionConfig } from '../lib/voice-config';
import { sameWaveformVersion } from '../lib/paid-store';
import { MixedDisplayContent } from '../components/DisplayContent';

const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBykAAAAASUVORK5CYII=';
export const visuals: VisualDisplayConfiguration = { type: 'visual', version: 1, images: [
  { id: 'map', title: 'Town map', description: 'Creator describes a map with a square by the river.', text: 'A walk through town.', src },
  { id: 'portrait', title: 'Workshop', description: 'Creator describes a workshop.', text: '', src },
] };
const action = (name: string, imageId = '', text = '') => ({ action: name, imageId, text });

test('Visual Display validates exact shapes, unique IDs/titles, formats and total serialized size', () => {
  assert.deepEqual(validateVisualDisplay(undefined), { ok: true, value: null });
  assert.equal(validateVisualDisplay(visuals).ok, true);
  for (const bad of [
    { ...visuals, url: 'https://example.test' }, { ...visuals, version: 2 }, { ...visuals, images: Array(5).fill(visuals.images[0]) },
    { ...visuals, images: [visuals.images[0], visuals.images[0]] },
    ...['https://example.test/x.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAAA=', 'data:image/png;base64,' + 'A'.repeat(50_000)].map(src => ({ ...visuals, images: [{ ...visuals.images[0], src }] })),
    { ...visuals, images: [{ ...visuals.images[0], description: '' }] },
    { ...visuals, images: [{ ...visuals.images[0], text: 'x'.repeat(2001) }] },
  ]) assert.equal(validateVisualDisplay(bad).ok, false);
  const total = { ...visuals, images: Array.from({ length: 4 }, (_, i) => ({ ...visuals.images[0], id: String(i), title: String(i), src: 'data:image/png;base64,' + 'A'.repeat(43_688), text: '\ud800'.repeat(2000) })) };
  assert.ok(new TextEncoder().encode(JSON.stringify(total)).length > VISUAL_CONFIGURATION_MAX_BYTES);
  assert.equal(validateVisualDisplay(total).ok, false);
  assert.equal(visualDisplayAction({ ...action('show'), ownerUid: 'owner-b' }), null);
  assert.equal(visualDisplayAction(action('select', 'https://evil.test')), null);
  assert.equal(visualDisplayAction(action('show', 'map')), null);
  assert.equal(visualDisplayAction(action('next', '', 'invented')), null);
});

test('raster uploads decode fully, preserve aspect ratio, strip metadata and reject spoofing/oversize', async () => {
  const bytes = await sharp({ create: { width: 640, height: 320, channels: 3, background: '#2244aa' } }).withMetadata().png().toBuffer();
  const config = { ...visuals, images: [{ ...visuals.images[0], src: `data:image/png;base64,${bytes.toString('base64')}` }] };
  const normalized = await normalizeVisualDisplay(config);
  const image = normalized!.images[0];
  const metadata = await sharp(Buffer.from(image.src.split(',')[1], 'base64')).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 640); assert.equal(metadata.height, 320);
  assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
  assert.deepEqual(await normalizeVisualDisplay(normalized, normalized), normalized, 'unchanged normalized bytes are reused exactly');
  for (const source of [config.images[0].src.replace('image/png','image/jpeg'), 'data:image/png;base64,iVBORw0KGgo=', 'data:image/svg+xml;base64,PHN2Zy8+']) {
    await assert.rejects(normalizeVisualDisplay({ ...config, images: [{ ...image, src: source }] }));
  }
  const oversized = await sharp({ create: { width: 1025, height: 1, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(normalizeVisualDisplay({ ...config, images: [{ ...image, src: `data:image/png;base64,${oversized.toString('base64')}` }] }));
});

test('browser-compressed pictures stay bounded during review and save normalization', async () => {
  const width = 288, height = 216, pixels = Buffer.alloc(width * height * 3);
  let seed = 7;
  for (let i = 0; i < pixels.length; i++) {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    pixels[i] = seed >>> 24;
  }
  const bytes = await sharp(pixels, { raw: { width, height, channels: 3 } }).webp({ quality: 40 }).toBuffer();
  assert.ok(bytes.length <= VISUAL_IMAGE_MAX_BYTES, 'the browser-prepared upload fits');
  assert.ok((await sharp(bytes).webp({ quality: 80 }).toBuffer()).length > VISUAL_IMAGE_MAX_BYTES,
    'raising the encoding quality reproduces the server rejection');
  const config = { ...visuals, images: [{ ...visuals.images[0], src: `data:image/webp;base64,${bytes.toString('base64')}` }] };
  const reviewed = await normalizeVisualDisplay(config);
  assert.deepEqual(await normalizeVisualDisplay(config), reviewed, 'review and save produce the same exact content');
  const output = Buffer.from(reviewed!.images[0].src.split(',')[1], 'base64');
  assert.ok(output.length <= VISUAL_IMAGE_MAX_BYTES);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, width); assert.equal(metadata.height, height);
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
});

test('voice and local controls share deterministic selection, wrap, explanations and hide/reopen', () => {
  let state: VisualDisplayState | undefined;
  const session = createVisualDisplaySession(visuals, next => { state = next; });
  assert.equal(session.state().visible, false);
  assert.equal(session.execute(action('read')).status, 'read'); assert.equal(session.state().visible, false);
  session.execute(action('select', 'map')); assert.equal(state?.text, 'A walk through town.');
  session.execute(action('append_text', '', ' Added.')); assert.equal(state?.text, 'A walk through town. Added.');
  session.execute(action('hide')); assert.equal(state?.visible, false);
  session.execute(action('show')); assert.equal(state?.text, 'A walk through town. Added.');
  session.execute(action('next')); assert.equal(state?.imageId, 'portrait'); assert.equal(state?.text, '');
  session.execute(action('next')); assert.equal(state?.imageId, 'map');
  session.execute(action('previous')); assert.equal(state?.imageId, 'portrait');
  const before = session.state();
  assert.equal(session.execute(action('select', 'not-installed')).status, 'unknown_image'); assert.deepEqual(session.state(), before);
  assert.equal(session.execute(action('show'), { delegationId: 'old', isCurrent: () => false, signal: new AbortController().signal }).status, 'superseded');
  session.finish();
  assert.equal(session.execute(action('show'), { delegationId: 'ended', isCurrent: () => true, signal: new AbortController().signal }).status, 'superseded');
  session.reset(); assert.equal(session.state().imageId, null); assert.equal(session.state().visible, false);
});

test('shared dispatcher rejects partial/duplicate/stale visual calls and continues once without voice effects', () => {
  let state: LiveTextState | undefined;
  const sent: Record<string, unknown>[] = [];
  const session = createLiveTextSession({ visualDisplay: visuals, onChange: next => { state = next; }, send: e => sent.push(e) });
  const event = (e: object, d = 'visual') => session.event({ type: 'response.event', delegation_id: d, event: e });
  event({ type: 'response.created', response: { id: 'r1' } });
  const call = { type: 'response.output_item.done', response_id: 'r1', item: { type: 'function_call', name: 'update_visual_display', call_id: 'c1', arguments: JSON.stringify(action('select','map')) } };
  event({ type: 'response.function_call_arguments.delta', delta: '{"action":' }); assert.equal(state?.visual?.visible, false);
  event(call); event(call); event({ type: 'response.completed', response: { id: 'r1', status: 'completed' } });
  assert.equal(state?.visual?.imageId, 'map'); assert.equal(sent.filter(e => e.type === 'response.item.create').length, 1);
  assert.equal(sent.filter(e => e.type === 'response.create').length, 1);
  event({ type: 'response.created', response: { id: 'late' } }, 'late');
  session.action('hide');
  event({ ...call, response_id: 'late', item: { ...call.item, call_id: 'late_call' } }, 'late');
  assert.equal(state?.visual?.visible, false);
  assert.equal(JSON.parse((sent.at(-1)?.item as { output: string }).output).status, 'superseded');
  session.visualAction({ action: 'show', imageId: '', text: '' }); assert.equal(state?.visual?.visible, true);
  session.finish(); const count = sent.length; event(call); assert.equal(sent.length, count);
  session.action('hide'); session.visualAction({ action: 'show', imageId: '', text: '' }); assert.equal(state?.visual?.visible, true, 'retained local controls work after End');
  let fresh: LiveTextState | undefined;
  createLiveTextSession({ visualDisplay: visuals, workspace: session.workspace(), onChange: s => { fresh = s; }, send: () => {} });
  assert.equal(fresh?.visual?.visible, false); assert.equal(fresh?.visual?.requested, false, 'new voice call resets visual state without altering notes restart behavior');
  assert.equal(sent.some(e => e.type === 'session.close'), false);
});

test('Visual Display pauses dictation, preserves notes/sources and invalidates delayed retrieval display', async () => {
  let resolve!: (v: unknown) => void, state: LiveTextState | undefined;
  const session = createLiveTextSession({ visualDisplay: visuals, searchKnowledge: () => new Promise(r => { resolve = r; }), onChange: s => { state = s; }, send: () => {} });
  session.event({ type: 'session.input_transcript.delta', delta: 'Start writing. Keep notes.', start_ms: 0, end_ms: 100 });
  session.visualAction({ action: 'select', imageId: 'map', text: '' });
  assert.equal(state?.writing, false); assert.equal(state?.visible, false); assert.equal(state?.text, 'Keep notes.');
  session.display('text'); assert.equal(state?.visual?.visible, false); assert.equal(state?.text, 'Keep notes.');
  const event = (e: object) => session.event({ type: 'response.event', delegation_id: 'search', event: e });
  event({ type: 'response.created', response: { id: 'search' } });
  event({ type: 'response.output_item.done', response_id: 'search', item: { type: 'function_call', name: 'search_waveform_knowledge', call_id: 'search_call', arguments: JSON.stringify({ query: 'topic', display: true }) } });
  session.visualAction({ action: 'show', imageId: '', text: '' }); session.action('hide');
  resolve({ revision: 1, passages: [{ id: 'source_1', documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', filename: 'Synthetic.txt', quote: 'Late source.' }] });
  await new Promise(r => setImmediate(r)); assert.equal(state?.visible, false); assert.equal(state?.visual?.visible, false);
  session.display('text'); assert.equal(state?.text, 'Keep notes.');
});

test('visual bytes/captions/text enter exact digest and client key, while absent legacy digests are identical', () => {
  const base = { name: 'Guide', initialPrompt: 'An original guide.' };
  assert.equal(creationContentDigest(base), creationContentDigest({ ...base, visualDisplay: null }));
  const candidate = { ...base, visualDisplay: visuals };
  assert.deepEqual(canonicalCreationReviewCandidate(candidate)?.candidate, canonicalCreationCandidate(candidate));
  const original = creationContentDigest(candidate);
  for (const change of [{ text: 'changed' }, { description: 'changed' }, { title: 'changed' }, { src: visuals.images[0].src.replace('png','jpeg') }]) {
    const changed = { ...candidate, visualDisplay: { ...visuals, images: [{ ...visuals.images[0], ...change }, visuals.images[1]] } };
    assert.notEqual(creationContentDigest(changed), original);
    assert.notEqual(canonicalCreationReviewCandidate(changed)?.key, canonicalCreationReviewCandidate(candidate)?.key);
  }
  const wave = { ...candidate, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', voice: 'marin' as const, accentColor: '#3a66ff', profilePhoto: null, updatedAt: '2026-10-30T12:00:00Z' };
  assert.equal(sameWaveformVersion(wave, { ...wave, visualDisplay: null }), false);
  const reordered = { version: 1 as const, images: visuals.images.map(({ text, src, description, title, id }) => ({ text, src, description, title, id })), type: 'visual' as const };
  assert.equal(sameWaveformVersion(wave, { ...wave, visualDisplay: reordered }), true);
});

test('only installed visual capability gets the registered tool and description-only voice catalogue', () => {
  const base = { name: 'Guide', initialPrompt: 'Be concise.' };
  assert.equal(voiceSessionConfig(base).delegation.responses.tools.length, 0);
  const config = voiceSessionConfig({ ...base, visualDisplay: visuals });
  assert.deepEqual(config.delegation.responses.tools.map(t => t.name), ['update_visual_display']);
  assert.equal(config.delegation.responses.model, 'gpt-6-luna');
  assert.equal(JSON.stringify(config).includes(src), false);
  assert.match(config.instructions, /voice does not see these images/);
  assert.equal(config.delegation.responses.parallel_tool_calls, false);
});

test('mixed content uses safe text renderer and static raster without external HTML/media', () => {
  const html = renderToStaticMarkup(createElement(MixedDisplayContent, { image: { ...visuals.images[0], type: 'image' }, text: { type: 'text', text: '<script>attack()</script> **Explanation** ![external](https://evil.test/a.png)' } }));
  assert.equal(html.includes('<script>'), false); assert.equal(html.includes('src="https://evil.test'), false);
  assert.match(html, /display-mixed/); assert.match(html, /Town|map with a square/);
});
