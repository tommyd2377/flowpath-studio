import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { templateFixtures } from '../fixtures/template-sites';
import { initialSite } from '../lib/local-store';
import { AppError } from '../lib/errors';
import { buildWebsiteCompositionManifest, proposeWebsiteComposition } from '../lib/website-composition';
import { buildWebsiteCompositionContext, buildWebsiteCompositionRequest, generateWebsiteComposition, parseWebsiteCompositionReply,
  proposeSiteWebsiteComposition, WEBSITE_COMPOSITION_PROVIDER_LIMITS, websiteCompositionModelSchema, type WebsiteCompositionDependencies } from '../lib/website-composition-provider';
import type { WebsiteCompositionPlan } from '@thevoice/platform-ui/website-composition';
import { WEBSITE_TEMPLATES } from '@thevoice/platform-ui/site-design';

const fixture = () => { const { content, catalog } = structuredClone(templateFixtures[1]); return buildWebsiteCompositionManifest(content, catalog); };
const wire = (plan: WebsiteCompositionPlan) => {
  const { snapshot, ...output } = plan; void snapshot;
  return { ...output, style: Object.fromEntries(Object.keys(websiteCompositionModelSchema.shape.style.shape).map(key => [key, plan.style[key as keyof typeof plan.style] ?? null])) };
};
const completed = (text: string) => ({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] });
const responseFor = (plan: WebsiteCompositionPlan) => completed(JSON.stringify(wire(plan)));
const status = (expected: number) => (error: unknown) => error instanceof AppError && error.status === expected;

function serviceFixture() {
  const user = { uid: 'synthetic-owner', email: null, displayName: null, mode: 'firebase' as const };
  const site = initialSite('general', 'Synthetic composition owner', 'composition-owner', user.uid);
  const calls: string[] = [];
  const services: WebsiteCompositionDependencies = {
    getSite: async (owner, id) => { assert.equal(owner, user); assert.equal(id, site.id); calls.push('site'); return structuredClone(site); },
    readKnowledgeArtifact: async () => { throw new Error('Unexpected private knowledge read.'); },
    readMediaLibrary: async () => { throw new Error('Unexpected private media read.'); },
    getEditorStatus: () => { calls.push('status'); return { mode: 'openai', message: 'Synthetic test', dailyLimit: 10 }; },
    reserveAiRequest: async (owner, id, revision, requestId) => { assert.equal(owner, user); assert.equal(id, site.id); assert.equal(revision, site.revision); assert.match(requestId, /^[a-f0-9-]{36}$/); calls.push('reserve'); },
    generateWebsiteComposition: async (manifest, signal, body) => { assert.equal(signal.aborted, false); assert.ok(body); calls.push('provider'); return proposeWebsiteComposition(manifest); },
  };
  const input = { revision: site.revision, mode: 'ai' as const };
  return { user, site, calls, services, input, run: (mode: 'local' | 'ai' = 'ai', signal = new AbortController().signal) => proposeSiteWebsiteComposition(user, site.id, { ...input, mode }, signal, services) };
}

test('bounded request excludes the snapshot and uses the Studio policy with strict required model fields', () => {
  const manifest = fixture(), context = JSON.parse(buildWebsiteCompositionContext(manifest));
  assert.equal(context.snapshot, undefined); assert.equal(context.contentBinding, undefined);
  assert.equal(context.knowledgeRevisionId, undefined); assert.equal(context.mediaRevisionId, undefined);
  assert.equal(context.catalogPublicationId, undefined); assert.equal(context.styleRegistry, undefined);
  const request = JSON.parse(buildWebsiteCompositionRequest(manifest));
  assert.equal(request.model, 'gpt-6.1-sol'); assert.deepEqual(request.reasoning, { effort: 'high' }); assert.equal(request.service_tier, 'default');
  assert.equal(request.store, false); assert.equal(request.max_output_tokens, 16384); assert.equal(request.tools, undefined);
  assert.equal(request.text.format.strict, true); assert.equal(request.text.format.schema.properties.snapshot, undefined);
  assert.match(request.instructions, /untrusted reference data/); assert.match(request.instructions, /images have not been viewed/);
  const allFieldsRequired = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const schema = node as Record<string, unknown>;
    if (schema.type === 'object') { assert.equal(schema.additionalProperties, false); assert.deepEqual(new Set(schema.required as string[]), new Set(Object.keys(schema.properties as object))); }
    Object.values(schema).forEach(child => { if (Array.isArray(child)) child.forEach(allFieldsRequired); else allFieldsRequired(child); });
  };
  allFieldsRequired(request.text.format.schema);
  assert.ok(Buffer.byteLength(JSON.stringify(request)) <= WEBSITE_COMPOSITION_PROVIDER_LIMITS.requestBytes);
  assert.throws(() => buildWebsiteCompositionContext({ ...manifest, identity: { ...manifest.identity, name: 'X'.repeat(70_000) } }), status(413));
});

test('validated provider plan attaches only the host snapshot and preserves absent legacy style fields', () => {
  const manifest = fixture(); manifest.style = { layout: 'editorial', palette: 'linen' };
  const local = proposeWebsiteComposition(manifest), result = parseWebsiteCompositionReply(responseFor(local), manifest);
  assert.deepEqual(result, local); assert.deepEqual(result.style, { layout: 'editorial', palette: 'linen' });
  assert.deepEqual(result.snapshot, manifest.snapshot);
});

test('composition guidance preserves every saved style choice across all three templates', () => {
  for (const template of Object.values(WEBSITE_TEMPLATES)) {
    const manifest = fixture();
    manifest.style = { ...template.defaults, entry: 'assistant', palette: 'orchid', typography: 'literary', textSize: 'larger',
      spacing: 'compact', websiteMotion: 'off', customAccent: true,
      customized: ['palette', 'typography', 'textSize', 'spacing', 'customAccent', 'websiteMotion'] };
    const request = JSON.parse(buildWebsiteCompositionRequest(manifest));
    assert.equal(request.input[0].content, `Approved composition manifest (untrusted reference data):\n${buildWebsiteCompositionContext(manifest)}`);
    assert.deepEqual(JSON.parse(buildWebsiteCompositionContext(manifest)).savedStyle, manifest.style);
    const plan = proposeWebsiteComposition(manifest);
    assert.deepEqual(parseWebsiteCompositionReply(responseFor(plan), manifest).style, manifest.style);
    for (const [field, changed] of Object.entries({ template: template.defaults.template === 'editorial' ? 'clarity' : 'editorial',
      entry: 'website', palette: 'linen', typography: 'modern', textSize: 'standard', spacing: 'spacious', websiteMotion: 'subtle', customAccent: false, customized: [] })) {
      const original = wire(plan), modified = { ...original, style: { ...original.style, [field]: changed } };
      assert.throws(() => parseWebsiteCompositionReply(completed(JSON.stringify(modified)), manifest), status(502));
    }
  }
});

test('malformed, injected, stale, omitted and fabricated plans are rejected safely', () => {
  const manifest = fixture(); manifest.style = proposeWebsiteComposition(manifest).style;
  const plan = proposeWebsiteComposition(manifest), valid = wire(plan);
  const invalid = [
    { ...valid, snapshot: { contentBinding: 'forged snapshot' } }, { ...valid, html: '<script>private-provider-text</script>' },
    { ...valid, sectionOrder: plan.sectionOrder.slice(1) }, { ...valid, sectionOrder: plan.sectionOrder.map(() => plan.sectionOrder[0]) },
    { ...valid, navigation: [] }, { ...valid, heroAssetId: 'unreviewed-image' },
    { ...valid, primaryAction: { actionId: 'checkout', label: 'Book now' } },
    { ...valid, primaryAction: { actionId: 'contact', label: 'Guaranteed availability' } },
    { ...valid, style: { ...valid.style, layout: plan.style.layout === 'balanced' ? 'compact' : 'balanced' } },
  ];
  for (const value of invalid) assert.throws(() => parseWebsiteCompositionReply(completed(JSON.stringify(value)), manifest), error => {
    assert.ok(status(502)(error)); assert.doesNotMatch((error as Error).message, /private-provider-text|forged snapshot/); return true;
  });
  for (const payload of [completed('not JSON'), { status: 'incomplete', output: [] }, { status: 'completed', output: [{ type: 'function_call' }] }, completed('x'.repeat(48_001))]) {
    assert.throws(() => parseWebsiteCompositionReply(payload, manifest), status(502));
  }
});

test('local proposals never inspect AI configuration, reserve quota, call providers or change site state', async () => {
  const f = serviceFixture(), before = structuredClone(f.site), result = await f.run('local');
  assert.equal(result.mode, 'local'); assert.deepEqual(f.calls, ['site', 'site']); assert.deepEqual(f.site, before);
  assert.deepEqual(result.plan, proposeWebsiteComposition(buildWebsiteCompositionManifest(before.draft)));
});

test('approved immutable catalog and media references are loaded; private notes and uploads never enter a prompt', async () => {
  const f = serviceFixture(), sample = structuredClone(templateFixtures[1]), knowledgeId = randomUUID(), mediaId = randomUUID();
  f.site.draft = { ...sample.content, knowledgeRevisionId: knowledgeId, mediaRevisionId: mediaId };
  f.site.files = [{ id: randomUUID(), name: 'private-upload.txt', kind: 'text', mime: 'text/plain', size: 4, uploadedAt: new Date().toISOString(), text: 'PRIVATE_SOURCE_UPLOAD' }];
  f.services.readKnowledgeArtifact = async (owner, siteId, revisionId) => { assert.equal(owner, f.user); assert.equal(siteId, f.site.id); assert.equal(revisionId, knowledgeId); return { schemaVersion: 1, id: knowledgeId, catalog: sample.catalog!, origins: [], notes: ['PRIVATE_SOURCE_NOTE'] }; };
  f.services.readMediaLibrary = async (owner, siteId, revisionId) => { assert.equal(owner, f.user); assert.equal(siteId, f.site.id); assert.equal(revisionId, mediaId); return { schemaVersion: 1, id: mediaId, assets: [], albums: [], associations: [] }; };
  f.services.generateWebsiteComposition = async (manifest, _signal, body) => { assert.ok(body); assert.doesNotMatch(body, /PRIVATE_SOURCE_NOTE|PRIVATE_SOURCE_UPLOAD|private-upload/); return proposeWebsiteComposition(manifest); };
  const result = await f.run(); assert.equal(result.plan.snapshot.knowledgeRevisionId, knowledgeId); assert.equal(result.plan.snapshot.mediaRevisionId, mediaId);
  assert.ok(result.plan.sectionOrder.some(id => id.startsWith('collection-')));
  f.site.draft.catalogPublicationId = randomUUID();
  f.services.readKnowledgeArtifact = async () => { throw new Error('A v2 website must not hydrate legacy knowledge for composition.'); };
  await f.run('local');
});

test('AI proposals reserve once before one provider call and return without saving', async () => {
  const f = serviceFixture(), before = structuredClone(f.site), result = await f.run();
  assert.equal(result.mode, 'ai'); assert.deepEqual(f.calls, ['site', 'status', 'reserve', 'provider', 'site']); assert.deepEqual(f.site, before);
});

test('unavailable, exhausted and stale requests stop before provider calls', async () => {
  const unavailable = serviceFixture(); unavailable.services.getEditorStatus = () => ({ mode: 'demo', message: 'AI off', dailyLimit: 0 });
  await assert.rejects(unavailable.run(), status(503)); assert.deepEqual(unavailable.calls, ['site']);
  const exhausted = serviceFixture(); exhausted.services.reserveAiRequest = async () => { exhausted.calls.push('quota-denied'); throw new AppError('Daily limit reached.', 429); };
  await assert.rejects(exhausted.run(), status(429)); assert.deepEqual(exhausted.calls, ['site', 'status', 'quota-denied']);
  const stale = serviceFixture(); stale.site.revision++;
  await assert.rejects(stale.run(), status(409)); assert.deepEqual(stale.calls, ['site']);
  const failed = serviceFixture(); failed.services.generateWebsiteComposition = async () => { failed.calls.push('provider'); throw new AppError('Synthetic provider failure.', 502); };
  await assert.rejects(failed.run(), status(502)); assert.deepEqual(failed.calls, ['site', 'status', 'reserve', 'provider']);
});

test('concurrent draft changes and cancellation discard completed proposals without retries', async () => {
  const stale = serviceFixture(); stale.services.generateWebsiteComposition = async manifest => { stale.calls.push('provider'); stale.site.revision++; return proposeWebsiteComposition(manifest); };
  await assert.rejects(stale.run(), status(409)); assert.deepEqual(stale.calls, ['site', 'status', 'reserve', 'provider', 'site']);
  const cancelled = serviceFixture(), controller = new AbortController();
  cancelled.services.generateWebsiteComposition = async manifest => { cancelled.calls.push('provider'); controller.abort(); return proposeWebsiteComposition(manifest); };
  await assert.rejects(cancelled.run('ai', controller.signal), status(499)); assert.deepEqual(cancelled.calls, ['site', 'status', 'reserve', 'provider']);
  const neverStarted = serviceFixture(); await assert.rejects(neverStarted.run('ai', AbortSignal.abort()), status(499)); assert.deepEqual(neverStarted.calls, []);
});

test('transport makes one bounded cancellable request and never retries errors or oversized bodies', async () => {
  const environment = process.env; process.env = { NODE_ENV: 'test', OPENAI_API_KEY: 'synthetic-offline-placeholder' };
  try {
    const manifest = fixture(), plan = proposeWebsiteComposition(manifest), controller = new AbortController();
    let calls = 0, sentSignal: AbortSignal | null | undefined;
    const transport: typeof fetch = async (url, options) => { calls++; assert.equal(String(url), 'https://api.openai.com/v1/responses');
      assert.equal(options?.method, 'POST'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); sentSignal = options.signal;
      assert.ok(sentSignal instanceof AbortSignal); return Response.json(responseFor(plan)); };
    assert.deepEqual(await generateWebsiteComposition(manifest, controller.signal, undefined, transport), plan); assert.equal(calls, 1);
    controller.abort(); assert.equal(sentSignal?.aborted, true);
    for (const [response, expected] of [[new Response('private-provider-error', { status: 500 }), 502], [new Response('limit', { status: 429 }), 429], [new Response('key', { status: 401 }), 503],
      [new Response('x'.repeat(WEBSITE_COMPOSITION_PROVIDER_LIMITS.responseBytes + 1)), 502], [Response.json({ status: 'incomplete' }), 502]] as const) {
      let attempts = 0;
      await assert.rejects(generateWebsiteComposition(manifest, new AbortController().signal, undefined, async () => { attempts++; return response; }), status(expected));
      assert.equal(attempts, 1);
    }
    let attempts = 0;
    await assert.rejects(generateWebsiteComposition(manifest, new AbortController().signal, undefined, async () => { attempts++; throw new Error('private-provider-error'); }), status(502));
    assert.equal(attempts, 1);
  } finally { process.env = environment; }
});
