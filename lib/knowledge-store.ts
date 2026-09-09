import 'server-only';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { getFirebaseAdminApp } from './firebase/admin';
import { getBackendMode } from './firebase/config';
import type { WorkspaceUser } from './firebase/types';
import { withDatabase } from './local-store';
import { AppError } from './errors';
import { hashValue, type KnowledgeArtifact, type KnowledgeLedger } from './knowledge-model';
import { validateCatalog, type KnowledgeCatalog } from '@thevoice/platform-ui/contracts';

const uuid = z.string().uuid();
const queues = globalThis as typeof globalThis & { knowledgeQueue?: Promise<unknown> };
const root = () => process.env.VOICE_DATA_DIR || join(process.cwd(), 'data');
const emptyLedger = (): KnowledgeLedger => ({ schemaVersion: 1, jobs: [] });
const validateUser = (user: WorkspaceUser) => {
  if (!user.uid || user.mode !== getBackendMode() || user.mode === 'demo' && user.uid !== 'local-demo') throw new AppError('Sign in to access your workspace.', 401);
};
const privateKey = (uid: string, siteId: string) => `${hashValue(uid)}-${uuid.parse(siteId)}`;
const artifactKey = (siteId: string, id: string) => `${uuid.parse(siteId)}-${uuid.parse(id)}`;
const directory = (uid: string, siteId: string) => join(root(), 'knowledge', privateKey(uid, siteId));
const validateSize = (value: unknown) => {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 700_000) throw new AppError('This knowledge artifact exceeds the pilot storage limit. Split the catalog or remove unused records; nothing was truncated.', 413);
  return text;
};
async function readOptional(path: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function atomicWrite(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, validateSize(value), { mode: 0o600 });
  await rename(temporary, path);
}
function ledger(value: unknown): KnowledgeLedger {
  if (value === undefined) return emptyLedger();
  const result = z.object({ schemaVersion: z.literal(1), jobs: z.array(z.object({
    id: uuid, fileId: uuid.optional(), operation: z.enum(['source', 'review']).optional(), sourceName: z.string(), sourceHash: z.string(), baseDraftHash: z.string(), baseRevision: z.number().int().positive(),
    status: z.enum(['running', 'needs_review', 'applied', 'discarded', 'failed', 'interrupted']), stage: z.enum(['extracting', 'interpreting', 'review']),
    claim: uuid, startedAt: z.number(), updatedAt: z.number(), message: z.string(), candidateRevisionId: uuid.optional(), appliedRevisionId: uuid.optional(), paidAttempt: z.boolean().optional(),
  }).strict()).max(50) }).strict().safeParse(value);
  if (!result.success) throw new AppError('Knowledge processing status could not be validated. Existing published content is unchanged.', 503);
  return result.data;
}

export async function readKnowledgeLedger(user: WorkspaceUser, siteId: string) {
  validateUser(user);
  if (user.mode === 'firebase') {
    const record = await getFirestore(getFirebaseAdminApp()).collection('voiceKnowledgeJobs').doc(privateKey(user.uid, siteId)).get();
    const data = record.data();
    if (data && data.ownerId !== user.uid) throw new AppError('Site not found.', 404);
    return ledger(data?.ledger);
  }
  return ledger(await readOptional(join(directory(user.uid, siteId), 'jobs.json')));
}

export async function changeKnowledgeLedger<T>(user: WorkspaceUser, siteId: string, operation: (state: KnowledgeLedger) => T): Promise<T> {
  validateUser(user);
  if (user.mode === 'firebase') {
    const db = getFirestore(getFirebaseAdminApp()); const ref = db.collection('voiceKnowledgeJobs').doc(privateKey(user.uid, siteId));
    return db.runTransaction(async transaction => {
      const data = (await transaction.get(ref)).data();
      if (data && data.ownerId !== user.uid) throw new AppError('Site not found.', 404);
      const state = ledger(data?.ledger); const result = operation(state); validateSize(state);
      transaction.set(ref, { ownerId: user.uid, siteId, ledger: state });
      return result;
    }, { maxAttempts: 3 });
  }
  const result = (queues.knowledgeQueue ?? Promise.resolve()).then(async () => {
    const dir = directory(user.uid, siteId); const path = join(dir, 'jobs.json');
    const state = ledger(await readOptional(path)); const result = operation(state);
    await mkdir(dir, { recursive: true }); await atomicWrite(path, state); return result;
  });
  queues.knowledgeQueue = result.catch(() => undefined);
  return result;
}

/** Keep local claim changes serialized with Apply; site writes use their own inner queue. */
export async function applyLocalKnowledgeClaim<T>(user: WorkspaceUser, siteId: string, jobId: string, claim: string, operation: () => Promise<T>): Promise<T> {
  validateUser(user);
  if (user.mode !== 'demo') throw new AppError('Local Apply is only available in the local backend.');
  const result = (queues.knowledgeQueue ?? Promise.resolve()).then(async () => {
    const dir = directory(user.uid, siteId); const path = join(dir, 'jobs.json');
    const state = ledger(await readOptional(path));
    const job = state.jobs.find(item => item.id === jobId);
    if (!job || job.status !== 'running' || job.stage !== 'review' || job.claim !== claim) throw new AppError('This Apply was superseded. Reload the interpretation.', 409);
    const result = await operation();
    job.status = 'applied'; job.appliedRevisionId = job.candidateRevisionId; job.updatedAt = Date.now(); job.message = 'Applied to draft. Review the preview and publish when ready.';
    await atomicWrite(path, state);
    return result;
  });
  queues.knowledgeQueue = result.catch(() => undefined);
  return result;
}

export async function writeKnowledgeArtifact(user: WorkspaceUser, siteId: string, artifact: KnowledgeArtifact) {
  validateUser(user); uuid.parse(artifact.id); validateCatalog(artifact.catalog);
  if (artifact.catalog.id !== artifact.id) throw new AppError('Knowledge revision identity does not match.');
  const text = validateSize(artifact);
  if (user.mode === 'firebase') {
    const ref = getFirestore(getFirebaseAdminApp()).collection('voiceKnowledgePrivate').doc(`${privateKey(user.uid, siteId)}-${artifact.id}`);
    await ref.create({ ownerId: user.uid, siteId, artifact: JSON.parse(text) });
  } else {
    const dir = directory(user.uid, siteId); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${artifact.id}.json`), text, { flag: 'wx', mode: 0o600 });
  }
}

export async function readKnowledgeArtifact(user: WorkspaceUser, siteId: string, id: string): Promise<KnowledgeArtifact> {
  validateUser(user); uuid.parse(id);
  let value: unknown;
  if (user.mode === 'firebase') {
    const data = (await getFirestore(getFirebaseAdminApp()).collection('voiceKnowledgePrivate').doc(`${privateKey(user.uid, siteId)}-${id}`).get()).data();
    if (data?.ownerId !== user.uid || data?.siteId !== siteId) throw new AppError('Knowledge revision not found.', 404);
    value = data.artifact;
  } else value = await readOptional(join(directory(user.uid, siteId), `${id}.json`));
  if (!value || typeof value !== 'object' || !('id' in value) || value.id !== id || !('catalog' in value) || !('origins' in value) || !Array.isArray(value.origins) || !('notes' in value) || !Array.isArray(value.notes)) throw new AppError('Knowledge revision could not be validated.', 503);
  const artifact = value as KnowledgeArtifact;
  return { ...artifact, catalog: validateCatalog(artifact.catalog) };
}

/** Stage a separate, source-free immutable public projection. Serving still requires publication. */
export async function stagePublicKnowledge(user: WorkspaceUser, siteId: string, id: string) {
  const { catalog } = await readKnowledgeArtifact(user, siteId, id);
  const publicCatalog = validateCatalog(JSON.parse(JSON.stringify(catalog)));
  const key = artifactKey(siteId, id); const text = validateSize(publicCatalog);
  if (user.mode === 'firebase') {
    const ref = getFirestore(getFirebaseAdminApp()).collection('voiceKnowledgePublic').doc(key);
    await getFirestore(getFirebaseAdminApp()).runTransaction(async transaction => {
      const previous = await transaction.get(ref);
      if (previous.exists) {
        if (hashValue(previous.data()?.catalog) !== hashValue(publicCatalog)) throw new AppError('An immutable public revision changed.', 409);
      } else transaction.create(ref, { siteId, revisionId: id, catalog: publicCatalog });
    });
  } else {
    const dir = join(root(), 'knowledge-public'); await mkdir(dir, { recursive: true });
    const path = join(dir, `${key}.json`);
    try { await writeFile(path, text, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || hashValue(await readOptional(path)) !== hashValue(publicCatalog)) throw error;
    }
  }
  return id;
}

export async function getPublishedKnowledge(siteId: string, revisionId?: string): Promise<KnowledgeCatalog | null> {
  if (!revisionId) return null;
  const key = artifactKey(siteId, revisionId);
  if (getBackendMode() === 'firebase') {
    const db = getFirestore(getFirebaseAdminApp());
    // Authorize against current publication before serving a staged public projection.
    const privateSite = (await db.collection('voiceSites').doc(siteId).get()).data();
    const site = privateSite && typeof privateSite.state === 'string' ? JSON.parse(privateSite.state) : null;
    if (site?.id !== siteId || site?.published?.knowledgeRevisionId !== revisionId) throw new AppError('The published knowledge revision has changed. Reload this site.', 409);
    const data = (await db.collection('voiceKnowledgePublic').doc(key).get()).data();
    if (data?.siteId !== siteId || data?.revisionId !== revisionId) throw new AppError('Published knowledge is unavailable.', 503);
    return validateCatalog(data.catalog);
  }
  const permitted = await withDatabase(db => db.sites.some(site => site.id === siteId && site.published?.knowledgeRevisionId === revisionId));
  if (!permitted) throw new AppError('The published knowledge revision has changed. Reload this site.', 409);
  const catalog = await readOptional(join(root(), 'knowledge-public', `${key}.json`));
  if (!catalog) throw new AppError('Published knowledge is unavailable.', 503);
  return validateCatalog(catalog);
}

export const getPublicKnowledge = getPublishedKnowledge;

export async function getKnowledgeCatalogForSite(user: WorkspaceUser, siteId: string): Promise<KnowledgeCatalog | null> {
  // Lazy import avoids a storage facade cycle with the publication hook.
  const { getSite } = await import('./site-store');
  const site = await getSite(user, siteId);
  return site.draft.knowledgeRevisionId ? (await readKnowledgeArtifact(user, siteId, site.draft.knowledgeRevisionId)).catalog : null;
}
