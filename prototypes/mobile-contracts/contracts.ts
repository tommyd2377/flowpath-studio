import type { AccountUser, Waveform } from '../../lib/account-model';
import type { MinutePack, PaymentMode, PublicWaveform } from '../../lib/paid-model';
import { validWaveformId } from '../../lib/paid-model';
import type { PaidActor } from '../../lib/paid-store';

/** Internal server/fake-transport context, produced after verification; never decoded from a deep link. */
export type MobileIdentity =
  | { kind: 'anonymous'; actor: Pick<PaidActor, 'visitorId'> }
  | { kind: 'member'; user: Pick<AccountUser, 'uid' | 'displayName'>;
      actor: PaidActor & Required<Pick<PaidActor, 'uid' | 'accountSessionId'>> };
export type MobileWaveformResource =
  | { visibility: 'public'; waveform: PublicWaveform }
  | { visibility: 'owner'; ownerUid: AccountUser['uid']; waveform: Waveform };
export type MobilePermissionView = { canView: boolean; canEdit: boolean; canPublish: boolean };
export type MobileWalletSnapshot = {
  ownerUid: AccountUser['uid']; availableSeconds: number;
  pack: Pick<MinutePack, 'id' | 'seconds' | 'amount' | 'currency'>;
};
export type MobilePaymentView = { mode: PaymentMode; ready: boolean; reason: 'ready' | 'paused' | 'sign-in' | 'balance' | 'capacity' };
export type MobileStartIntent = { waveformId: PublicWaveform['id']; choice: 'creator' | 'self' };

export class MobileContractError extends Error {}
const bounded = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0
  && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const seconds = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Detects mixed-account snapshots. It does not verify a Firebase token or grant backend authority. */
export function mobileAccountUid(identity: MobileIdentity): string | null {
  if (!identity || !identity.actor || !bounded(identity.actor.visitorId, 256)) throw new MobileContractError('Invalid visitor scope.');
  if (identity.kind === 'anonymous') {
    if ('uid' in identity.actor || 'accountSessionId' in identity.actor) throw new MobileContractError('Anonymous scope contains account authority.');
    return null;
  }
  if (identity.kind !== 'member' || !identity.user || !bounded(identity.user.uid, 128)
    || identity.user.uid !== identity.actor.uid || !bounded(identity.actor.accountSessionId, 256)) {
    throw new MobileContractError('Account and verified session do not match.');
  }
  return identity.user.uid;
}

/** UI permission projection only. The existing endpoints must repeat their own transactional checks. */
export function mobileWaveformPermissions(identity: MobileIdentity, resource: MobileWaveformResource): MobilePermissionView {
  const uid = mobileAccountUid(identity);
  if (!resource || !resource.waveform || !validWaveformId(resource.waveform.id)) throw new MobileContractError('Invalid waveform scope.');
  if (resource.visibility === 'public') return { canView: true, canEdit: false, canPublish: false };
  if (resource.visibility !== 'owner' || !bounded(resource.ownerUid, 128)) throw new MobileContractError('Invalid owner scope.');
  const own = uid !== null && uid === resource.ownerUid;
  return { canView: own, canEdit: own, canPublish: own };
}

/** Private display projection: validates ownership and strips server-only price IDs/extra data. */
export function mobileWalletView(identity: MobileIdentity, snapshot: MobileWalletSnapshot): Omit<MobileWalletSnapshot, 'ownerUid'> {
  const uid = mobileAccountUid(identity);
  const pack = snapshot?.pack;
  if (!uid || !snapshot || snapshot.ownerUid !== uid) throw new MobileContractError('This balance belongs to another account.');
  if (!seconds(snapshot.availableSeconds) || !pack || !bounded(pack.id, 128) || !seconds(pack.seconds)
    || pack.seconds === 0 || !seconds(pack.amount) || pack.amount === 0 || pack.currency !== 'usd') {
    throw new MobileContractError('Invalid server balance or pack snapshot.');
  }
  return { availableSeconds: snapshot.availableSeconds,
    pack: { id: pack.id, seconds: pack.seconds, amount: pack.amount, currency: pack.currency } };
}

/** Intent is never entitlement. A link, quote or checkout return cannot call this automatically. */
export function mobileStartIntent(identity: MobileIdentity, waveformId: string,
  choice: MobileStartIntent['choice'], explicitOwnBalanceConsent: boolean): MobileStartIntent {
  const uid = mobileAccountUid(identity);
  if (!validWaveformId(waveformId) || !['creator', 'self'].includes(choice)) throw new MobileContractError('Invalid voice start scope.');
  if (choice === 'self' && (!uid || explicitOwnBalanceConsent !== true)) throw new MobileContractError('Sign in and explicitly choose your own balance.');
  return { waveformId: waveformId.toLowerCase(), choice };
}

/** Proposed read-only transport seam. No HTTP/native auth implementation or alternative backend is added. */
export type MobileReadTransport = {
  readPublished(waveformId: PublicWaveform['id']): Promise<{ waveform: PublicWaveform; payment: MobilePaymentView }>;
  readOwnWaveform(): Promise<Extract<MobileWaveformResource, { visibility: 'owner' }> | null>;
  readOwnWallet(): Promise<MobileWalletSnapshot>;
};
