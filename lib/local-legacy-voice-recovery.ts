import { createHash } from 'node:crypto';
import { localAppOrigin } from './local-app-runtime';
import type { VoiceDatabase } from './production-voice-store';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Operator-only, default read-only. No route, provider call, account edit, refund or usage verdict. */
export async function recoverLegacyLocalHold(database: VoiceDatabase,
  scope: { ownerUid: string; waveformId: string }, expectedFingerprint?: string, now = Date.now()) {
  if (!localAppOrigin()) throw new Error('Legacy recovery is restricted to the full localhost runtime');
  return database.transaction(async tx => {
    const ownPath = `voiceOwners/${hash(scope.ownerUid)}`, adminPath = `voiceAdminOwners/${hash(scope.ownerUid)}`;
    const [own, admin, global] = await Promise.all([tx.get(ownPath), tx.get(adminPath), tx.get('voiceAdmission/global')]);
    if (typeof own?.active !== 'string' || admin?.active !== own.active || !global
      || !Number.isSafeInteger(global.reservedSeconds) || Number(global.reservedSeconds) < 0) throw new Error('Matching local founder admission pointers are required');
    const id = own.active, call = await tx.get(`voiceConversations/${id}`);
    const slots = global.active;
    const control = call?.cleanup as { until?: number } | undefined;
    const founder = call?.admin as { uid?: string; unmeteredLocal?: boolean } | undefined;
    if (!call || call.id !== id || call.ownerUid !== scope.ownerUid || call.waveformId !== scope.waveformId
      || call.kind !== undefined || call.state !== 'uncertain' || call.canceled !== true || call.localRecovery !== undefined
      || founder?.uid !== scope.ownerUid || founder.unmeteredLocal !== true
      || typeof call.providerId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(call.providerId)
      || typeof call.createdAt !== 'number' || !Number.isSafeInteger(call.createdAt) || call.createdAt > now - 900_000
      || typeof call.seconds === 'number' || control && (!Number.isSafeInteger(control.until) || control.until! > now)
      || !slots || typeof slots !== 'object' || Array.isArray(slots) || (slots as Record<string, unknown>)[id] !== 'uncertain') {
      throw new Error('Only an old, canceled, unmetered founder hold without active cleanup is eligible');
    }
    const fingerprint = hash(JSON.stringify([id, scope.ownerUid, scope.waveformId, call.providerId, call.createdAt]));
    const remaining = { ...slots as Record<string, unknown> }; delete remaining[id];
    const plan = { fingerprint, ageMinutes: Math.floor((now - call.createdAt) / 60_000), finalUsageConfirmed: false,
      reservedUsagePreserved: true, otherOpenHolds: Object.keys(remaining).length, scope: 'localhost-founder-only' } as const;
    if (expectedFingerprint === undefined) return { ...plan, applied: false };
    if (expectedFingerprint !== fingerprint) throw new Error('The approved legacy call changed; nothing was repaired');
    tx.set(`voiceConversations/${id}`, { ...call,
      localRecovery: { reason: 'operator_quarantined_legacy_hold', at: now, finalUsageConfirmed: false } });
    tx.set('voiceAdmission/global', { ...global, active: remaining });
    tx.set(ownPath, { ...own, active: null });
    tx.set(adminPath, { ...admin, active: null });
    return { ...plan, applied: true };
  });
}
