import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { VoiceDatabase } from './production-voice-store';

/** Synthetic, single-process development adapter. Production always uses Firestore transactions. */
export function createFixturePaidDatabase(directory: string): VoiceDatabase {
  let pending = Promise.resolve();
  const file = join(directory, 'paid-test-fixtures.json');
  return { async transaction(work) {
    const prior = pending;
    let release!: () => void;
    pending = new Promise<void>(resolve => { release = resolve; });
    await prior;
    try {
      let rows: Record<string, Record<string, unknown>> = {};
      try { rows = JSON.parse(await readFile(file, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      let changed = false;
      const result = await work({ get: async key => structuredClone(rows[key] ?? null),
        set: (key, value) => { changed = true; rows[key] = structuredClone(value) as Record<string, unknown>; } });
      if (changed) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = `${file}.${randomUUID()}.tmp`;
        try { await writeFile(temporary, JSON.stringify(rows), { flag: 'wx', mode: 0o600 }); await rename(temporary, file); }
        finally { await rm(temporary, { force: true }); }
      }
      return result;
    } finally { release(); }
  } };
}
