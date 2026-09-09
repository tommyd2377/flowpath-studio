import 'server-only';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { validateMediaLibrary, type MediaLibrary } from '@thevoice/platform-ui/media';
import { getFirebaseAdminApp } from './firebase/admin';
import { getBackendMode } from './firebase/config';
import type { WorkspaceUser } from './firebase/types';
import { AppError } from './errors';
import { updateDraft, withDatabase, type StoredFile } from './local-store';
import { readKnowledgeArtifact } from './knowledge-store';

const uuid = z.string().uuid();
const root = () => process.env.VOICE_DATA_DIR || join(process.cwd(), 'data');
const owner = (uid: string) => createHash('sha256').update(uid).digest('hex');
const privateKey = (uid: string, siteId: string) => `${owner(uid)}-${uuid.parse(siteId)}`;
const validateUser = (user: WorkspaceUser) => {
  if (!user.uid || user.mode !== getBackendMode() || user.mode === 'demo' && user.uid !== 'local-demo') throw new AppError('Sign in to access your workspace.', 401);
};
function encoded(library: unknown) {
  // Schema parsing gives stored maps the same field order without changing publisher array order.
  const text = JSON.stringify(validateMediaLibrary(library));
  if (Buffer.byteLength(text) > 600_000) throw new AppError('This media library exceeds the saved-text limit. Shorten captions or album descriptions.', 413);
  return text;
}
const imageDirectory = (uid: string, siteId: string, fileId: string) => join(root(), 'media-files', privateKey(uid, siteId), uuid.parse(fileId));

export async function saveLocalImage(uid: string, siteId: string, file: StoredFile): Promise<StoredFile> {
  const directory = imageDirectory(uid, siteId, file.id);
  await mkdir(join(root(), 'media-files', privateKey(uid, siteId)), { recursive: true });
  await mkdir(directory);
  try {
    await writeFile(join(directory, 'display.webp'), Buffer.from(file.data!, 'base64'), { flag: 'wx', mode: 0o600 });
    await writeFile(join(directory, 'thumb.webp'), Buffer.from(file.thumbnailData!, 'base64'), { flag: 'wx', mode: 0o600 });
    await writeFile(join(directory, 'original'), Buffer.from(file.originalData!, 'base64'), { flag: 'wx', mode: 0o600 });
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  const stored = { ...file, localImage: true };
  delete stored.data; delete stored.thumbnailData; delete stored.originalData;
  return stored;
}
export async function readLocalImage(uid: string, siteId: string, fileId: string, size: 'display' | 'thumb') {
  return new Uint8Array(await readFile(join(imageDirectory(uid, siteId, fileId), size === 'thumb' ? 'thumb.webp' : 'display.webp')));
}
export async function removeLocalImage(uid: string, siteId: string, file: StoredFile) {
  if (file.localImage) await rm(imageDirectory(uid, siteId, file.id), { recursive: true, force: true });
}

export async function readMediaLibrary(user: WorkspaceUser, siteId: string, revisionId: string): Promise<MediaLibrary> {
  validateUser(user); uuid.parse(revisionId);
  let value: unknown;
  if (user.mode === 'firebase') {
    const record = (await getFirestore(getFirebaseAdminApp()).collection('voiceMediaPrivate').doc(`${privateKey(user.uid, siteId)}-${revisionId}`).get()).data();
    if (record?.ownerId !== user.uid || record?.siteId !== siteId) throw new AppError('Media revision not found.', 404);
    value = record.library;
  } else {
    try { value = JSON.parse(await readFile(join(root(), 'media', privateKey(user.uid, siteId), `${revisionId}.json`), 'utf8')); }
    catch { throw new AppError('Media revision not found.', 404); }
  }
  const library = validateMediaLibrary(value);
  if (library.id !== revisionId) throw new AppError('Media revision identity does not match.', 503);
  return library;
}

export async function saveMediaLibrary(user: WorkspaceUser, siteId: string, revision: number, input: unknown) {
  const { getSite, downloadFile, modifySite } = await import('./site-store');
  const current = await getSite(user, siteId);
  if (current.revision !== revision) throw new AppError('Your site changed. Reload before applying these photos.', 409);
  const catalog = current.draft.knowledgeRevisionId ? (await readKnowledgeArtifact(user, siteId, current.draft.knowledgeRevisionId)).catalog : null;
  const proposed = validateMediaLibrary(input, { entityIds: catalog?.entities.map(entity => entity.id) ?? [], sectionIds: current.draft.sections.map(section => section.id) });
  const metadata = new Map<string, NonNullable<StoredFile['image']>>();
  for (const asset of proposed.assets) {
    const file = current.files.find(file => file.id === asset.id && file.kind === 'image');
    if (!file) throw new AppError('Choose photos uploaded to this site. An unknown or deleted photo cannot be applied.');
    const image = file.image ?? (await downloadFile(user, siteId, file.id)).file.image;
    if (!image) throw new AppError('This photo could not be prepared for display.');
    metadata.set(file.id, image);
  }
  const library = validateMediaLibrary({ ...proposed, id: randomUUID(), assets: proposed.assets.map(asset => ({ ...asset,
    width: metadata.get(asset.id)!.width, height: metadata.get(asset.id)!.height })) });
  const text = encoded(library);
  if (user.mode === 'firebase') await getFirestore(getFirebaseAdminApp()).collection('voiceMediaPrivate').doc(`${privateKey(user.uid, siteId)}-${library.id}`).create({ ownerId: user.uid, siteId, library: JSON.parse(text) });
  else {
    const directory = join(root(), 'media', privateKey(user.uid, siteId)); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${library.id}.json`), text, { flag: 'wx', mode: 0o600 });
  }
  const site = await modifySite(user, siteId, revision, state => {
    for (const asset of library.assets) if (!state.files.some(file => file.id === asset.id && file.kind === 'image')) throw new AppError('A photo was removed before Apply. Reload your draft.', 409);
    state.mediaRefs = { ...state.mediaRefs, [library.id]: library.assets.map(asset => asset.id) };
    for (const file of state.files) if (metadata.has(file.id)) file.image = metadata.get(file.id)!;
    updateDraft(state, { ...state.draft, mediaRevisionId: library.id });
  });
  return { site, library };
}

/** A staged manifest is immutable and inaccessible through public routes until publication. */
export async function stagePublicMedia(user: WorkspaceUser, siteId: string, revisionId: string) {
  const library = await readMediaLibrary(user, siteId, revisionId);
  const key = `${uuid.parse(siteId)}-${uuid.parse(revisionId)}`; const text = encoded(library);
  if (user.mode === 'firebase') {
    const db = getFirestore(getFirebaseAdminApp()); const ref = db.collection('voiceMediaPublic').doc(key);
    await db.runTransaction(async transaction => {
      const previous = await transaction.get(ref);
      if (previous.exists) {
        const record = previous.data();
        if (record?.siteId !== siteId || record?.revisionId !== revisionId || encoded(record.library) !== text) throw new AppError('An immutable media revision changed.', 409);
      } else transaction.create(ref, { siteId, revisionId, library: JSON.parse(text) });
    });
  } else {
    const directory = join(root(), 'media-public'); await mkdir(directory, { recursive: true });
    const path = join(directory, `${key}.json`);
    try { await writeFile(path, text, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (encoded(JSON.parse(await readFile(path, 'utf8'))) !== text) throw new AppError('An immutable media revision changed.', 409);
    }
  }
  return revisionId;
}

export async function getPublishedMedia(siteId: string, revisionId?: string): Promise<MediaLibrary | null> {
  if (!revisionId) return null;
  const key = `${uuid.parse(siteId)}-${uuid.parse(revisionId)}`;
  let value: unknown;
  if (getBackendMode() === 'firebase') {
    const db = getFirestore(getFirebaseAdminApp());
    const record = (await db.collection('voiceSites').doc(siteId).get()).data();
    const site = record && typeof record.state === 'string' ? JSON.parse(record.state) : null;
    if (site?.id !== siteId || site.published?.mediaRevisionId !== revisionId) throw new AppError('The published media revision changed. Reload this site.', 409);
    const publicRecord = (await db.collection('voiceMediaPublic').doc(key).get()).data();
    if (publicRecord?.siteId !== siteId || publicRecord?.revisionId !== revisionId) throw new AppError('Published photos are unavailable.', 503);
    value = publicRecord.library;
  } else {
    const allowed = await withDatabase(db => db.sites.some(site => site.id === siteId && site.published?.mediaRevisionId === revisionId));
    if (!allowed) throw new AppError('The published media revision changed. Reload this site.', 409);
    try { value = JSON.parse(await readFile(join(root(), 'media-public', `${key}.json`), 'utf8')); }
    catch { throw new AppError('Published photos are unavailable.', 503); }
  }
  const library = validateMediaLibrary(value);
  if (library.id !== revisionId) throw new AppError('Published media identity does not match.', 503);
  return library;
}
