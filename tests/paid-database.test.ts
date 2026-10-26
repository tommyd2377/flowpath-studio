import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixturePaidDatabase } from '../lib/paid-database';

test('synthetic ledger persists across restart and atomically rolls back failed transactions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-paid-database-'));
  try {
    const db = createFixturePaidDatabase(directory);
    await db.transaction(async tx => { tx.set('synthetic/test', { seconds: 900 }); });
    await assert.rejects(db.transaction(async tx => { tx.set('synthetic/test', { seconds: -500 }); throw new Error('rollback'); }));
    const restarted = createFixturePaidDatabase(directory);
    assert.equal((await restarted.transaction(tx => tx.get('synthetic/test')))?.seconds, 900);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
