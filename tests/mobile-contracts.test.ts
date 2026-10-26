import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalPublicWaveformUrl, resolvePublicWaveformLink } from '../prototypes/mobile-contracts/links';
import { mobileAccountUid, MobileContractError, mobileStartIntent, mobileWalletView,
  mobileWaveformPermissions, type MobileIdentity } from '../prototypes/mobile-contracts/contracts';
import { mobileContractFixtures } from '../prototypes/mobile-contracts/fixtures';

const origin = 'https://studio.example';
const fixtures = mobileContractFixtures(), id = fixtures.waveformId, link = `${origin}/p/${id}`;

test('public link preserves canonical HTTPS fallback and stable ID without installation or authentication', () => {
  assert.deepEqual(resolvePublicWaveformLink(link, origin), {
    kind: 'public-waveform', waveformId: id, path: `/p/${id}`, webFallbackUrl: link,
  });
  assert.equal(resolvePublicWaveformLink(`${origin.toUpperCase()}/p/${id.toUpperCase()}`, `${origin}/`)?.webFallbackUrl, link);
  assert.equal(canonicalPublicWaveformUrl(id.toUpperCase(), origin), link);
});

test('resolver rejects other hosts, credentials, custom schemes, private routes and query-based authority', () => {
  for (const value of [
    `https://studio.example.evil/p/${id}`, `https://evil.example/p/${id}`, `https://sub.studio.example/p/${id}`,
    `http://studio.example/p/${id}`, `studio://p/${id}`, `/p/${id}`, `//studio.example/p/${id}`,
    `https://user@studio.example/p/${id}`, `https://user:password@studio.example/p/${id}`,
    `${origin}:444/p/${id}`, `${origin}/w/${id}`, `${origin}/account`, `${origin}/api/published?waveformId=${id}`,
    `${link}?uid=fixture-owner`, `${link}?payer=self`, `${link}#token`, `${link}?`, `${link}#`,
  ]) assert.equal(resolvePublicWaveformLink(value, origin), null, value);
});

test('resolver rejects malformed IDs and paths before URL normalization can hide traversal', () => {
  for (const value of [
    '', null, {}, `${link}/`, `${origin}/p/invalid`, `${origin}/p/${id.replace('-4123-', '-5123-')}`,
    `${origin}/w/../p/${id}`, `${origin}/p/./${id}`, `${origin}//p/${id}`, `${origin}/p/%31${id.slice(1)}`,
    `${origin}/%70/${id}`, `${origin}/p/${id}%2f`, `${origin}/p/${id}\n`, ` ${link}`, `${origin}\\p\\${id}`,
    `https:///studio.example/p/${id}`, `https://studio.example./p/${id}`, `${origin}/P/${id}`,
  ]) assert.equal(resolvePublicWaveformLink(value, origin), null, String(value));
});

test('invalid configured origins fail closed and never become an alternate fallback', () => {
  for (const configured of ['', null, 'http://studio.example', `${origin}/path`, `${origin}?x=1`, `${origin}#x`,
    'https://user@studio.example', `${origin}:444`, `${origin}/../`, ` ${origin}`, `${origin}%2f`]) {
    assert.equal(resolvePublicWaveformLink(link, configured), null);
    assert.equal(canonicalPublicWaveformUrl(id, configured), null);
  }
  assert.equal(canonicalPublicWaveformUrl('not-a-uuid', origin), null);
});

test('UID and session consistency use existing actor identity; matching email strings grant nothing', () => {
  assert.equal(mobileAccountUid(fixtures.member), 'fixture-owner');
  assert.equal(mobileAccountUid(fixtures.anonymous), null);
  const mismatch = { kind: 'member', user: { uid: 'other', displayName: 'Other', email: 'same@example.test' },
    actor: { visitorId: 'visitor', uid: 'fixture-owner', accountSessionId: 'session', email: 'same@example.test' } } as MobileIdentity;
  assert.throws(() => mobileAccountUid(mismatch), MobileContractError);
  assert.throws(() => mobileAccountUid({ ...fixtures.member, actor: { visitorId: 'v', uid: 'fixture-owner', accountSessionId: '' } } as MobileIdentity), MobileContractError);
  assert.throws(() => mobileAccountUid({ kind: 'anonymous', actor: { visitorId: 'v', uid: 'forged' } } as MobileIdentity), MobileContractError);
});

test('public view grants no editor authority; private ownership does not follow the shared URL', () => {
  assert.deepEqual(mobileWaveformPermissions(fixtures.anonymous, fixtures.publicView), { canView: true, canEdit: false, canPublish: false });
  assert.deepEqual(mobileWaveformPermissions(fixtures.member, fixtures.publicView), { canView: true, canEdit: false, canPublish: false });
  assert.deepEqual(mobileWaveformPermissions(fixtures.member, fixtures.owned), { canView: true, canEdit: true, canPublish: true });
  assert.deepEqual(mobileWaveformPermissions(fixtures.anonymous, fixtures.owned), { canView: false, canEdit: false, canPublish: false });
  const other: MobileIdentity = { kind: 'member', user: { uid: 'other', displayName: 'Other' },
    actor: { visitorId: 'other-v', uid: 'other', accountSessionId: 'other-session' } };
  assert.equal(mobileWaveformPermissions(other, fixtures.owned).canView, false);
});

test('private balance follows UID and server pack values, strips internal extras and never converts entitlement', () => {
  const wallet = { ...fixtures.wallet, internal: 'exclude', pack: { ...fixtures.wallet.pack, priceId: 'exclude' } };
  assert.deepEqual(mobileWalletView(fixtures.member, wallet), { availableSeconds: 42, pack: fixtures.wallet.pack });
  assert.throws(() => mobileWalletView(fixtures.anonymous, wallet), MobileContractError);
  assert.throws(() => mobileWalletView(fixtures.member, { ...wallet, ownerUid: 'other' }), MobileContractError);
  for (const availableSeconds of [-1, 0.1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => mobileWalletView(fixtures.member, { ...wallet, availableSeconds }), MobileContractError);
  }
});

test('self-funded intent requires matching account and explicit consent; creator intent never switches payer', () => {
  assert.deepEqual(mobileStartIntent(fixtures.anonymous, id, 'creator', false), { waveformId: id, choice: 'creator' });
  assert.deepEqual(mobileStartIntent(fixtures.member, id, 'self', true), { waveformId: id, choice: 'self' });
  assert.throws(() => mobileStartIntent(fixtures.anonymous, id, 'self', true), MobileContractError);
  assert.throws(() => mobileStartIntent(fixtures.member, id, 'self', false), MobileContractError);
  assert.throws(() => mobileStartIntent(fixtures.member, 'invalid', 'creator', false), MobileContractError);
  assert.throws(() => mobileStartIntent(fixtures.member, id, 'other' as 'creator', false), MobileContractError);
});
