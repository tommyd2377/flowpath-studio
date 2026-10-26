import { DEFAULT_VOICE } from '../../lib/voice-options';
import type { MobileIdentity, MobileWalletSnapshot, MobileWaveformResource } from './contracts';

/** In-memory synthetic examples only. Nothing is persisted, mounted or connected to a provider. */
export function mobileContractFixtures() {
  const waveformId = '12345678-1234-4123-8123-123456789abc';
  const member: MobileIdentity = { kind: 'member', user: { uid: 'fixture-owner', displayName: 'Synthetic owner' },
    actor: { visitorId: 'fixture-visitor', uid: 'fixture-owner', accountSessionId: 'fixture-session' } };
  const anonymous: MobileIdentity = { kind: 'anonymous', actor: { visitorId: 'fixture-anonymous' } };
  const owned: MobileWaveformResource = { visibility: 'owner', ownerUid: 'fixture-owner', waveform: {
    id: waveformId, name: 'Synthetic mobile waveform', initialPrompt: 'A fixture, not a real persona.',
    voice: DEFAULT_VOICE, accentColor: '#3a66ff', profilePhoto: null, updatedAt: '2026-10-26T12:00:00.000Z',
  } };
  const publicView: MobileWaveformResource = { visibility: 'public', waveform: { id: waveformId,
    name: owned.waveform.name, accentColor: owned.waveform.accentColor, profilePhoto: null } };
  const wallet: MobileWalletSnapshot = { ownerUid: 'fixture-owner', availableSeconds: 42,
    pack: { id: 'arbitrary-synthetic-pack', seconds: 123, amount: 456, currency: 'usd' } };
  return { waveformId, member, anonymous, owned, publicView, wallet };
}
