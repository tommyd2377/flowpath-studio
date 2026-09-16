import 'server-only';
import { createHash } from 'node:crypto';
import { getFirestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getFirebaseAdminApp } from './firebase/admin';
import { AppError } from './errors';
import { clientSite, initialSite, pruneMediaReferences, type StoredFile, type StoredSite } from './local-store';
import { summarize, type SiteSummary } from './site-model';
import { assertUploadAllowed } from './file-validation';
import { AI_DAILY_LIMIT, AI_GLOBAL_DAILY_LIMIT } from './editor-types';
import type { KnowledgeLedger } from './knowledge-model';
import { processImage } from './image-processing';

export type KnowledgeClaim = { jobId: string; claim: string };

export type PublishedSite = {
  siteId: string; slug: string; content: StoredSite['draft']; publishedAt: string;
  logo: StoredFile | null;
  mediaFiles?: StoredFile[];
};
const database = () => getFirestore(getFirebaseAdminApp());
const bucket = () => getStorage(getFirebaseAdminApp()).bucket();
const ownerKey = (uid: string) => createHash('sha256').update(uid).digest('hex');
const objectPath = (uid: string, siteId: string, fileId: string) => `owners/${ownerKey(uid)}/sites/${siteId}/${fileId}`;

function ownedSite(snapshot: DocumentSnapshot, uid: string): StoredSite {
  const data = snapshot.data();
  if (!data || data.ownerId !== uid) throw new AppError('Site not found.', 404);
  const site = JSON.parse(data.state) as StoredSite;
  if (site.ownerId !== uid || site.id !== snapshot.id) throw new AppError('Site not found.', 404);
  return site;
}

function siteDocument(site: StoredSite) {
  // Keep each document below Firestore's 1 MiB limit, including UTF-8 expansion.
  // Only old chat/history can be trimmed; uploaded text and current content remain intact.
  let state = JSON.stringify(site);
  while (Buffer.byteLength(state) > 750_000 && (site.messages.length > 2 || site.history.length > 0)) {
    if (site.messages.length > 2) site.messages.splice(0, 2);
    else site.history.shift();
    state = JSON.stringify(site);
  }
  if (Buffer.byteLength(state) > 750_000) throw new AppError('This site has reached its saved-content limit. Remove an unused text file or shorten the content.', 413);
  return { ...summarize(site), ownerId: site.ownerId, state };
}

function publishedSnapshot(site: StoredSite): PublishedSite {
  const file = site.files.find(file => file.id === site.published?.logoAssetId && file.kind === 'image');
  const mediaIds = site.published?.mediaRevisionId ? site.mediaRefs?.[site.published.mediaRevisionId] ?? [] : [];
  const descriptor = (file: StoredFile): StoredFile => ({ id: file.id, name: file.name, mime: file.mime, size: file.size, kind: file.kind,
    uploadedAt: file.uploadedAt, ...(file.objectPath ? { objectPath: file.objectPath } : {}), ...(file.thumbnailObjectPath ? { thumbnailObjectPath: file.thumbnailObjectPath } : {}) });
  return { siteId: site.id, slug: site.slug, content: site.published!, publishedAt: site.publishedAt!,
    logo: file ? descriptor(file) : null, mediaFiles: site.files.filter(file => ['image', 'video'].includes(file.kind) && mediaIds.includes(file.id)).map(descriptor) };
}

export async function listCloudSites(uid: string): Promise<SiteSummary[]> {
  const result = await database().collection('voiceSites').where('ownerId', '==', uid).limit(12)
    .select('id', 'slug', 'revision', 'publishedAt', 'name', 'accent', 'dirty').get();
  return result.docs.map(doc => doc.data() as SiteSummary);
}

export async function getCloudSite(uid: string, id: string) {
  return ownedSite(await database().collection('voiceSites').doc(id).get(), uid);
}

export async function reserveCloudAiRequest(uid: string, id: string, revision: number, requestId: string): Promise<void> {
  const db = database();
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const owner = ownerKey(uid);
  const requestKey = createHash('sha256').update(JSON.stringify([uid, requestId])).digest('hex');
  const siteRef = db.collection('voiceSites').doc(id);
  const requestRef = db.collection('voiceAiRequests').doc(requestKey);
  const ownerUsageRef = db.collection('voiceAiUsage').doc(`owner-${owner}-${day}`);
  const globalUsageRef = db.collection('voiceAiUsage').doc(`global-${day}`);
  const ownerCooldownRef = db.collection('voiceAiOwners').doc(owner);
  await db.runTransaction(async transaction => {
    const [siteRecord, requestRecord, ownerUsage, globalUsage, ownerCooldown] = await transaction.getAll(
      siteRef, requestRef, ownerUsageRef, globalUsageRef, ownerCooldownRef,
    );
    const site = ownedSite(siteRecord, uid);
    if (site.revision !== revision) throw new AppError('This site changed in another tab. Reload the site before trying again.', 409);
    if (requestRecord.exists) throw new AppError('This AI request was already received. Reload the site to check for its proposal.', 409);
    const ownerAttempts = ownerUsage.data()?.attempts ?? 0;
    const globalAttempts = globalUsage.data()?.attempts ?? 0;
    const activeUntil = ownerCooldown.data()?.activeUntil ?? 0;
    if (![ownerAttempts, globalAttempts, activeUntil].every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new AppError('AI usage limits are temporarily unavailable. Please try again later.', 503);
    }
    if (ownerAttempts >= AI_DAILY_LIMIT) throw new AppError('You have reached the daily AI request limit. Try again after midnight UTC.', 429);
    if (globalAttempts >= AI_GLOBAL_DAILY_LIMIT) throw new AppError('The workspace has reached its daily AI request limit. Try again after midnight UTC.', 429);
    if (activeUntil > now) throw new AppError('An AI request was started recently. Wait a minute before trying again.', 429);
    // Count reservations, including failures. Never reclaim a request after an ambiguous outcome.
    transaction.create(requestRef, { ownerId: uid, siteId: id, requestId, revision, day, consumedAt: now });
    transaction.set(ownerUsageRef, { ownerId: uid, day, attempts: ownerAttempts + 1 });
    transaction.set(globalUsageRef, { day, attempts: globalAttempts + 1 });
    transaction.set(ownerCooldownRef, { ownerId: uid, activeUntil: now + 60_000 });
  }, { maxAttempts: 3 });
}

export async function createCloudSite(uid: string, name: string, slug: string, kind: 'general' | 'photographer' | 'florist') {
  const db = database();
  const site = initialSite(kind, name, slug, uid);
  const siteRef = db.collection('voiceSites').doc(site.id);
  const slugRef = db.collection('voiceSlugs').doc(slug);
  const ownerRef = db.collection('voiceOwners').doc(ownerKey(uid));
  await db.runTransaction(async transaction => {
    const [slugRecord, ownerRecord] = await transaction.getAll(slugRef, ownerRef);
    if (slugRecord.exists) throw new AppError('That address is already in use.', 409);
    const count = ownerRecord.data()?.siteCount ?? 0;
    if (count >= 12) throw new AppError('Each account supports up to 12 sites.');
    transaction.create(siteRef, siteDocument(site));
    transaction.create(slugRef, { siteId: site.id, ownerId: uid });
    transaction.set(ownerRef, { ownerId: uid, siteCount: count + 1 });
  }, { maxAttempts: 3 });
  return clientSite(site);
}

export async function modifyCloudSite(uid: string, id: string, revision: number, operation: (site: StoredSite) => void, knowledgeClaim?: KnowledgeClaim) {
  const db = database();
  const ref = db.collection('voiceSites').doc(id);
  const result = await db.runTransaction(async transaction => {
    const site = ownedSite(await transaction.get(ref), uid);
    if (site.revision !== revision) throw new AppError('This site changed in another tab. Reload the site before trying again.', 409);
    const jobRef = knowledgeClaim ? db.collection('voiceKnowledgeJobs').doc(`${ownerKey(uid)}-${id}`) : null;
    const jobRecord = jobRef ? (await transaction.get(jobRef)).data() : null;
    const ledger = jobRecord?.ledger as KnowledgeLedger | undefined;
    const job = knowledgeClaim && Array.isArray(ledger?.jobs) ? ledger.jobs.find(item => item.id === knowledgeClaim.jobId) : undefined;
    if (knowledgeClaim && (jobRecord?.ownerId !== uid || jobRecord?.siteId !== id || ledger?.schemaVersion !== 1
      || !job || job.status !== 'running' || job.stage !== 'review' || job.claim !== knowledgeClaim.claim || !job.candidateRevisionId)) {
      throw new AppError('This Apply was cancelled or superseded. Reload to review the current interpretation.', 409);
    }
    const previousPublished = site.publishedAt;
    const previousContent = JSON.stringify(site.published);
    const previousFiles = site.files;
    operation(site);
    pruneMediaReferences(site);
    if (knowledgeClaim && job && jobRef && ledger) {
      if (site.draft.knowledgeRevisionId !== job.candidateRevisionId) throw new AppError('Apply does not match the reviewed knowledge revision.', 409);
      job.status = 'applied'; job.appliedRevisionId = job.candidateRevisionId; job.updatedAt = Date.now();
      job.message = 'Applied to draft. Review the preview and publish when ready.';
      transaction.set(jobRef, { ownerId: uid, siteId: id, ledger });
    }
    site.revision++;
    transaction.set(ref, siteDocument(site));
    if (site.published && (site.publishedAt !== previousPublished || JSON.stringify(site.published) !== previousContent)) {
      transaction.set(db.collection('voicePublished').doc(site.slug), publishedSnapshot(site));
    }
    return { site: clientSite(site), removed: previousFiles.filter(file => !site.files.some(current => current.id === file.id)) };
  }, { maxAttempts: 3 });
  // Delete only after the reference is gone. A failed cleanup leaves a private orphan.
  for (const file of result.removed) await cleanupObject(uid, id, file);
  return result.site;
}

async function cleanupObject(uid: string, siteId: string, file: StoredFile) {
  const base = objectPath(uid, siteId, file.id);
  const allowed = new Set([base, `${base}/display.webp`, `${base}/thumb.webp`, `${base}/original`]);
  for (const path of [file.objectPath, file.thumbnailObjectPath, file.originalObjectPath]) {
    if (!path || !allowed.has(path)) continue;
    try { await bucket().file(path).delete({ ignoreNotFound: true }); }
    catch { console.warn('A private upload could not be cleaned up; storage cleanup is required.'); }
  }
}

export async function uploadCloudFile(uid: string, id: string, revision: number, file: StoredFile) {
  assertUploadAllowed(await getCloudSite(uid, id), revision, file);
  const base = objectPath(uid, id, file.id);
  const variants = file.kind === 'image' && file.thumbnailData && file.originalData;
  const path = variants ? `${base}/display.webp` : base;
  const stored: StoredFile = { id: file.id, name: file.name, mime: file.mime, size: file.size,
    kind: file.kind, uploadedAt: file.uploadedAt, objectPath: path, ...(file.text === undefined ? {} : { text: file.text }),
    ...(file.image ? { image: file.image } : {}), ...(file.video ? { video: file.video } : {}), ...(variants ? { thumbnailObjectPath: `${base}/thumb.webp`, originalObjectPath: `${base}/original`, originalSize: file.originalSize! } : {}) };
  await bucket().file(path).save(Buffer.from(file.data!, 'base64'), {
    resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 },
    metadata: { contentType: file.mime, cacheControl: 'private, no-store' },
  });
  try {
    if (variants) {
      await bucket().file(stored.thumbnailObjectPath!).save(Buffer.from(file.thumbnailData!, 'base64'), { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'image/webp', cacheControl: 'private, no-store' } });
      await bucket().file(stored.originalObjectPath!).save(Buffer.from(file.originalData!, 'base64'), { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' } });
    }
    return await modifyCloudSite(uid, id, revision, site => { assertUploadAllowed(site, revision, stored); site.files.push(stored); });
  } catch (error) {
    // Domain validation failures happen before commit. A transport error may mean
    // the commit succeeded: retain the private object until it can be reconciled.
    if (error instanceof AppError) await cleanupObject(uid, id, stored);
    throw error;
  }
}

export async function downloadCloudFile(uid: string, siteId: string, file: StoredFile, size: 'display' | 'thumb' = 'display') {
  const base = objectPath(uid, siteId, file.id);
  if (file.objectPath !== base && file.objectPath !== `${base}/display.webp`) throw new AppError('File not found.', 404);
  const path = size === 'thumb' && file.thumbnailObjectPath ? file.thumbnailObjectPath : file.objectPath;
  if (path !== base && path !== `${base}/display.webp` && path !== `${base}/thumb.webp`) throw new AppError('File not found.', 404);
  const [bytes] = await bucket().file(path).download();
  return new Uint8Array(bytes);
}

export async function getCloudPublished(slug: string): Promise<PublishedSite | null> {
  const doc = await database().collection('voicePublished').doc(slug).get();
  return doc.exists ? doc.data() as PublishedSite : null;
}

export async function downloadCloudPublishedImage(site: PublishedSite, fileId: string, size: 'display' | 'thumb' = 'display') {
  const file = site.logo?.id === fileId ? site.logo : site.mediaFiles?.find(file => file.id === fileId);
  if (!file || file.id !== fileId || !['image', 'video'].includes(file.kind) || !file.objectPath
    || !new RegExp(`^owners/[a-f0-9]{64}/sites/${site.siteId}/${file.id}(?:/display\\.webp)?$`).test(file.objectPath)) throw new AppError('File not found.', 404);
  const path = size === 'thumb' && file.thumbnailObjectPath ? file.thumbnailObjectPath : file.objectPath;
  if (path !== file.objectPath && path !== file.objectPath.replace(/\/display\.webp$/, '/thumb.webp')) throw new AppError('File not found.', 404);
  const [bytes] = await bucket().file(path).download();
  if (file.kind === 'video' || file.thumbnailObjectPath) return { file, bytes: new Uint8Array(bytes) };
  const sanitized = await processImage(bytes);
  return { file: { ...file, mime: 'image/webp' }, bytes: new Uint8Array(size === 'thumb' ? sanitized.thumbnail : sanitized.display) };
}

export async function downloadCloudPublishedLogo(site: PublishedSite, fileId: string) {
  if (site.logo?.id !== fileId || fileId !== site.content.logoAssetId) throw new AppError('File not found.', 404);
  return downloadCloudPublishedImage(site, fileId);
}
