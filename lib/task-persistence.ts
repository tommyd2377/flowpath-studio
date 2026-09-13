import 'server-only';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdminApp } from './firebase/admin';
import { getBackendMode } from './firebase/config';

export interface TaskDocuments {
  read(key: string): Promise<unknown | null>;
  create(key: string, value: unknown): Promise<void>;
  compareAndSwap(key: string, revision: number, value: unknown): Promise<void>;
}
const queues = new Map<string, Promise<unknown>>();
async function serial<T>(key: string, run: () => Promise<T>) {
  const previous = queues.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(run); queues.set(key, pending);
  try { return await pending; } finally { if (queues.get(key) === pending) queues.delete(key); }
}
const keyCheck = (key: string) => { if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,200}$/.test(key)) throw new Error('Invalid storage identity.'); return key; };
function documentText(value: unknown) { const text = JSON.stringify(value); if (Buffer.byteLength(text) > 650_000) throw new Error('Document exceeds bounded storage.'); return text; }
export function localTaskDocuments(directory: string): TaskDocuments {
  const path = (key: string) => join(directory, `${keyCheck(key)}.json`);
  const read = async (key: string) => { try { return JSON.parse(await readFile(path(key), 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } };
  return { read,
    async create(key, value) { await mkdir(directory, { recursive: true }); await writeFile(path(key), documentText(value), { flag: 'wx', mode: 0o600 }); },
    async compareAndSwap(key, revision, value) { return serial(path(key), async () => {
      const current = await read(key) as { revision?: number } | null;
      if (current?.revision !== revision) throw new Error('State changed in another request. Reload.');
      const temporary = `${path(key)}.${randomUUID()}.tmp`; await writeFile(temporary, documentText(value), { mode: 0o600 }); await rename(temporary, path(key));
    }); },
  };
}
export interface CloudTaskTransport { get(key: string): Promise<unknown | null>; create(key: string, value: unknown): Promise<void>; cas(key: string, revision: number, value: unknown): Promise<void> }
export function cloudTaskDocuments(transport: CloudTaskTransport): TaskDocuments {
  return { read: key => transport.get(keyCheck(key)), create: async (key, value) => { documentText(value); await transport.create(keyCheck(key), value); },
    compareAndSwap: async (key, revision, value) => { documentText(value); await transport.cas(keyCheck(key), revision, value); } };
}
export function taskDocuments(namespace: 'visitorTaskSessions' | 'visitorTaskAdapters' | 'catalogPublications' | 'catalogReviews') {
  if (getBackendMode() === 'demo') return localTaskDocuments(process.env.VOICE_DATA_DIR ? join(/* turbopackIgnore: true */ process.env.VOICE_DATA_DIR, namespace) : join(process.cwd(), 'data', namespace));
  const collection = getFirestore(getFirebaseAdminApp()).collection(namespace);
  return cloudTaskDocuments({
    get: async key => (await collection.doc(key).get()).data()?.value ?? null,
    create: async (key, value) => { await collection.doc(key).create({ revision: (value as { revision?: number })?.revision ?? 0, value: JSON.parse(documentText(value)) }); },
    cas: async (key, revision, value) => { await collection.firestore.runTransaction(async transaction => {
      const reference = collection.doc(key), existing = (await transaction.get(reference)).data();
      if (existing?.revision !== revision) throw new Error('State changed in another request. Reload.');
      transaction.set(reference, { revision: (value as { revision?: number })?.revision ?? 0, value: JSON.parse(documentText(value)) });
    }); },
  });
}
