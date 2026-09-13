import 'server-only';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { catalogForPublication, validateAssertionReviews } from './knowledge-assertions';
import { projectKnowledgeCatalog } from '@thevoice/platform-ui/knowledge';
import { getFirebaseAdminApp } from './firebase/admin';
import { getBackendMode } from './firebase/config';
import type { WorkspaceUser } from './firebase/types';
import { withDatabase } from './local-store';
import { AppError } from './errors';
import { hashValue, validateGraphCorrections, validateGraphUpdates, validateKnowledgeUpdates, validateKnowledgeUpdateContext, updateAnchorsSchema, sourceIdentityMatchSchema, type KnowledgeArtifact, type KnowledgeLedger } from './knowledge-model';
import { validateCatalog, type KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { validateSourceProvenance } from './source-provenance';
import { websiteProposalSchema } from './website-import-model';

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
function validateArtifact(value: unknown): KnowledgeArtifact {
  const parsed = z.object({ schemaVersion: z.literal(1), id: uuid, catalog: z.unknown(),
    origins: z.array(z.object({ key: z.string().min(1).max(255), fileId: uuid, name: z.string().min(1).max(255), hash: z.string().max(128),
      entityIds: z.array(z.string().min(1).max(80)).max(100), entityMap: z.record(z.string().min(1).max(80), z.string().min(1).max(80)).optional(), baseline: z.unknown(), provenance: z.unknown().optional(),
  }).strict()).max(50), notes: z.array(z.string().max(2000)).max(5000), updates: z.unknown().optional(), updateAnchors: z.unknown().optional(), updateContext: z.unknown().optional(), identityMatches: z.unknown().optional(), graphUpdates: z.unknown().optional(), correctionHistory: z.unknown().optional(),
    identityRemaps: z.record(z.string().min(1).max(80), z.string().min(1).max(80)).optional(), assertionReviews: z.unknown().optional(), website: websiteProposalSchema.optional(),
  }).strict().parse(value);
  const catalog = validateCatalog(parsed.catalog);
  if (catalog.id !== parsed.id) throw new AppError('Knowledge revision identity does not match.');
  if (new Set(parsed.origins.map(origin => origin.key)).size !== parsed.origins.length) throw new AppError('Knowledge contains duplicate source identities.');
  const origins = parsed.origins.map(({ baseline: rawBaseline, provenance, ...origin }) => {
    const baseline = validateCatalog(rawBaseline);
    if (new Set(origin.entityIds).size !== origin.entityIds.length || origin.entityIds.length !== baseline.entities.length
      || origin.entityIds.some(id => !baseline.entities.some(entity => entity.id === id))) throw new AppError('A source contains invalid item references.');
    if (origin.entityMap && (Object.keys(origin.entityMap).length > 100 || Object.values(origin.entityMap).some(id => !origin.entityIds.includes(id)))) throw new AppError('A source identity mapping is invalid.');
    return { ...origin, baseline, ...(provenance !== undefined ? { provenance: validateSourceProvenance(provenance, baseline) } : {}) };
  });
  const updateAnchors = updateAnchorsSchema.parse(parsed.updateAnchors ?? []);
  const updateContext = validateKnowledgeUpdateContext(parsed.updateContext ?? { collections: [], relationships: [], capabilities: [] });
  const identityMatches = sourceIdentityMatchSchema.array().max(500).parse(parsed.identityMatches ?? []);
  if (new Set(identityMatches.map(match => match.id)).size !== identityMatches.length) throw new AppError('Knowledge contains duplicate identity matches.');
  // Decided suggestions remain historical even if an item is subsequently removed.
  if (identityMatches.some(match => !match.decision && !catalog.entities.some(entity => entity.id === match.canonicalEntityId))) throw new AppError('Knowledge identity matches reference unavailable entities.');
  if (parsed.identityRemaps && Object.keys(parsed.identityRemaps).length > 100) throw new AppError('Identity remaps exceed the catalog limit.');
  for (const id of Object.keys(parsed.identityRemaps ?? {})) {
    const seen = new Set<string>(); let current = id;
    while (parsed.identityRemaps && Object.hasOwn(parsed.identityRemaps, current)) {
      if (seen.has(current)) throw new AppError('Identity remaps contain a cycle.');
      seen.add(current); current = parsed.identityRemaps[current];
    }
  }
  const correctionHistory = validateGraphCorrections(parsed.correctionHistory ?? []);
  if (correctionHistory.some(entry => entry.anchorIds?.some(id => !updateAnchors.some(anchor => anchor.id === id)))) throw new AppError('Correction history references an unavailable source excerpt.');
  return { ...parsed, catalog, origins, updateAnchors, updateContext, identityMatches, updates: validateKnowledgeUpdates(parsed.updates ?? [], catalog, updateContext, updateAnchors),
    graphUpdates: validateGraphUpdates(parsed.graphUpdates ?? [], catalog, updateAnchors), correctionHistory,
    assertionReviews: parsed.assertionReviews !== undefined ? validateAssertionReviews(parsed.assertionReviews, catalog) : undefined };
}
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
    id: uuid, fileId: uuid.optional(), sourceUrl: z.string().url().max(2048).optional(), operation: z.enum(['source', 'review', 'website']).optional(), sourceName: z.string(), sourceHash: z.string(), baseDraftHash: z.string(), baseRevision: z.number().int().positive(),
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
  validateUser(user);
  const text = validateSize(validateArtifact(artifact));
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
  try {
    validateSize(value);
    const artifact = validateArtifact(value);
    if (artifact.id !== id) throw new Error('Knowledge revision identity does not match.');
    return artifact;
  } catch { throw new AppError('Knowledge revision could not be validated.', 503); }
}

/** Stage a separate, source-free immutable public projection. Serving still requires publication. */
export async function stagePublicKnowledge(user: WorkspaceUser, siteId: string, id: string) {
  const publicCatalog = catalogForPublication(await readKnowledgeArtifact(user, siteId, id));
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

/** Full approved assertions, authorized against the current publication. Time
 * projection must happen AFTER a retrieval request supplies its as-of date. */
export async function getPublishedKnowledgeSnapshot(siteId: string, revisionId?: string): Promise<KnowledgeCatalog | null> {
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

export async function getPublishedKnowledge(siteId: string, revisionId?: string): Promise<KnowledgeCatalog | null> {
  const catalog = await getPublishedKnowledgeSnapshot(siteId, revisionId);
  return catalog ? projectKnowledgeCatalog(catalog) : null;
}

export const getPublicKnowledge = getPublishedKnowledge;

export async function getKnowledgeCatalogForSite(user: WorkspaceUser, siteId: string): Promise<KnowledgeCatalog | null> {
  // Lazy import avoids a storage facade cycle with the publication hook.
  const { getSite } = await import('./site-store');
  const site = await getSite(user, siteId);
  return site.draft.knowledgeRevisionId ? (await readKnowledgeArtifact(user, siteId, site.draft.knowledgeRevisionId)).catalog : null;
}
