import { createHash } from 'node:crypto';
import type { Waveform } from './account-model';
import type { Publication } from './paid-store';
import type { VoiceOwner, VoiceTransaction } from './production-voice-store';
import { CreationSafetyError } from './creation-safety';

type Admin = { uid: string; accountSessionId?: string; testing?: boolean; isCurrent(): boolean | Promise<boolean> };
/** The existing founder override may play the published snapshot, never the private draft. */
export async function resolvePublishedPreview(request: Request, id: string, options: {
  resolveAdmin(request: Request): Promise<Admin | null>;
  approvedPublication(id: string): Promise<Publication | null>;
}) {
  const admin = await options.resolveAdmin(request);
  if (!admin?.testing || !await admin.isCurrent()) return null;
  const publication = await options.approvedPublication(id);
  if (!publication?.published || publication.ownerUid !== admin.uid || !Number.isSafeInteger(publication.revision)) return null;
  return { ownerUid: admin.uid, accountSessionId: admin.accountSessionId, publishedRevision: publication.revision,
    waveform: { ...publication.waveform, knowledge: false }, isCurrent: async () => {
      const current = await options.resolveAdmin(request);
      return current?.uid === admin.uid && current.testing === true && await current.isCurrent();
    } };
}

/** Recheck the same approved snapshot inside reservation/setup transactions. */
export async function requirePublishedPreview(tx: VoiceTransaction, owner: VoiceOwner,
  requireAllowed: (tx: VoiceTransaction, uid: string, waveform: Waveform) => Promise<unknown>,
  digest: (waveform: Waveform) => string) {
  const row = await tx.get(`paidTestWaveforms/${createHash('sha256').update(owner.waveformId).digest('hex')}`) as Publication | null;
  if (!row?.published || row.ownerUid !== owner.ownerUid || owner.admin?.uid !== owner.ownerUid || owner.admin.override !== true
    || row.revision !== owner.publishedRevision || !row.waveform || digest(row.waveform) !== owner.contentDigest) {
    throw new CreationSafetyError('The published version changed. Reload before starting a conversation.');
  }
  await requireAllowed(tx, owner.ownerUid, row.waveform);
}
