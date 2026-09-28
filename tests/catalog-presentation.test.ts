import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { defaultPresentation } from '@thevoice/platform-ui/catalog';
import { initialInteraction } from '@thevoice/platform-ui/interaction';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import { CATALOG_OUTPUT_LIMIT, catalogPresentationInstructions, catalogPresentationJsonSchema, parseCatalogPresentation, validateCatalogState } from '../lib/catalog-presentation';
import { parseVisitorText, visitorTextReply, visitorVoiceReply } from '../lib/visitor-provider';
import { sampleContent } from '../lib/site-model';
import { semanticFixture } from '../fixtures/semantic-knowledge/graph';

const catalog = () => validateCatalog(JSON.parse(readFileSync(new URL('../fixtures/catalogs/tequila.json', import.meta.url), 'utf8')));
const envelope = (text: string) => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] });

test('provider schema marks every field required with null for optional references', () => {
  const schema = catalogPresentationJsonSchema(catalog());
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const current = node as Record<string, unknown>;
    if (current.type === 'object') {
      assert.equal(current.additionalProperties, false);
      assert.deepEqual(new Set(current.required as string[]), new Set(Object.keys(current.properties as object)));
    }
    Object.values(current).forEach(walk);
  };
  walk(schema);
  assert.ok(JSON.stringify(schema).includes('example-tequila-v1'));
  assert.ok(!JSON.stringify(schema).includes('url'));
});

test('provider output normalizes nullable optionals while rejecting fabricated fields, stale plans and unsupported mixed envelopes', () => {
  const value = catalog();
  const plan = defaultPresentation(value);
  const nullable = { ...plan, components: plan.components.map(component => ({ ...component, collectionId: null, capabilityIds: null })), transition: { type: 'none', targetComponentId: null } };
  assert.deepEqual(parseCatalogPresentation(JSON.stringify({ status: 'ready', plan: nullable }), value), { status: 'ready', catalogPlan: plan });
  assert.deepEqual(parseCatalogPresentation('{"status":"unavailable","plan":null}', value), { status: 'unavailable' });
  assert.throws(() => parseCatalogPresentation(JSON.stringify({ status: 'unavailable', plan }), value));
  assert.throws(() => parseCatalogPresentation(JSON.stringify({ status: 'ready', plan: null }), value));
  assert.throws(() => parseCatalogPresentation(JSON.stringify({ status: 'ready', plan: { ...plan, snapshotId: 'old' } }), value));
  assert.throws(() => parseCatalogPresentation(JSON.stringify({ status: 'ready', plan, url: 'https://example.com' }), value));
  assert.throws(() => parseCatalogPresentation(' '.repeat(CATALOG_OUTPUT_LIMIT + 1), value));
});

test('visitor context preserves shortlist and focused items outside filters while rejecting invalid references', () => {
  const value = catalog();
  const state = initialInteraction(value);
  state.entityIds.reverse();
  assert.deepEqual(validateCatalogState(state, value).entityIds, state.entityIds);
  assert.throws(() => validateCatalogState({ ...state, snapshotId: 'old' }, value), /changed/);
  assert.throws(() => validateCatalogState({ ...state, selectedIds: ['not-published'] }, value));
  assert.throws(() => validateCatalogState({ ...state, selectedIds: ['agave-blanco', 'agave-blanco'] }, value));
  const filtered = { ...state, filters: [{ attributeId: 'price', operator: 'lte', value: 50 }] };
  assert.deepEqual(validateCatalogState(filtered, value).entityIds, state.entityIds);
  assert.equal(validateCatalogState({ ...filtered, focusedId: state.entityIds[0], entityIds: [state.entityIds[0]] }, value).focusedId, state.entityIds[0]);
  const media: MediaLibrary = { schemaVersion: 1, id: 'media-state', assets: [{ id: 'published-photo', width: 1, height: 1, caption: '', alt: 'Published photo' }], albums: [], associations: [] };
  const focusedPhoto = { ...state, focusedRef: { kind: 'photo' as const, id: 'published-photo' }, focusOrigin: { reference: { kind: 'photo' as const, id: 'published-photo' }, surface: 'gallery' as const, focusKey: 'photo:published-photo', scrollTop: 12 } };
  assert.equal(validateCatalogState(focusedPhoto, value, media).focusedRef?.id, 'published-photo');
  assert.throws(() => validateCatalogState({ ...focusedPhoto, focusedRef: { kind: 'photo', id: 'draft-photo' } }, value, media));
  assert.throws(() => validateCatalogState({ ...focusedPhoto, focusOrigin: { ...focusedPhoto.focusOrigin, surface: 'collection' } }, value, media));
  assert.throws(() => validateCatalogState({ ...state, filters: [{ attributeId: 'missing', operator: 'lte', value: 50 }] }, value));
  const instructions = catalogPresentationInstructions(value, { history: [], catalogState: state });
  assert.ok(instructions.includes('untrusted reference data'));
  assert.ok(instructions.includes('Empty collection entityIds'));
  assert.ok(instructions.includes('visual equivalent of opening its card'));
});

test('Responses envelope rejects incomplete, refusal, extra tools and oversized split text', () => {
  assert.equal(parseVisitorText(envelope('valid')), 'valid');
  assert.throws(() => parseVisitorText({ ...envelope('valid'), status: 'incomplete' }));
  assert.throws(() => parseVisitorText({ status: 'completed', output: [{ type: 'function_call' }] }));
  assert.throws(() => parseVisitorText({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'No' }] }] }));
  assert.throws(() => parseVisitorText(envelope('x'.repeat(4001))));
  assert.equal(parseVisitorText(envelope('x'.repeat(5000)), CATALOG_OUTPUT_LIMIT).length, 5000);
});

test('text adapter sends exactly one mocked request, uses semantic schema and refuses unsupported output without retry', async () => {
  const value = catalog();
  const plan = defaultPresentation(value);
  const environment = process.env;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let unavailable = false;
  // Isolated fake process environment: no configured secret value is read or sent.
  process.env = { NODE_ENV: 'test', OPENAI_API_KEY: 'offline-fixture-placeholder' };
  globalThis.fetch = async (_input, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'gpt-6-astra'); assert.deepEqual(body.reasoning, { effort: 'high' }); assert.equal(body.max_output_tokens, 8192);
    assert.equal(body.store, false);
    assert.equal(body.text.format.name, 'catalog_presentation');
    assert.equal(body.text.format.strict, true);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer offline-fixture-placeholder');
    return Response.json(envelope(JSON.stringify(unavailable ? { status: 'unavailable', plan: null } : { status: 'ready', plan })));
  };
  try {
    const request = { requestId: '11111111-1111-4111-8111-111111111111', kind: 'chat' as const, text: 'Show the catalog', history: [], catalogState: initialInteraction(value) };
    const result = await visitorTextReply(sampleContent('photographer'), request, new AbortController().signal, value);
    assert.deepEqual(result.catalogPlan, plan);
    assert.equal(calls, 1);
    unavailable = true;
    await assert.rejects(visitorTextReply(sampleContent('photographer'), request, new AbortController().signal, value), /not supported/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; process.env = environment; }
});

test('an already cancelled voice request never opens a provider session', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(visitorVoiceReply(sampleContent('photographer'), { requestId: '11111111-1111-4111-8111-111111111111', kind: 'voice', audio: '', history: [] }, controller.signal, catalog()), /cancelled/);
});

test('the actual visitor text path answers a singleton address from bounded published facts using one mocked plan', async () => {
  const environment = process.env; const originalFetch = globalThis.fetch; let calls = 0;
  process.env = { NODE_ENV: 'test', OPENAI_API_KEY: 'offline-fixture-placeholder' };
  const plan = { ...defaultPresentation(semanticFixture), components: [{ id: 'detail', type: 'detail' as const, variant: 'expanded' as const, entityIds: ['harbor'], attributeIds: [] }] };
  globalThis.fetch = async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body));
    assert.ok(body.instructions.includes('12 Example Lane'));
    assert.ok(!body.instructions.includes('origins'));
    return Response.json(envelope(JSON.stringify({ status: 'ready', plan })));
  };
  try {
    const reply = await visitorTextReply(sampleContent('photographer'), { requestId: '11111111-1111-4111-8111-111111111111', kind: 'chat', text: 'What is Harbor Studio address?', history: [], catalogState: initialInteraction(semanticFixture) }, new AbortController().signal, semanticFixture);
    assert.match(reply.text, /Harbor Studio · Address: 12 Example Lane, Brooklyn, NY/);
    assert.equal(calls, 1);
  } finally { process.env = environment; globalThis.fetch = originalFetch; }
});
