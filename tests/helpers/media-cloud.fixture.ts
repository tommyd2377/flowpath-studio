import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { initialSite } from '../../lib/local-store';

type Value = Record<string, unknown>;
const documents = new Map<string, Value>(); const objects = new Map<string, Buffer>();
const reads: string[] = []; const batches: string[][] = [];
const reordered = (value: unknown): unknown => Array.isArray(value) ? value.map(reordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reordered(child)])) : value;
const noUndefined = (value: unknown): void => { assert.notEqual(value, undefined); if (value && typeof value === 'object') Object.values(value).forEach(noUndefined); };
const snapshot = (ref: { id: string; path: string }) => { reads.push(ref.path); return { id: ref.id, exists: documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)) }; };
const reference = (collection: string, id: string) => ({ id, path: `${collection}/${id}`, async get() { return snapshot(this); }, async create(value: Value) { noUndefined(value); assert.equal(documents.has(this.path), false); documents.set(this.path, structuredClone(value)); } });
const database = {
  collection: (name: string) => ({ doc: (id: string) => reference(name, id) }),
  async runTransaction<T>(operation: (transaction: { get: (ref: ReturnType<typeof reference>) => Promise<ReturnType<typeof snapshot>>; set: (ref: ReturnType<typeof reference>, value: Value) => void; create: (ref: ReturnType<typeof reference>, value: Value) => void }) => Promise<T>) {
    const staged = new Map<string, Value>();
    const write = (ref: ReturnType<typeof reference>, value: Value) => { noUndefined(value); staged.set(ref.path, structuredClone(value)); };
    const result = await operation({ async get(ref) { assert.equal(staged.size, 0); return snapshot(ref); }, set: write, create(ref, value) { assert.equal(documents.has(ref.path), false); write(ref, value); } });
    for (const [path, value] of staged) documents.set(path, value);
    batches.push([...staged.keys()]); return result;
  },
};
mock.module('firebase-admin/firestore', { cache: true, namedExports: { getFirestore: () => database } });
mock.module('firebase-admin/storage', { cache: true, namedExports: { getStorage: () => ({ bucket: () => ({ file: (path: string) => ({
  async save(bytes: Buffer) { assert.equal(objects.has(path), false); objects.set(path, Buffer.from(bytes)); },
  async download() { assert.ok(objects.has(path)); return [Buffer.from(objects.get(path)!)]; },
  async delete() { objects.delete(path); },
}) }) }) } });
mock.module(new URL('../../lib/firebase/admin.ts', import.meta.url).href, { cache: true, namedExports: { getFirebaseAdminApp: () => ({ name: 'offline-fake' }) } });
let networkCalls = 0;
mock.method(globalThis, 'fetch', async () => { networkCalls++; throw new Error('External requests are forbidden.'); });

test('cloud media keeps originals private, publishes an atomic file allowlist and revokes replaced assets', async () => {
  const { readUpload } = await import('../../lib/file-validation');
  const { uploadFile, modifySite, downloadFile, downloadPublishedFile } = await import('../../lib/site-store');
  const { saveMediaLibrary, readMediaLibrary, stagePublicMedia } = await import('../../lib/media-store');
  const { applyCommand } = await import('../../lib/site-commands');
  const user = { uid: 'offline-media-owner', mode: 'firebase' as const, email: null, displayName: null };
  const site = initialSite('general', 'Offline photos', 'offline-cloud-photos', user.uid);
  documents.set(`voiceSites/${site.id}`, { ownerId: user.uid, state: JSON.stringify(site) });
  const original = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#789' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const { file } = await readUpload(new Request('http://localhost/upload', { method: 'POST', headers: { 'content-type': 'image/jpeg', 'x-site-revision': '1', 'x-file-name': 'cloud.jpg' }, body: original }));
  const uploaded = await uploadFile(user, site.id, 1, file);
  assert.equal(objects.size, 3); assert.ok([...objects.entries()].some(([path, bytes]) => path.endsWith('/original') && bytes.equals(original)));
  assert.ok(!('objectPath' in uploaded.files[0])); assert.ok(!('originalData' in uploaded.files[0]));
  assert.equal((await sharp((await downloadFile(user, site.id, file.id, 'thumb')).bytes).metadata()).height, 480);
  const library = { schemaVersion: 1, id: randomUUID(), assets: [{ id: file.id, width: 400, height: 800, caption: 'Reviewed image', alt: 'An example image' }], albums: [], associations: [{ id: 'site-photo', assetId: file.id, targetType: 'site', role: 'example' }] };
  const applied = await saveMediaLibrary(user, site.id, uploaded.revision, library);
  await assert.rejects(() => readMediaLibrary({ ...user, uid: 'another-owner' }, site.id, applied.library.id), /not found/);
  await stagePublicMedia(user, site.id, applied.library.id);
  const publicMediaKey = `voiceMediaPublic/${site.id}-${applied.library.id}`;
  const stagedMedia = structuredClone(documents.get(publicMediaKey)!);
  documents.set(publicMediaKey, reordered(stagedMedia) as Value);
  assert.equal(await stagePublicMedia(user, site.id, applied.library.id), applied.library.id, 'Firebase map order does not change immutable media identity');
  assert.deepEqual(batches.at(-1), [], 'staging the same revision performs no rewrite');
  for (const changed of [{ ...stagedMedia, siteId: randomUUID() }, { ...stagedMedia, revisionId: randomUUID() },
    { ...stagedMedia, library: { ...applied.library, id: randomUUID() } },
    { ...stagedMedia, library: { ...applied.library, assets: [{ ...applied.library.assets[0], caption: 'Changed caption' }] } }]) {
    documents.set(publicMediaKey, changed);
    await assert.rejects(() => stagePublicMedia(user, site.id, applied.library.id), /immutable media revision changed/);
    assert.deepEqual(documents.get(publicMediaKey), changed, 'a conflicting staged revision is never overwritten');
  }
  documents.set(publicMediaKey, stagedMedia);
  await assert.rejects(() => downloadPublishedFile(site.slug, file.id), /not found/);
  const published = await modifySite(user, site.id, applied.site.revision, state => applyCommand(state, { action: 'publish', revision: state.revision }));
  assert.deepEqual(batches.at(-1), [`voiceSites/${site.id}`, `voicePublished/${site.slug}`]);
  const publicRecord = documents.get(`voicePublished/${site.slug}`)!;
  assert.ok(!JSON.stringify(publicRecord).includes('/original')); assert.ok(!JSON.stringify(publicRecord).includes(original.toString('base64')));
  reads.length = 0;
  const publicImage = await downloadPublishedFile(site.slug, file.id, 'thumb');
  assert.equal((await sharp(publicImage.bytes).metadata()).height, 480);
  assert.deepEqual(reads, [`voicePublished/${site.slug}`], 'thumbnail authorization needs only the current published snapshot');
  const empty = await saveMediaLibrary(user, site.id, published.revision, { ...applied.library, assets: [], albums: [], associations: [] });
  assert.ok((await downloadPublishedFile(site.slug, file.id)).bytes.length);
  await stagePublicMedia(user, site.id, empty.library.id);
  const replaced = await modifySite(user, site.id, empty.site.revision, state => applyCommand(state, { action: 'publish', revision: state.revision }));
  await assert.rejects(() => downloadPublishedFile(site.slug, file.id), /not found/);
  await assert.rejects(() => modifySite(user, site.id, replaced.revision, state => applyCommand(state, { action: 'remove-file', revision: state.revision, fileId: file.id })), /retained Undo history/);
  assert.equal(objects.size, 3); assert.equal(networkCalls, 0);
});
