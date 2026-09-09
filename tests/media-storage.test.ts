import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

test('photo route lifecycle separates private originals, reviewed revisions and current publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-media-test-'));
  process.env.VOICE_DATA_DIR = directory; process.env.VOICE_BACKEND = 'demo'; process.env.VOICE_AI_MODE = 'demo';
  try {
    const { listSites, getSite, modifySite, downloadFile, downloadPublishedFile } = await import('../lib/site-store');
    const { applyCommand } = await import('../lib/site-commands');
    const { readMediaLibrary, getPublishedMedia, stagePublicMedia } = await import('../lib/media-store');
    const { POST: upload } = await import('../app/api/sites/[siteId]/files/route');
    const { GET: mediaGet, POST: mediaPost } = await import('../app/api/sites/[siteId]/media/route');
    const { POST: sitePost } = await import('../app/api/sites/[siteId]/route');
    const { GET: publicGet } = await import('../app/api/public-files/[slug]/[fileId]/route');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    const id = (await listSites(user))[0].id; const initial = await getSite(user, id);
    const origin = 'http://127.0.0.1:3220'; const context = { params: Promise.resolve({ siteId: id }) };
    const json = (path: string, body: unknown) => new Request(`${origin}${path}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const original = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#567' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const response = await upload(new Request(`${origin}/api/sites/${id}/files`, { method: 'POST', headers: { origin, 'content-type': 'image/jpeg', 'x-site-revision': String(initial.revision), 'x-file-name': 'example.jpg' }, body: original }), context);
    assert.equal(response.status, 200); const uploaded = await response.json(); const fileId = uploaded.fileId as string;
    assert.ok(fileId); assert.equal(uploaded.site.files.at(-1).image.width, 600);
    const stored = await getSite(user, id); const photo = stored.files.find(file => file.id === fileId)!;
    assert.equal(photo.localImage, true); assert.equal(photo.data, undefined); assert.equal(photo.originalData, undefined);
    const workspace = await readFile(join(directory, 'workspace.json'), 'utf8'); assert.ok(!workspace.includes(original.toString('base64')));
    const ownerFolder = (await readdir(join(directory, 'media-files')))[0];
    assert.deepEqual(await readFile(join(directory, 'media-files', ownerFolder, fileId, 'original')), original);
    const thumb = await downloadFile(user, id, fileId, 'thumb'); assert.equal((await sharp(thumb.bytes).metadata()).height, 480);
    await assert.rejects(() => downloadPublishedFile(stored.slug, fileId), /not found/);
    assert.deepEqual(await (await mediaGet(new Request(`${origin}/api/sites/${id}/media`), context)).json(), { library: null });
    const library = { schemaVersion: 1, id: randomUUID(), assets: [{ id: fileId, width: 1, height: 1, caption: 'Reviewed photo', alt: 'A fictional photo' }],
      albums: [{ id: 'examples', title: 'Examples', description: '', assetIds: [fileId], coverAssetId: fileId }],
      associations: [{ id: 'section-photo', assetId: fileId, targetType: 'section', targetId: stored.draft.sections[0].id, role: 'example', primary: true }] };
    const bad = await mediaPost(json(`/api/sites/${id}/media`, { revision: stored.revision, library: { ...library, assets: [{ ...library.assets[0], id: randomUUID() }] } }), context);
    assert.equal(bad.status, 400);
    const appliedResponse = await mediaPost(json(`/api/sites/${id}/media`, { revision: stored.revision, library }), context);
    assert.equal(appliedResponse.status, 200); const applied = await appliedResponse.json();
    assert.equal(applied.library.assets[0].width, 600); assert.notEqual(applied.library.id, library.id);
    assert.ok(!('mediaRefs' in applied.site)); assert.ok(!('localImage' in applied.site.files.at(-1)));
    await stagePublicMedia(user, id, applied.library.id);
    const stagedPath = join(directory, 'media-public', `${id}-${applied.library.id}.json`);
    const stagedMedia = JSON.parse(await readFile(stagedPath, 'utf8'));
    await writeFile(stagedPath, JSON.stringify(Object.fromEntries(Object.entries(stagedMedia).reverse())));
    assert.equal(await stagePublicMedia(user, id, applied.library.id), applied.library.id, 'local revision comparisons ignore object key order too');
    await assert.rejects(() => getPublishedMedia(id, applied.library.id), /published media revision/);
    await assert.rejects(() => downloadPublishedFile(stored.slug, fileId), /not found/);
    const publishedResponse = await sitePost(json(`/api/sites/${id}`, { action: 'publish', revision: applied.site.revision }), context);
    assert.equal(publishedResponse.status, 200); const published = (await publishedResponse.json()).site;
    assert.equal((await getPublishedMedia(id, applied.library.id))?.assets[0].caption, 'Reviewed photo');
    const publicResponse = await publicGet(new Request(`${origin}/api/public-files/${stored.slug}/${fileId}?size=thumb`), { params: Promise.resolve({ slug: stored.slug, fileId }) });
    assert.equal(publicResponse.status, 200); assert.equal(publicResponse.headers.get('content-type'), 'image/webp');
    const publicBytes = new Uint8Array(await publicResponse.arrayBuffer()); assert.equal((await sharp(publicBytes).metadata()).height, 480);
    await assert.rejects(() => downloadPublishedFile(stored.slug, randomUUID()), /not found/);
    await assert.rejects(() => modifySite(user, id, published.revision, site => applyCommand(site, { action: 'remove-file', revision: site.revision, fileId })), /retained Undo history/);
    const emptyResponse = await mediaPost(json(`/api/sites/${id}/media`, { revision: published.revision, library: { ...applied.library, assets: [], albums: [], associations: [] } }), context);
    assert.equal(emptyResponse.status, 200); const empty = await emptyResponse.json();
    assert.equal((await readMediaLibrary(user, id, applied.library.id)).assets[0].caption, 'Reviewed photo');
    assert.ok((await downloadPublishedFile(stored.slug, fileId)).bytes.length);
    const historical = await mediaGet(new Request(`${origin}/api/sites/${id}/media?revisionId=${applied.library.id}`), context); assert.equal(historical.status, 200);
    const unrelated = await mediaGet(new Request(`${origin}/api/sites/${id}/media?revisionId=${randomUUID()}`), context); assert.equal(unrelated.status, 404);
    const replaced = await sitePost(json(`/api/sites/${id}`, { action: 'publish', revision: empty.site.revision }), context); assert.equal(replaced.status, 200);
    const current = (await replaced.json()).site;
    await assert.rejects(() => downloadPublishedFile(stored.slug, fileId), /not found/);
    await assert.rejects(() => modifySite(user, id, current.revision, site => applyCommand(site, { action: 'remove-file', revision: site.revision, fileId })), /retained Undo history/);
    const restored = await modifySite(user, id, current.revision, site => applyCommand(site, { action: 'undo', revision: site.revision }));
    assert.equal(restored.draft.mediaRevisionId, applied.library.id); assert.equal(restored.published?.mediaRevisionId, empty.library.id);
    assert.equal((await downloadFile(user, id, fileId)).file.mime, 'image/webp');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('legacy base64 logos remain usable but public responses are freshly sanitized', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-legacy-photo-test-'));
  process.env.VOICE_DATA_DIR = directory; process.env.VOICE_BACKEND = 'demo'; process.env.VOICE_AI_MODE = 'demo';
  try {
    const { listSites, getSite, uploadFile, modifySite, downloadFile, downloadPublishedLogo } = await import('../lib/site-store');
    const { applyCommand } = await import('../lib/site-commands');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    const id = (await listSites(user))[0].id; const current = await getSite(user, id);
    const original = await sharp({ create: { width: 700, height: 350, channels: 3, background: '#345' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const file = { id: randomUUID(), name: 'old-logo.jpg', mime: 'image/jpeg', kind: 'image' as const, size: original.length, uploadedAt: new Date().toISOString(), data: original.toString('base64') };
    const uploaded = await uploadFile(user, id, current.revision, file);
    const draft = await modifySite(user, id, uploaded.revision, site => applyCommand(site, { action: 'use-logo', revision: site.revision, fileId: file.id }));
    await modifySite(user, id, draft.revision, site => applyCommand(site, { action: 'publish', revision: site.revision }));
    const result = await downloadPublishedLogo(current.slug, file.id); assert.equal(result.file.mime, 'image/webp');
    const metadata = await sharp(result.bytes).metadata(); assert.equal(metadata.width, 350); assert.equal(metadata.height, 700); assert.equal(metadata.exif, undefined);
    const thumbnail = await downloadFile(user, id, file.id, 'thumb'); assert.equal((await sharp(thumbnail.bytes).metadata()).height, 480);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
