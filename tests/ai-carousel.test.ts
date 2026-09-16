import test from 'node:test';
import assert from 'node:assert/strict';
import { carouselCommand, carouselContextSchema, initialCarouselPosition, moveCarousel, reconcileCarousel } from '@thevoice/platform-ui/carousel';
import { addPublishedMedia } from '@thevoice/platform-ui/collection-space';
import { validateMediaLibrary, youtubeVideoId } from '@thevoice/platform-ui/media';
import { websiteTaskFixture } from '../fixtures/visitor-tasks';
import { inspectMp4 } from '../lib/video-processing';
import { fileResponse } from '../lib/file-validation';
import { runVisitorTask } from '../lib/visitor-task-runner';
import { finalizedCarouselCommand } from '../lib/visitor-carousel-control';

const card = (id: string) => ({ id, title: id, kind: 'photo' as const, referenceIds: [id] });
const receipt = { version: 1 as const, open: true, revision: 2, cards: [card('a'), card('b')], activeId: 'b', previousId: 'a', lastNarratedId: 'a', expanded: false, reading: { scrollTop: 0, blockId: null }, media: null };
test('carousel restores selection per result set and preserves previous and narrated identities separately', () => {
  let state = reconcileCarousel(initialCarouselPosition(), 'results', ['a', 'b']);
  state = moveCarousel(state, ['a', 'b'], 'b');
  assert.equal(moveCarousel(state, ['a', 'b'], 'missing'), state);
  state = reconcileCarousel(state, 'detail:b', ['detail:b']);
  assert.equal(state.previousId, 'b');
  state = reconcileCarousel(state, 'results', ['a', 'b']);
  assert.equal(state.activeId, 'b');
  assert.equal(carouselContextSchema.parse(receipt).lastNarratedId, 'a');
  assert.equal(carouselContextSchema.safeParse({ ...receipt, cards: [card('a'), card('a')] }).success, false);
  assert.equal(carouselContextSchema.safeParse({ ...receipt, activeId: 'missing' }).success, false);
});
test('finalized voice and chat navigation use the same contract and exact page ordinals', () => {
  for (const text of ['Next', 'Go to the next photo', 'Previous card', 'Expand', 'Collapse', 'Back', 'Start over', 'Home', 'Back to the website']) {
    assert.deepEqual(finalizedCarouselCommand(text, { carousel: receipt }), carouselCommand(text));
  }
  assert.deepEqual(finalizedCarouselCommand('Open the second one', { carousel: receipt }), { action: 'open', id: 'b' });
  assert.equal(finalizedCarouselCommand('Open the second one', { carousel: { ...receipt, page: { start: 25, total: 80 } } }), null);
  assert.deepEqual(finalizedCarouselCommand('Open 26', { carousel: { ...receipt, page: { start: 25, total: 80 } } }), { action: 'open', id: 'b' });
});
const library = () => validateMediaLibrary({ schemaVersion: 1, id: 'media', assets: [{ id: 'photo', width: 640, height: 480, alt: 'Blue bowl', caption: '', credit: '' }], albums: [{ id: 'album', title: 'Album', description: '', assetIds: ['photo'] }], associations: [], videos: [{ id: 'video', title: 'Studio film', description: 'A published process film.', source: { kind: 'youtube', videoId: 'abcdefghijk' }, transcript: Array.from({ length: 120 }, (_, i) => ({ start: i, end: i + 1, text: `Published cue ${i}` })) }] });
test('published photos and video retain canonical identity across albums and repeated media adaptation', () => {
  const once = addPublishedMedia(websiteTaskFixture('products', 40), library()), twice = addPublishedMedia(once, library());
  assert.equal(twice.records.filter(record => record.type === 'published-photo').length, 1);
  assert.equal(twice.records.filter(record => record.type === 'published-video').length, 1);
  const video = twice.records.find(record => record.type === 'published-video')!;
  assert.equal(video.blocks.length, 30); assert.match(video.blocks.at(-1)!.text, /Published cue 119/);
});
test('video source contracts normalize YouTube and reject executable or malformed sources', () => {
  assert.equal(youtubeVideoId('https://youtu.be/abcdefghijk'), 'abcdefghijk');
  assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=abcdefghijk'), 'abcdefghijk');
  for (const url of ['javascript:alert(1)', 'https://example.com/movie.html', 'https://user:password@example.com/movie.mp4']) {
    assert.throws(() => validateMediaLibrary({ ...library(), videos: [{ id: 'bad', title: 'Bad', description: '', source: { kind: 'url', url } }] }));
  }
});
function box(kind: string, bytes: Buffer) { const head = Buffer.alloc(8); head.writeUInt32BE(bytes.length + 8); head.write(kind, 4); return Buffer.concat([head, bytes]); }
export function syntheticMp4() {
  const mvhd = Buffer.alloc(24); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(5000, 16);
  const tkhd = Buffer.alloc(84); tkhd.writeUInt32BE(640 * 65536, 76); tkhd.writeUInt32BE(480 * 65536, 80);
  const stsd = Buffer.alloc(16); stsd.write('avc1', 12);
  return Buffer.concat([box('ftyp', Buffer.from('isom0000isom')), box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', Buffer.concat([box('tkhd', tkhd), box('mdia', box('minf', box('stbl', box('stsd', stsd))))]))]))]);
}
test('MP4 metadata bounds and public byte ranges are enforced without media decoding', async () => {
  const bytes = syntheticMp4(); assert.deepEqual(inspectMp4(bytes), { duration: 5, width: 640, height: 480 });
  assert.throws(() => inspectMp4(bytes.subarray(0, -1)));
  assert.throws(() => inspectMp4(Buffer.from('not a video')));
  const file = { id: 'file', name: 'test.mp4', kind: 'video' as const, size: bytes.length, mime: 'video/mp4', uploadedAt: new Date().toISOString() };
  const response = fileResponse(file, bytes, 'bytes=2-7'); assert.equal(response.status, 206); assert.equal(response.headers.get('content-length'), '6'); assert.equal((await response.arrayBuffer()).byteLength, 6);
  assert.equal(fileResponse(file, bytes, 'bytes=99999-').status, 416);
});
test('active-image input is bounded to the current turn and uses the existing mocked model request', async () => {
  const requests: Record<string, unknown>[] = [];
  const result = await runVisitorTask({ model: 'mock', channel: 'chat', apiKey: 'fake', instructions: 'Test', context: { carousel: receipt }, signal: new AbortController().signal, tools: [], execute: async () => { throw new Error('No tools expected'); }, activeImage: async () => ({ label: 'Current approved image', image_url: 'data:image/jpeg;base64,ZmFrZQ==' }), fetch: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Mock description.' }] }] }); } });
  assert.equal(result.text, 'Mock description.'); assert.equal(requests.length, 1);
  assert.match(JSON.stringify(requests[0].input), /input_image/); assert.equal(requests[0].store, false);
});

test('uploaded MP4 stays private through review and is range-readable only in the current publication', async () => {
  const { mkdtemp, rm, readFile } = await import('node:fs/promises'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'carousel-video-'));
  process.env.VOICE_DATA_DIR = directory; process.env.VOICE_BACKEND = 'demo'; process.env.VOICE_AI_MODE = 'demo';
  try {
    const { listSites, getSite, downloadPublishedFile } = await import('../lib/site-store');
    const { POST: upload } = await import('../app/api/sites/[siteId]/files/route');
    const { POST: mediaPost } = await import('../app/api/sites/[siteId]/media/route');
    const { POST: publish } = await import('../app/api/sites/[siteId]/route');
    const { GET: publicGet } = await import('../app/api/public-files/[slug]/[fileId]/route');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null }, id = (await listSites(user))[0].id, site = await getSite(user, id);
    const origin = 'http://127.0.0.1:3220', context = { params: Promise.resolve({ siteId: id }) }, bytes = syntheticMp4();
    const json = (path: string, data: unknown) => new Request(`${origin}${path}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const uploadedResponse = await upload(new Request(`${origin}/api/sites/${id}/files`, { method: 'POST', headers: { origin, 'content-type': 'video/mp4', 'x-site-revision': String(site.revision), 'x-file-name': 'synthetic.mp4' }, body: bytes }), context);
    assert.equal(uploadedResponse.status, 200); const uploaded = await uploadedResponse.json();
    await assert.rejects(() => downloadPublishedFile(site.slug, uploaded.fileId), /not found/);
    assert.equal((await readFile(join(directory, 'workspace.json'), 'utf8')).includes(bytes.toString('base64')), false);
    const appliedResponse = await mediaPost(json(`/api/sites/${id}/media`, { revision: uploaded.site.revision, library: { schemaVersion: 1, id: 'reviewed-video', assets: [], albums: [], associations: [], videos: [{ id: 'film', title: 'A film', description: 'Reviewed description', source: { kind: 'file', fileId: uploaded.fileId } }] } }), context);
    assert.equal(appliedResponse.status, 200); const applied = await appliedResponse.json();
    await assert.rejects(() => downloadPublishedFile(site.slug, uploaded.fileId), /not found/);
    const publishedResponse = await publish(json(`/api/sites/${id}`, { action: 'publish', revision: applied.site.revision }), context); assert.equal(publishedResponse.status, 200); const published = await publishedResponse.json();
    const response = await publicGet(new Request(`${origin}/api/public-files/${site.slug}/${uploaded.fileId}`, { headers: { range: 'bytes=0-15' } }), { params: Promise.resolve({ slug: site.slug, fileId: uploaded.fileId }) });
    assert.equal(response.status, 206); assert.equal(response.headers.get('content-type'), 'video/mp4'); assert.equal((await response.arrayBuffer()).byteLength, 16);
    const removed = await mediaPost(json(`/api/sites/${id}/media`, { revision: published.site.revision, library: { ...applied.library, videos: [] } }), context); const draft = await removed.json();
    assert.equal((await publish(json(`/api/sites/${id}`, { action: 'publish', revision: draft.site.revision }), context)).status, 200);
    await assert.rejects(() => downloadPublishedFile(site.slug, uploaded.fileId), /not found/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
