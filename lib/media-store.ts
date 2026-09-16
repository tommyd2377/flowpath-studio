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
export async function saveLocalVideo(uid: string, siteId: string, file: StoredFile): Promise<StoredFile> {
  const directory = imageDirectory(uid, siteId, file.id); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'video.mp4'), Buffer.from(file.data!, 'base64'), { flag: 'wx', mode: 0o600 });
  const stored = { ...file, localVideo: true }; delete stored.data; return stored;
}
export async function readLocalVideo(uid: string, siteId: string, fileId: string) { return new Uint8Array(await readFile(join(imageDirectory(uid, siteId, fileId), 'video.mp4'))); }

export async function readLocalImage(uid: string, siteId: string, fileId: string, size: 'display' | 'thumb') {
  return new Uint8Array(await readFile(join(imageDirectory(uid, siteId, fileId), size === 'thumb' ? 'thumb.webp' : 'display.webp')));
}
export async function removeLocalImage(uid: string, siteId: string, file: StoredFile) {
  if (file.localImage || file.localVideo) await rm(imageDirectory(uid, siteId, file.id), { recursive: true, force: true });
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

async function writePrivateMedia(user: WorkspaceUser, siteId: string, library: MediaLibrary) {
  validateUser(user);
  const text = encoded(library);
  if (user.mode === 'firebase') await getFirestore(getFirebaseAdminApp()).collection('voiceMediaPrivate').doc(`${privateKey(user.uid, siteId)}-${library.id}`).create({ ownerId: user.uid, siteId, library: JSON.parse(text) });
  else {
    const directory = join(root(), 'media', privateKey(user.uid, siteId)); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${library.id}.json`), text, { flag: 'wx', mode: 0o600 });
  }
}

/** Prepare only; the caller installs this revision atomically with knowledge Apply. */
export async function prepareKnowledgeMedia(user: WorkspaceUser, siteId: string, revisionId: string | undefined, entityIds: ReadonlySet<string>, remaps: Record<string, string> = {}): Promise<MediaLibrary | null> {
  if (!revisionId) return null;
  const current = await readMediaLibrary(user, siteId, revisionId);
  const { remappedEntityId } = await import('./knowledge-model');
  const primary = new Set<string>();
  const associations = [...new Map(current.associations.map(link => link.targetType === 'entity' ? { ...link, targetId: remappedEntityId(link.targetId!, remaps) } : link)
    .filter(link => link.targetType !== 'entity' || entityIds.has(link.targetId!)).map(link => [`${link.targetType}/${link.targetId ?? ''}/${link.assetId}`, link])).values()]
    .map(link => {
      const key = `${link.targetType}/${link.targetId ?? ''}/${link.role}`;
      if (!link.primary) return link;
      if (primary.has(key)) return { ...link, primary: false };
      primary.add(key); return link;
    });
  if (JSON.stringify(associations) === JSON.stringify(current.associations)) return null;
  const library = validateMediaLibrary({ ...current, id: randomUUID(), associations });
  await writePrivateMedia(user, siteId, library);
  return library;
}

export async function saveMediaLibrary(user: WorkspaceUser, siteId: string, revision: number, input: unknown) {
  const { getSite, downloadFile, modifySite } = await import('./site-store');
  const current = await getSite(user, siteId);
  if (current.revision !== revision) throw new AppError('Your site changed. Reload before applying these photos.', 409);
  const catalog = current.draft.knowledgeRevisionId ? (await readKnowledgeArtifact(user, siteId, current.draft.knowledgeRevisionId)).catalog : null;
  const proposed = validateMediaLibrary(input, { entityIds: catalog?.entities.map(entity => entity.id) ?? [], sectionIds: current.draft.sections.map(section => section.id) });
  for (const video of proposed.videos ?? []) { const source = video.source; if (source.kind === 'file' && !current.files.some(file => file.id === source.fileId && file.kind === 'video')) throw new AppError('Choose a video uploaded to this site.'); }
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
  await writePrivateMedia(user, siteId, library);
  const site = await modifySite(user, siteId, revision, state => {
    for (const asset of library.assets) if (!state.files.some(file => file.id === asset.id && file.kind === 'image')) throw new AppError('A photo was removed before Apply. Reload your draft.', 409);
    const videoIds = (library.videos ?? []).flatMap(video => video.source.kind === 'file' ? [video.source.fileId] : []);
    for (const id of videoIds) if (!state.files.some(file => file.id === id && file.kind === 'video')) throw new AppError('A video was removed before Apply.', 409);
    state.mediaRefs = { ...state.mediaRefs, [library.id]: [...library.assets.map(asset => asset.id), ...videoIds] };
    for (const file of state.files) if (metadata.has(file.id)) file.image = metadata.get(file.id)!;
    updateDraft(state, { ...state.draft, mediaRevisionId: library.id });
  });
  return { site, library };
}

/** Content targets can be deleted independently of immutable media revisions. Preserve the photos, but retire only links whose section no longer exists. */
export async function reconcileSectionAssociations(user: WorkspaceUser, siteId: string, revision: number, sectionIds: readonly string[]) {
  const { getSite } = await import('./site-store');
  const current = await getSite(user, siteId);
  if (current.revision !== revision || !current.draft.mediaRevisionId) return { site: current, repaired: false };
  const library = await readMediaLibrary(user, siteId, current.draft.mediaRevisionId);
  const known = new Set(sectionIds);
  const associations = library.associations.filter(link => link.targetType !== 'section' || known.has(link.targetId!));
  if (associations.length === library.associations.length) return { site: current, repaired: false };
  const saved = await saveMediaLibrary(user, siteId, revision, { ...library, associations });
  return { site: saved.site, repaired: true };
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

/** Prepare migration photos without changing the draft until the combined review is applied. */
export async function prepareMigrationMedia(user: WorkspaceUser, siteId: string, images: import('./website-migration-model').WebsiteMigration['images']) {
  const { getSite } = await import('./site-store'); const site = await getSite(user,siteId);
  const current = site.draft.mediaRevisionId ? await readMediaLibrary(user,siteId,site.draft.mediaRevisionId) : {schemaVersion:1 as const,id:randomUUID(),assets:[],albums:[],associations:[]};
  const library: MediaLibrary=structuredClone(current); library.id=randomUUID();
  const ids: string[]=[];
  for(const item of images.filter(i=>i.status==='imported'&&i.fileId)) {
    const file=site.files.find(f=>f.id===item.fileId&&f.kind==='image');if(!file?.image)throw new AppError('An imported image was removed. Import it again before applying.');
    const asset=library.assets.find(a=>a.id===file.id);if(asset){asset.caption=item.caption;asset.alt=item.alt;}else library.assets.push({id:file.id,width:file.image.width,height:file.image.height,caption:item.caption,alt:item.alt});
    if(item.placement==='logo')continue;
    ids.push(file.id);
    const targetType=item.targetEntityId?'entity' as const:'site' as const;
    if(item.placement==='lead')library.associations=library.associations.map(a=>a.targetType===targetType&&a.targetId===item.targetEntityId&&a.role===item.role?{...a,primary:false}:a);
    const association=library.associations.find(a=>a.assetId===file.id&&a.targetType===targetType&&a.targetId===item.targetEntityId);if(association){association.role=item.role;association.primary=item.placement==='lead';}else library.associations.push({id:randomUUID(),assetId:file.id,targetType,...(item.targetEntityId?{targetId:item.targetEntityId}:{}),role:item.role,primary:item.placement==='lead'});
  }
  const old=library.albums.find(a=>a.title==='Imported website photos');
  if(old){old.assetIds=[...new Set([...old.assetIds,...ids])];if(old.description==='Reviewed source website photos; original placements retained in the website presentation.')old.description='Reviewed photos imported from the source website.';}else if(ids.length)library.albums.push({id:randomUUID(),title:'Imported website photos',description:'Reviewed photos imported from the source website.',assetIds:[...new Set(ids)]});
  const catalog=site.draft.knowledgeRevisionId?(await readKnowledgeArtifact(user,siteId,site.draft.knowledgeRevisionId)).catalog:null;
  validateMediaLibrary(library,{entityIds:catalog?.entities.map(e=>e.id)??[],sectionIds:site.draft.sections.map(s=>s.id)});
  await writePrivateMedia(user,siteId,library);return library;
}
