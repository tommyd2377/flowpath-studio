import type { WebsiteMigration } from './website-migration-model';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeWebsiteContent, contentSchema, sampleContent, type Site, type SiteContent, type SiteFile } from './site-model';
import { AppError } from './errors';
import type { VisitorLedger } from './visitor-quota';
import { DEFAULT_VISITOR_SETTINGS } from './visitor-model';
import { DEFAULT_OPENING } from './site-opening';
import { WEBSITE_TEMPLATES } from '@thevoice/platform-ui/site-design';

export { AppError } from './errors';
export type StoredFile = SiteFile & { data?: string; text?: string; objectPath?: string; thumbnailData?: string; originalData?: string;
  thumbnailObjectPath?: string; originalObjectPath?: string; originalSize?: number; localImage?: boolean; localVideo?: boolean };
export type StoredSite = Omit<Site, 'files'> & { files: StoredFile[]; mediaRefs?: Record<string, string[]>; websiteMigration?: WebsiteMigration };
type Database = { schemaVersion: 1; sites: StoredSite[]; visitorUsage?: VisitorLedger };
const globalStore = globalThis as typeof globalThis & { voiceStoreQueue?: Promise<unknown> };
const directory = () => process.env.VOICE_DATA_DIR || join(process.cwd(), 'data');

export function initialSite(kind: 'general' | 'photographer' | 'florist', name?: string, slug?: string, ownerId = 'local-demo'): StoredSite {
  return { id: randomUUID(), slug: slug || (kind === 'photographer' ? 'sophie-chen' : 'stem-and-story'),
    ownerId, template: 'voice-v1', revision: 1, draft: { ...sampleContent(kind, name), style: { ...WEBSITE_TEMPLATES.clarity.defaults, entry: 'website' }, opening: { ...DEFAULT_OPENING }, visitor: { ...DEFAULT_VISITOR_SETTINGS } }, published: null,
    publishedAt: null, history: [], files: [], messages: [{ id: randomUUID(), role: 'assistant', createdAt: new Date().toISOString(),
      text: 'Your site is ready to make your own. Describe a change, add a file, or use the Branding and Content panels. Review proposed edits before applying them to your draft, then publish when you are ready.' }] };
}

async function readDatabase(): Promise<Database> {
  try { return JSON.parse(await readFile(join(directory(), 'workspace.json'), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { schemaVersion: 1, sites: [initialSite('photographer'), initialSite('florist')] };
  }
}

// Serialize reads and writes, then atomically replace the file. Local single-process store only.
export function withDatabase<T>(operation: (db: Database) => T | Promise<T>): Promise<T> {
  const result = (globalStore.voiceStoreQueue ?? Promise.resolve()).then(async () => {
    const db = await readDatabase();
    const value = await operation(db);
    await mkdir(directory(), { recursive: true });
    const path = join(directory(), `workspace-${randomUUID()}.tmp`);
    await writeFile(path, JSON.stringify(db), { mode: 0o600 });
    await rename(path, join(directory(), 'workspace.json'));
    return value;
  });
  globalStore.voiceStoreQueue = result.catch(() => undefined);
  return result;
}

export function findSite(db: Database, id: string) {
  const site = db.sites.find(site => site.id === id && site.ownerId === 'local-demo');
  if (!site) throw new AppError('Site not found.', 404);
  return site;
}

export function clientSite(site: StoredSite): Site {
  const { mediaRefs: privateReferences, websiteMigration: privateMigration, ...client } = site;
  void privateReferences; void privateMigration;
  return { ...client, files: site.files.map(({ id, name, mime, size, uploadedAt, kind, image }) => ({ id, name, mime, size, uploadedAt, kind, ...(image ? { image } : {}) })) };
}

export function retainedMediaReferences(site: StoredSite): string[] {
  return [...new Set([site.draft, site.published, ...site.history].flatMap(content => content?.mediaRevisionId ? [content.mediaRevisionId] : []))];
}
export function pruneMediaReferences(site: StoredSite) {
  if (site.mediaRefs) site.mediaRefs = Object.fromEntries(retainedMediaReferences(site).flatMap(id => site.mediaRefs?.[id] ? [[id, site.mediaRefs[id]]] : []));
}

export function updateDraft(site: StoredSite, content: SiteContent) {
  const parsed = contentSchema.parse(nativeWebsiteContent(content));
  if (parsed.logoAssetId && !site.files.some(file => file.id === parsed.logoAssetId && file.kind === 'image')) {
    throw new AppError('Choose a logo uploaded to this site.');
  }
  if (JSON.stringify(site.draft) === JSON.stringify(parsed)) return;
  site.history = [...site.history, structuredClone(site.draft)].slice(-20);
  site.draft = parsed;
}

export function createSite(db: Database, name: string, slug: string, kind: 'general' | 'photographer' | 'florist') {
  if (['app', 'www', 'admin', 'api', 'dashboard', 'billing', 'support', 'preview'].includes(slug)) throw new AppError('That address is reserved. Choose another.');
  if (db.sites.some(site => site.slug === slug)) throw new AppError('That address is already in use.', 409);
  if (db.sites.length >= 12) throw new AppError('This local workspace supports up to 12 sites.');
  const site = initialSite(kind, name, slug);
  db.sites.push(site);
  return clientSite(site);
}
