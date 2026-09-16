import 'server-only';
import { z } from 'zod';
import { getBackendMode } from './firebase/config';
import type { WorkspaceUser } from './firebase/types';
import { AppError } from './errors';
import { clientSite, createSite, findSite, pruneMediaReferences, withDatabase, type StoredFile, type StoredSite } from './local-store';
import { summarize } from './site-model';
import { assertUploadAllowed } from './file-validation';
import { createCloudSite, downloadCloudFile, downloadCloudPublishedImage, getCloudPublished, getCloudSite,
  listCloudSites, modifyCloudSite, reserveCloudAiRequest, uploadCloudFile, type PublishedSite } from './cloud-store';
import type { KnowledgeClaim } from './cloud-store';
import { readLocalImage, removeLocalImage, saveLocalImage, saveLocalVideo, readLocalVideo } from './media-store';
import { processImage } from './image-processing';
import { assertNoStripeTestPaidAi } from './billing-ai-guard';

const idSchema = z.string().uuid();
export const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(50);
export const newSiteSchema = z.object({ name: z.string().trim().min(1).max(80), slug: slugSchema,
  kind: z.enum(['general', 'photographer', 'florist']) }).strict();

function isCloud(user: WorkspaceUser) {
  const mode = getBackendMode();
  if (user.mode !== mode || !user.uid || (mode === 'demo' && user.uid !== 'local-demo')) throw new AppError('Sign in to access your workspace.', 401);
  return mode === 'firebase';
}

export async function listSites(user: WorkspaceUser) {
  return isCloud(user) ? listCloudSites(user.uid) : withDatabase(db => db.sites.filter(site => site.ownerId === user.uid).map(summarize));
}

export async function getSite(user: WorkspaceUser, id: string): Promise<StoredSite> {
  idSchema.parse(id);
  return isCloud(user) ? getCloudSite(user.uid, id) : withDatabase(db => findSite(db, id));
}

export async function reserveAiRequest(user: WorkspaceUser, id: string, revision: number, requestId: string) {
  idSchema.parse(id); idSchema.parse(requestId);
  if (!isCloud(user)) throw new AppError('AI requests require a signed-in Firebase workspace.', 403);
  await assertNoStripeTestPaidAi(id, user.uid);
  return reserveCloudAiRequest(user.uid, id, revision, requestId);
}

export async function newSite(user: WorkspaceUser, input: z.infer<typeof newSiteSchema>) {
  const { name, slug, kind } = newSiteSchema.parse(input);
  if (['app', 'www', 'admin', 'api', 'dashboard', 'billing', 'support', 'preview'].includes(slug)) throw new AppError('That address is reserved. Choose another.');
  return isCloud(user) ? createCloudSite(user.uid, name, slug, kind) : withDatabase(db => createSite(db, name, slug, kind));
}

export async function modifySite(user: WorkspaceUser, id: string, revision: number, operation: (site: StoredSite) => void, knowledgeClaim?: KnowledgeClaim) {
  idSchema.parse(id);
  if (isCloud(user)) return modifyCloudSite(user.uid, id, revision, operation, knowledgeClaim);
  const result = await withDatabase(db => {
    const site = findSite(db, id);
    if (site.revision !== revision) throw new AppError('This site changed in another tab. Reload the site before trying again.', 409);
    const previous = [...site.files];
    operation(site); pruneMediaReferences(site); site.revision++;
    return { site: clientSite(site), removed: previous.filter(file => !site.files.some(current => current.id === file.id)) };
  });
  for (const file of result.removed) await removeLocalImage(user.uid, id, file).catch(() => undefined);
  return result.site;
}

export async function uploadFile(user: WorkspaceUser, id: string, revision: number, file: StoredFile) {
  idSchema.parse(id);
  if (isCloud(user)) return uploadCloudFile(user.uid, id, revision, file);
  assertUploadAllowed(await getSite(user, id), revision, file);
  const stored = file.kind === 'video' ? await saveLocalVideo(user.uid, id, file) : file.kind === 'image' && file.thumbnailData && file.originalData ? await saveLocalImage(user.uid, id, file) : file;
  try { return await modifySite(user, id, revision, site => { assertUploadAllowed(site, revision, stored); site.files.push(stored); }); }
  catch (error) { if (error instanceof AppError) await removeLocalImage(user.uid, id, stored); throw error; }
}

export async function downloadFile(user: WorkspaceUser, id: string, fileId: string, size: 'display' | 'thumb' = 'display') {
  idSchema.parse(fileId);
  const site = await getSite(user, id);
  const file = site.files.find(file => file.id === fileId);
  if (!file) throw new AppError('File not found.', 404);
  const bytes = isCloud(user) ? await downloadCloudFile(user.uid, id, file, size)
    : file.localVideo ? await readLocalVideo(user.uid, id, file.id) : file.localImage ? await readLocalImage(user.uid, id, file.id, size) : new Uint8Array(Buffer.from(file.data!, 'base64'));
  if (file.kind === 'image' && !file.localImage && !file.thumbnailObjectPath) {
    const sanitized = await processImage(bytes);
    return { file: { ...file, mime: 'image/webp', image: sanitized.image }, bytes: new Uint8Array(size === 'thumb' ? sanitized.thumbnail : sanitized.display) };
  }
  return { file, bytes };
}

export async function getPublished(slug: string): Promise<PublishedSite | null> {
  if (!slugSchema.safeParse(slug).success) return null;
  if (getBackendMode() === 'firebase') return getCloudPublished(slug);
  return withDatabase(db => {
    const site = db.sites.find(site => site.slug === slug && site.ownerId === 'local-demo');
    return site?.published ? { siteId: site.id, slug, content: site.published, publishedAt: site.publishedAt!,
      logo: site.files.find(file => file.id === site.published?.logoAssetId && file.kind === 'image') ?? null,
      mediaFiles: site.files.filter(file => ['image', 'video'].includes(file.kind) && site.published?.mediaRevisionId && site.mediaRefs?.[site.published.mediaRevisionId]?.includes(file.id)) } : null;
  });
}

export async function downloadPublishedLogo(slug: string, fileId: string) {
  const site = await getPublished(slug);
  if (site?.logo?.id !== fileId) throw new AppError('File not found.', 404);
  return downloadPublishedFile(slug, fileId);
}

export async function downloadPublishedFile(slug: string, fileId: string, size: 'display' | 'thumb' = 'display') {
  idSchema.parse(fileId);
  const site = await getPublished(slug);
  if (!site) throw new AppError('File not found.', 404);
  const isLogo = site.logo?.id === fileId && site.content.logoAssetId === fileId;
  // The current published snapshot carries the approved file allowlist, written
  // atomically with its content. Do not reread a full manifest per thumbnail.
  if (!isLogo && !(site.content.mediaRevisionId && site.mediaFiles?.some(file => file.id === fileId))) throw new AppError('File not found.', 404);
  if (getBackendMode() === 'firebase') return downloadCloudPublishedImage(site, fileId, size);
  const file = isLogo ? site.logo! : site.mediaFiles?.find(file => file.id === fileId);
  if (file?.kind === 'video') return { file, bytes: file.localVideo ? await readLocalVideo('local-demo', site.siteId, fileId) : new Uint8Array(Buffer.from(file.data!, 'base64')) };
  if (!file || file.kind !== 'image') throw new AppError('File not found.', 404);
  if (file.localImage) return { file, bytes: await readLocalImage('local-demo', site.siteId, fileId, size) };
  const sanitized = await processImage(new Uint8Array(Buffer.from(file.data!, 'base64')));
  return { file: { ...file, mime: 'image/webp' }, bytes: new Uint8Array(size === 'thumb' ? sanitized.thumbnail : sanitized.display) };
}
