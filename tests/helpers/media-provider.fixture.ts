import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { initialSite } from '../../lib/local-store';
import { AI_DAILY_LIMIT } from '../../lib/editor-types';

type Value = Record<string, unknown>;
const documents = new Map<string, Value>(); const objects = new Map<string, Buffer>();
let imageReads = 0;
let onImageRead: (() => void) | undefined;
const noUndefined = (value: unknown): void => { assert.notEqual(value, undefined); if (value && typeof value === 'object') Object.values(value).forEach(noUndefined); };
const reference = (collection: string, id: string) => ({ id, path: `${collection}/${id}`, async get() { return snapshot(this); } });
type Ref = ReturnType<typeof reference>;
const snapshot = (ref: Ref) => ({ id: ref.id, exists: documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)) });
const database = {
  collection: (name: string) => ({ doc: (id: string) => reference(name, id) }),
  async runTransaction<T>(operation: (transaction: { get: (ref: Ref) => Promise<ReturnType<typeof snapshot>>; getAll: (...refs: Ref[]) => Promise<ReturnType<typeof snapshot>[]>; set: (ref: Ref, value: Value) => void; create: (ref: Ref, value: Value) => void }) => Promise<T>) {
    const staged = new Map<string, Value>();
    const write = (ref: Ref, value: Value) => { noUndefined(value); staged.set(ref.path, structuredClone(value)); };
    const result = await operation({
      async get(ref) { assert.equal(staged.size, 0); return snapshot(ref); },
      async getAll(...refs) { assert.equal(staged.size, 0); return refs.map(snapshot); },
      set: write, create(ref, value) { assert.equal(documents.has(ref.path), false); write(ref, value); },
    });
    for (const [path, value] of staged) documents.set(path, value);
    return result;
  },
};
mock.module('firebase-admin/firestore', { cache: true, namedExports: { getFirestore: () => database } });
mock.module('firebase-admin/storage', { cache: true, namedExports: { getStorage: () => ({ bucket: () => ({ file: (path: string) => ({
  async download() { imageReads++; onImageRead?.(); assert.ok(objects.has(path)); return [Buffer.from(objects.get(path)!)]; },
}) }) }) } });
mock.module(new URL('../../lib/firebase/admin.ts', import.meta.url).href, { cache: true, namedExports: { getFirebaseAdminApp: () => ({ name: 'offline-fake' }) } });
// Enable only the branch under test. The child has no key, and fetch is replaced before importing it.
mock.module(new URL('../../lib/editor-config.ts', import.meta.url).href, { cache: true, namedExports: { getEditorStatus: () => ({ mode: 'openai', dailyLimit: AI_DAILY_LIMIT, message: 'Offline mock' }) } });
const requests: { url: string; options: RequestInit; body: Record<string, unknown> }[] = [];
let reply: unknown;
let onRequest: (() => void) | undefined;
mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
  assert.equal(String(url), 'https://api.openai.com/v1/responses');
  assert.equal(options?.method, 'POST');
  requests.push({ url: String(url), options: options!, body: JSON.parse(String(options!.body)) });
  onRequest?.();
  return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const completed = (text: string) => ({ status: 'completed', usage: { input_tokens: 31, output_tokens: 17, total_tokens: 48 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] });
const suggested = (id: string) => ({ id, caption: 'A visible garden', alt: 'A garden scene', targetType: null, targetId: null, role: 'depicts', note: '' });
async function fixture() {
  requests.length = 0; imageReads = 0; onRequest = undefined; onImageRead = undefined;
  const user = { uid: randomUUID(), mode: 'firebase' as const, email: null, displayName: null };
  const site = initialSite('general', 'Offline media provider', `media-${randomUUID()}`, user.uid);
  const id = randomUUID();
  // Deliberately seed a legacy original: the real download path must orient and sanitize it.
  const original = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#789' } }).jpeg().withMetadata({ orientation: 6 }).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>Private embedded note</dc:description></rdf:Description></rdf:RDF></x:xmpmeta>').toBuffer();
  const objectPath = `owners/${hash(user.uid)}/sites/${site.id}/${id}`;
  objects.set(objectPath, original);
  site.files = [{ id, name: 'IMG_1234.jpg', kind: 'image', mime: 'image/jpeg', size: original.length, uploadedAt: new Date().toISOString(), objectPath }];
  documents.set(`voiceSites/${site.id}`, { ownerId: user.uid, state: JSON.stringify(site) });
  const input = { revision: site.revision, requestId: randomUUID(), fileIds: [id], context: '', useVision: true };
  reply = completed(JSON.stringify({ photos: [suggested(id)] }));
  return { user, site, id, input, original };
}
const attemptsFor = (uid: string) => documents.get(`voiceAiUsage/owner-${hash(uid)}-${new Date().toISOString().slice(0, 10)}`)?.attempts;

test('one connected call sends only sanitized selected thumbnails and reserves once across replay', async () => {
  const { interpretMedia } = await import('../../lib/media-interpretation');
  const { user, site, id, input, original } = await fixture();
  site.files[0].name = 'Garden wedding.jpg';
  documents.set(`voiceSites/${site.id}`, { ownerId: user.uid, state: JSON.stringify(site) });
  const reviewed = { schemaVersion: 1, id: randomUUID(), assets: [{ id, width: 400, height: 800, caption: 'Garden wedding', alt: 'Publisher-written alternative text', credit: 'Publisher credit' }], albums: [], associations: [] };
  const request = { ...input, library: reviewed };
  const before = structuredClone(documents.get(`voiceSites/${site.id}`));
  const result = await interpretMedia(user, site.id, request, new AbortController().signal);
  assert.equal(result.mode, 'connected'); assert.equal(requests.length, 1); assert.equal(attemptsFor(user.uid), 1);
  const { options, body } = requests[0];
  assert.equal(body.store, false); assert.equal(body.max_output_tokens, 6000); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); assert.ok(options.signal instanceof AbortSignal);
  const content = (body.input as { content: { type: string; image_url?: string; detail?: string }[] }[])[0].content;
  const images = content.filter(item => item.type === 'input_image');
  assert.equal(images.length, 1); assert.equal(images[0].detail, 'low'); assert.ok(images[0].image_url?.startsWith('data:image/webp;base64,'));
  const bytes = Buffer.from(images[0].image_url!.split(',')[1], 'base64');
  assert.equal(bytes.equals(original), false);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.height, 480); assert.equal(metadata.width, 240); assert.equal(metadata.exif, undefined); assert.equal(metadata.xmp, undefined); assert.equal(metadata.iptc, undefined);
  assert.ok(!JSON.stringify(body).includes('Private embedded note')); assert.ok(!JSON.stringify(body).includes('owners/'));
  assert.deepEqual(documents.get(`voiceSites/${site.id}`), before); assert.equal(result.library.assets[0].id, id);
  assert.equal(result.library.assets[0].caption, 'Garden wedding', 'a deliberate caption matching its filename is still publisher-owned');
  assert.equal(result.library.assets[0].alt, 'Publisher-written alternative text'); assert.equal(result.library.assets[0].credit, 'Publisher credit');
  const ledger = documents.get(`voicePlatformEvents/${site.id}`)?.ledger as { events: { status: string; usage?: unknown }[] };
  assert.deepEqual(ledger.events.map(event => event.status), ['reserved', 'confirmed']);
  assert.deepEqual(ledger.events[1].usage, { inputTokens: 31, outputTokens: 17, totalTokens: 48 });
  await assert.rejects(() => interpretMedia(user, site.id, request, new AbortController().signal), /already received/);
  assert.equal(requests.length, 1); assert.equal(attemptsFor(user.uid), 1);
});

test('malformed and incomplete model replies consume one attempt and never retry or alter the draft', async () => {
  const { interpretMedia } = await import('../../lib/media-interpretation');
  for (const malformed of ['not JSON', JSON.stringify({ photos: [] })]) {
    const { user, site, input } = await fixture();
    const before = structuredClone(documents.get(`voiceSites/${site.id}`));
    reply = completed(malformed);
    await assert.rejects(() => interpretMedia(user, site.id, input, new AbortController().signal));
    assert.equal(requests.length, 1); assert.equal(attemptsFor(user.uid), 1); assert.deepEqual(documents.get(`voiceSites/${site.id}`), before);
    await assert.rejects(() => interpretMedia(user, site.id, input, new AbortController().signal), /already received/);
    assert.equal(requests.length, 1);
  }
});

test('cancellation before or during thumbnail preparation prevents reservation and provider calls', async () => {
  const { interpretMedia } = await import('../../lib/media-interpretation');
  const { user, site, input } = await fixture();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => interpretMedia(user, site.id, input, controller.signal), /cancelled/);
  assert.equal(imageReads, 0); assert.equal(requests.length, 0); assert.equal(attemptsFor(user.uid), undefined);
  const later = await fixture(); const during = new AbortController();
  onImageRead = () => during.abort();
  await assert.rejects(() => interpretMedia(later.user, later.site.id, later.input, during.signal), /cancelled/);
  assert.equal(imageReads, 1); assert.equal(requests.length, 0); assert.equal(attemptsFor(later.user.uid), undefined);
});

test('selection limits and ownership are checked before image reads or reservations', async () => {
  const { interpretMedia } = await import('../../lib/media-interpretation');
  const { user, site, input } = await fixture();
  site.files = Array.from({ length: 21 }, () => ({ ...site.files[0], id: randomUUID() }));
  documents.set(`voiceSites/${site.id}`, { ownerId: user.uid, state: JSON.stringify(site) });
  await assert.rejects(() => interpretMedia(user, site.id, { ...input, fileIds: site.files.map(file => file.id) }, new AbortController().signal), /up to 20/);
  await assert.rejects(() => interpretMedia(user, site.id, { ...input, fileIds: [randomUUID()] }, new AbortController().signal), /uploaded to this site/);
  await assert.rejects(() => interpretMedia({ ...user, uid: 'another-owner' }, site.id, input, new AbortController().signal), /not found/);
  assert.equal(imageReads, 0); assert.equal(requests.length, 0); assert.equal(attemptsFor(user.uid), undefined);
});

test('the actual shared daily limit blocks the connected provider without a reservation write', async () => {
  const { interpretMedia } = await import('../../lib/media-interpretation');
  const { user, site, input } = await fixture();
  documents.set(`voiceAiUsage/owner-${hash(user.uid)}-${new Date().toISOString().slice(0, 10)}`, { attempts: AI_DAILY_LIMIT });
  await assert.rejects(() => interpretMedia(user, site.id, input, new AbortController().signal), /daily AI request limit/);
  assert.equal(requests.length, 0); assert.equal(attemptsFor(user.uid), AI_DAILY_LIMIT);
  assert.equal(documents.has(`voiceAiRequests/${hash(JSON.stringify([user.uid, input.requestId]))}`), false);
});

test('a site change while interpreting rejects the result and preserves the newer draft', async () => {
  const { interpretMedia } = await import('../../lib/media-interpretation');
  const { user, site, input } = await fixture();
  onRequest = () => { site.revision++; site.draft.name = 'Newer publisher edit'; documents.set(`voiceSites/${site.id}`, { ownerId: user.uid, state: JSON.stringify(site) }); };
  await assert.rejects(() => interpretMedia(user, site.id, input, new AbortController().signal), /changed while photos were interpreted/);
  assert.equal(requests.length, 1); assert.equal(attemptsFor(user.uid), 1);
  const stored = JSON.parse(documents.get(`voiceSites/${site.id}`)!.state as string);
  assert.equal(stored.draft.name, 'Newer publisher edit'); assert.equal(stored.draft.mediaRevisionId, undefined);
});
