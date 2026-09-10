import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_EXPLORE_SETTINGS, allowedSource, demoExploreResult, exploreResultSchema, exploreSettings, exploreSettingsSchema, localExploreCommand, mapEmbedUrl, mapForQuery, publicWebUrl } from '../lib/explore-model';
import { parseExploreResponse, searchExplore } from '../lib/explore-provider';
import { currentLedger } from '../lib/visitor-quota';
import { reserveSearch, searchRemaining } from '../lib/explore-quota';
import { sampleContent, contentSchema, describeChanges } from '../lib/site-model';
import { DEFAULT_VISITOR_SETTINGS } from '../lib/visitor-model';
import { validateExploreVoice } from '../lib/explore-voice';
import { validateVisitorContext } from '../lib/visitor-realtime-context';

const settings = { ...DEFAULT_EXPLORE_SETTINGS, enabled: true, allowedDomains: ['nps.gov'] };
const content = { ...sampleContent('general'), visitor: DEFAULT_VISITOR_SETTINGS, explore: settings };
function payload() {
  return { status: 'completed', output: [
    { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ type: 'url', title: 'National parks', url: 'https://www.nps.gov/' }] }, results: [
      { type: 'image_result', image_url: 'https://images.nps.gov/view.jpg', thumbnail_url: 'https://images.nps.gov/thumb.jpg', source_website_url: 'https://www.nps.gov/', caption: 'National park landscape' },
      { type: 'image_result', image_url: 'https://images.nps.gov/another.jpg', source_website_url: 'https://outsider.org/', caption: 'Out of scope' },
      { type: 'image_result', image_url: 'https://127.0.0.1/private', source_website_url: 'https://www.nps.gov/', caption: 'Unsafe' },
    ] },
    { type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Explore the parks. [source]', annotations: [{ type: 'url_citation', url: 'https://www.nps.gov/', title: 'National parks', start_index: 19, end_index: 27 }] }] },
  ] };
}

test('search settings are optional, publishable, bounded, and default off', () => {
  assert.equal(exploreSettings(sampleContent('general')).enabled, false);
  assert.deepEqual(contentSchema.parse(content).explore, settings);
  assert.equal(describeChanges(sampleContent('general'), content).some(change => change.label === 'Search and explore' && change.after.includes('images on')), true);
  for (const domain of ['https://nps.gov', 'nps.gov/path', 'localhost', '127.0.0.1', 'private.internal']) assert.equal(exploreSettingsSchema.safeParse({ ...settings, allowedDomains: [domain] }).success, false);
  assert.equal(exploreSettingsSchema.safeParse({ ...settings, dailyLimit: 101 }).success, false);
  const expanded = { ...content, explore: exploreSettingsSchema.parse({ ...settings, dailyLimit: 100 }) };
  const ledger = currentLedger(undefined);
  for (let request = 0; request < 100; request++) reserveSearch(ledger, 'publisher', `search-${request}`, expanded);
  assert.equal(searchRemaining(ledger, 'publisher', expanded), 0);
  assert.throws(() => reserveSearch(ledger, 'publisher', 'over-limit', expanded), /daily limit/);
});

test('only public HTTPS resources and allowed source domains enter external views', () => {
  for (const value of ['javascript:alert(1)', 'data:image/png;base64,xx', 'file:///etc/passwd', 'http://nps.gov', 'https://user:pass@nps.gov', 'https://[::1]/', 'https://2130706433/', 'https://localhost.', 'https://private.local', 'https://nps.gov:3000/']) assert.equal(publicWebUrl(value), false, value);
  assert.equal(allowedSource('https://www.nps.gov/places', settings), true);
  assert.equal(allowedSource('https://nps.gov.attacker.org/', settings), false);
  assert.equal(allowedSource('https://notnps.gov/', settings), false);
});

test('image URLs come from hosted results, filtered by source, with stable IDs and citations', () => {
  const raw = payload();
  raw.output[1].content![0].text = 'Explore the parks. [source]';
  raw.output[1].content![0].annotations[0].start_index = 19;
  raw.output[1].content![0].annotations[0].end_index = 27;
  // Use exact text offsets, including the provider citation marker.
  raw.output[1].content![0].annotations[0].end_index = raw.output[1].content![0].text.length;
  const result = parseExploreResponse(raw, 'Park images', 'images', settings);
  assert.equal(result.images.length, 1); assert.equal(result.images[0].id, `image-${result.id}-1`);
  assert.equal(result.images[0].sourceUrl, 'https://www.nps.gov/');
  assert.equal(result.citations.length, 1); assert.equal(result.sources.length, 1);
  assert.equal(parseExploreResponse(raw, 'Parks', 'web', settings).images.length, 0);
  assert.throws(() => parseExploreResponse({ ...raw, status: 'incomplete' }, 'Parks', 'web', settings));
  assert.throws(() => parseExploreResponse({ ...raw, output: [raw.output[0], ...raw.output] }, 'Parks', 'web', settings));
  assert.throws(() => exploreResultSchema.parse({ ...result, images: [{ ...result.images[0], url: '/explore-demo.svg' }] }));
});

test('uncited synthesis is replaced by neutral source navigation', () => {
  const raw = payload(); raw.output[1].content![0].annotations = [];
  raw.output[1].content![0].text = 'Invented business promise';
  assert.equal(parseExploreResponse(raw, 'Parks', 'web', settings).answer, 'Explore the sources below.');
});

test('provider request is single-call, bounded and uses the existing OpenAI transport', async () => {
  const env = process.env; process.env = { NODE_ENV: 'test', OPENAI_API_KEY: 'offline-placeholder' };
  let calls = 0;
  try {
    const transport: typeof fetch = async (url, init) => {
      calls++; assert.equal(url, 'https://api.openai.com/v1/responses');
      const request = JSON.parse(String(init?.body));
      assert.equal(request.model, 'gpt-5.6-luna'); assert.equal(request.store, false);
      assert.equal(request.max_tool_calls, 1); assert.equal(request.tool_choice, 'required');
      assert.deepEqual(request.tools[0].filters.allowed_domains, ['nps.gov']);
      assert.deepEqual(request.tools[0].search_content_types, ['image', 'text']);
      return Response.json(payload());
    };
    await searchExplore('parks', 'images', settings, new AbortController().signal, { fetch: transport });
    assert.equal(calls, 1);
    await assert.rejects(searchExplore('parks', 'images', { ...settings, images: false }, new AbortController().signal, { fetch: transport }));
    assert.equal(calls, 1);
    await assert.rejects(searchExplore('parks', 'web', settings, new AbortController().signal, { fetch: async () => { calls++; throw new Error('offline'); } }));
    assert.equal(calls, 2, 'no retry');
    const abort = new AbortController(); abort.abort();
    await assert.rejects(searchExplore('parks', 'web', settings, abort.signal, { fetch: transport }));
    assert.equal(calls, 2);
  } finally { process.env = env; }
});

test('known map overviews need no provider call and never generate arbitrary embed URLs', async () => {
  const map = mapForQuery('Show me a map of the U.S.'); assert.ok(map);
  const result = await searchExplore('map of the U.S.', 'map', settings, new AbortController().signal, { fetch: async () => { throw new Error('Unexpected network'); } });
  assert.equal(result.map?.longitude, -98);
  assert.equal(new URL(mapEmbedUrl(map)).hostname, 'www.openstreetmap.org');
  assert.throws(() => mapEmbedUrl({ ...map, latitude: Number.NaN }));
  assert.equal(demoExploreResult('unknown town', 'map').map, null);
  assert.equal(mapForQuery('Show us a map of France'), null);
  assert.equal(mapForQuery('Map of South America'), null);
});

test('search quotas share replay protection and do not consume chat or voice allowances', () => {
  const ledger = currentLedger(undefined); const limited = { ...content, explore: { ...settings, dailyLimit: 1 } };
  reserveSearch(ledger, 'site', 'request', limited);
  assert.equal(searchRemaining(ledger, 'site', limited), 0);
  assert.deepEqual(ledger.totals, { chat: 0, voice: 0 });
  assert.throws(() => reserveSearch(ledger, 'site', 'request', limited), /already received/);
  assert.throws(() => reserveSearch(ledger, 'site', 'other', limited), /daily limit/);
  const global = currentLedger(undefined); global.search = { total: 100, sites: {} };
  assert.throws(() => reserveSearch(global, 'new', 'new', content), /daily limit/);
  assert.throws(() => currentLedger({ ...ledger, search: { total: -1, sites: {} } }));
});

test('photo follow-ups resolve only displayed IDs; disabled or forged views are rejected', () => {
  const context = { resultId: 'search-1', kind: 'images' as const, images: [{ id: 'image-1', caption: 'A' }, { id: 'image-2', caption: 'B' }], selectedImageId: null, map: null };
  assert.deepEqual(localExploreCommand('Open the second photo', context), { kind: 'open_image', id: 'image-2' });
  assert.equal(localExploreCommand('Open that photo', context), null, 'ambiguous selection is not guessed');
  assert.deepEqual(validateExploreVoice({ kind: 'open_image', query: null, id: 'image-2' }, content, context), { command: { kind: 'open_image', id: 'image-2' } });
  assert.throws(() => validateExploreVoice({ kind: 'open_image', query: null, id: 'forged' }, content, context));
  assert.throws(() => validateVisitorContext({ explore: context }, sampleContent('general')));
  assert.doesNotThrow(() => validateVisitorContext({ explore: context }, content));
});

test('HTTP search uses published opt-in and durable quotas; demo never calls a provider', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-explore-')); const env = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No external requests'); });
  try {
    const { withDatabase, initialSite } = await import('../lib/local-store');
    const { POST } = await import('../app/api/visitor/[slug]/explore/route');
    await withDatabase(db => { const site = initialSite('general', 'Search test', 'search-test'); site.draft.explore = settings; site.published = { ...site.draft, explore: undefined }; db.sites = [site]; });
    const origin = 'http://127.0.0.1:3220';
    const send = (kind = 'images', requestId = randomUUID(), requestOrigin = origin) => POST(new Request(`${origin}/api/visitor/search-test/explore`, { method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ requestId, query: 'Parks', kind }) }), { params: Promise.resolve({ slug: 'search-test' }) });
    assert.equal((await send()).status, 403);
    assert.equal(await withDatabase(db => db.visitorUsage), undefined);
    await withDatabase(db => { db.sites[0].published = { ...db.sites[0].draft, explore: { ...settings, dailyLimit: 1 } }; });
    assert.equal((await send('images', randomUUID(), 'https://unrelated.org')).status, 403);
    const id = randomUUID(); const response = await send('images', id); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.result.demo, true); assert.equal(body.searchRemaining, 0);
    assert.equal((await send('images', id)).status, 409);
    assert.equal((await send()).status, 429);
    assert.equal(network.mock.callCount(), 0);
    assert.deepEqual(await withDatabase(db => db.visitorUsage?.totals), { chat: 0, voice: 0 });
  } finally { process.env = env; await rm(directory, { recursive: true, force: true }); }
});
