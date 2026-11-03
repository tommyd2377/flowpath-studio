import { waveformRecord } from './account-server';
import type { Waveform } from './account-model';
import { CreationSafetyError, creationContentDigest } from './creation-safety';
import type { VoiceDatabase, VoiceOwner, VoiceTransaction } from './production-voice-store';
import { FRANKLIN_DEMO_ID } from './public-voice-identity';

const path = `publicDemoWaveforms/${FRANKLIN_DEMO_ID}`;
type Snapshot = { ownerUid: string; waveform: Waveform; contentDigest: string; publishedAt: number };
function snapshot(row: Record<string, unknown> | null): Snapshot | null {
  if (!row) return null;
  const waveform = waveformRecord(row.waveform);
  if (!waveform || waveform.id !== FRANKLIN_DEMO_ID || typeof row.ownerUid !== 'string' || !row.ownerUid
    || row.contentDigest !== creationContentDigest(waveform) || !Number.isSafeInteger(row.publishedAt)) throw new CreationSafetyError('The demonstration is unavailable.', 503);
  return { ownerUid: row.ownerUid, waveform, contentDigest: row.contentDigest as string, publishedAt: row.publishedAt as number };
}

/** One explicitly selected demo, not general publication or access to private documents. */
export function createCuratedDemo(database: VoiceDatabase, options: {
  findOwner(): Promise<string | null>;
  requireAllowed(tx: VoiceTransaction, uid: string, waveform: Waveform): Promise<unknown>;
  now?: () => number;
}) {
  async function check(tx: VoiceTransaction, row: Snapshot) {
    if ((await tx.get(`waveformMembers/${row.ownerUid}`))?.state !== 'active') throw new CreationSafetyError('The demonstration is unavailable.', 403);
    await options.requireAllowed(tx, row.ownerUid, row.waveform);
    return row;
  }
  async function published() {
    const existing = await database.transaction(async tx => {
      const row = snapshot(await tx.get(path)); return row ? check(tx, row) : null;
    });
    if (existing) return existing;
    // First release captures the currently approved version exactly once. Private
    // saves after this transaction cannot silently update the public snapshot.
    const uid = await options.findOwner();
    if (!uid) return null;
    return database.transaction(async tx => {
      const existing = snapshot(await tx.get(path));
      if (existing) return check(tx, existing);
      const waveform = waveformRecord(await tx.get(`ownerWaveforms/${uid}`));
      if (!waveform || waveform.id !== FRANKLIN_DEMO_ID) return null;
      const row = await check(tx, { ownerUid: uid, waveform, contentDigest: creationContentDigest(waveform), publishedAt: (options.now ?? Date.now)() });
      tx.set(path, row); return row;
    });
  }
  return { published,
    async requireVoice(tx: VoiceTransaction, owner: VoiceOwner) {
      const row = snapshot(await tx.get(path));
      if (!row || owner.kind !== 'visitor' || owner.waveformId !== FRANKLIN_DEMO_ID || row.ownerUid !== owner.demoSource?.ownerUid
        || row.contentDigest !== owner.contentDigest) throw new CreationSafetyError('The demonstration changed. Reload before starting.');
      await check(tx, row);
    },
    async cleanupSnapshot() { return database.transaction(async tx => snapshot(await tx.get(path))); },
  };
}


/** Existing public allowlist. Installing Visual privately is not consent to extend this demo. */
export function curatedVisitorDisplay(waveform: Waveform) {
  const { id, name, accentColor, profilePhoto, textPanel } = waveform;
  return { id, name, accentColor, profilePhoto, ...(textPanel ? { textPanel } : {}) };
}
/** Server-only prompt projection; stored snapshot/digest and review authority remain intact. */
export function curatedVisitorVoice(waveform: Waveform) {
  return { ...waveform, visualDisplay: null, knowledge: false };
}
