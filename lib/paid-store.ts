import { createHash } from 'node:crypto';
import type { Waveform } from './account-model';
import { DEFAULT_PAYMENT_SETTINGS, paymentSettings, type MinutePack, type PaymentSettings } from './paid-model';
import { ACCOUNT_SESSION_COLLECTION, activeAccountSession } from './production-account-session';
import { VoiceAdmissionError, type VoiceDatabase, type VoiceTransaction } from './production-voice-store';

export type PaidActor = { visitorId: string; uid?: string; accountSessionId?: string };
type Wallet = { balance: number; held: number; allocated: number; openPurchase?: string };
type Participant = { linkedUid?: string; active?: string; uses: Record<string, { used: number; held: number }>; starts: number[] };
export type Publication = { ownerUid: string; waveform: Waveform; published: boolean; settings: PaymentSettings; spent: number; held: number; revision: number };
export type PaidSegment = { id: string; viewer: string; visitorId: string; viewerUid?: string; accountSessionId?: string;
  payerUid: string; waveformId: string; payer: 'creator' | 'self'; allowance: number | null; revision: number;
  reserved: number; createdAt: number; expiresAt: number; connectedAt?: number; providerId?: string;
  state: 'creating' | 'active' | 'uncertain' | 'closed' | 'rejected'; canceled: boolean; charged?: number };
export type Purchase = { id: string; uid: string; destination: string; pack: MinutePack; createdAt: number;
  status: 'pending' | 'paid' | 'failed'; checkoutId?: string; checkoutUrl?: string; paymentIntent?: string; reversed: number };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const root = 'paidTest'; // Deliberately no live ledger namespace or processing path in this milestone.
const path = (kind: string, id: string) => `${root}${kind}/${hash(id)}`;
const walletPath = (uid: string) => path('Wallets', uid);
const personPath = (id: string) => path('Participants', id);
const segmentPath = (id: string) => path('Segments', id);
const wavePath = (id: string) => path('Waveforms', id);
const purchasePath = (id: string) => path('Purchases', id);
const blankWallet = (): Wallet => ({ balance: 0, held: 0, allocated: 0 });
const blankPerson = (): Participant => ({ uses: {}, starts: [] });
const free = (w: Wallet) => Math.max(0, w.balance - w.held - w.allocated);
const read = async <T>(tx: VoiceTransaction, key: string) => await tx.get(key) as T | null;
function fail(message: string, status = 409): never { throw new VoiceAdmissionError(message, status); }

/** All monetary/allowance mutations share one database transaction. No browser duration is accepted. */
export function createPaidStore(database: VoiceDatabase, now = Date.now) {
  const audit = (tx: VoiceTransaction, id: string, entry: object) => tx.set(path('Ledger', id), { ...entry, at: now(), environment: 'test' });
  async function authorize(tx: VoiceTransaction, actor: PaidActor) {
    if (actor.uid && actor.accountSessionId && !activeAccountSession(await tx.get(`${ACCOUNT_SESSION_COLLECTION}/${actor.accountSessionId}`), actor.uid, now())) fail('Sign in again to continue.', 403);
  }
  async function participant(tx: VoiceTransaction, actor: PaidActor) {
    const anonymous = await read<Participant>(tx, personPath(actor.visitorId)) ?? blankPerson();
    if (anonymous.linkedUid && anonymous.linkedUid !== actor.uid) fail('This browser allowance belongs to a different signed-in account.', 403);
    const id = actor.uid ? `account:${actor.uid}` : actor.visitorId;
    const row = id === actor.visitorId ? anonymous : await read<Participant>(tx, personPath(id)) ?? blankPerson();
    // Linking is explicit and transactional, never silently grants another allowance.
    if (actor.uid && !anonymous.linkedUid && (anonymous.active || Object.keys(anonymous.uses).length)) fail('Finish linking this browser allowance before continuing.', 409);
    return { id, row };
  }
  async function allocation(tx: VoiceTransaction, actor: PaidActor, waveformId: string, choice: 'creator' | 'self') {
    await authorize(tx, actor);
    if (actor.uid && (await tx.get(`voiceAdminOwners/${hash(actor.uid)}`))?.active) fail('Your previous conversation must close before starting another.');
    const publication = await read<Publication>(tx, wavePath(waveformId));
    if (!publication || !publication.published && publication.ownerUid !== actor.uid) fail('This waveform is unavailable.', 404);
    const { id, row } = await participant(tx, actor);
    if (row.active) fail('Your previous conversation must close before starting another.');
    const own = actor.uid === publication.ownerUid;
    if (choice === 'self' && !actor.uid) fail('An account and available paid minutes are needed to continue.', 402);
    if (own && choice !== 'self') fail('Choose to continue using your own balance.', 402);
    if (choice === 'creator' && publication.settings.mode === 'visitor') fail('An account and available paid minutes are needed to continue.', 402);
    const payerUid = choice === 'self' ? actor.uid! : publication.ownerUid;
    const wallet = await read<Wallet>(tx, walletPath(payerUid)) ?? blankWallet();
    const use = row.uses[waveformId] ?? { used: 0, held: 0 };
    const allowance = choice === 'creator' && publication.settings.mode === 'intro' ? publication.settings.allowanceSeconds : null;
    const funds = choice === 'self' ? free(wallet) : wallet.balance < wallet.held + wallet.allocated ? 0
      : publication.settings.budgetSeconds - publication.spent - publication.held;
    const seconds = Math.min(900, funds, allowance === null ? 900 : Math.max(0, allowance - use.used - use.held));
    if (seconds < 1) fail(choice === 'self' ? 'Purchase minutes to continue using your balance.' : 'Sponsored time has ended. An account and available paid minutes are needed to continue.', 402);
    return { publication, participant: row, participantId: id, payerUid, wallet, use, allowance, seconds };
  }
  return {
    database,
    async registerVisitor(visitorId: string) {
      await database.transaction(async tx => { const exists = await tx.get(path('Visitors', visitorId));
        if (!exists) tx.set(path('Visitors', visitorId), { issuedAt: now() }); });
    },
    async knownVisitor(visitorId: string) { return database.transaction(async tx => !!await tx.get(path('Visitors', visitorId))); },
    async saveWaveform(actor: PaidActor, waveform: Waveform, onlyIfMissing = false) {
      if (!actor.uid) fail('Sign in to save.', 401);
      await database.transaction(async tx => {
        await authorize(tx, actor);
        const prior = await read<Publication>(tx, wavePath(waveform.id));
        if (prior && prior.ownerUid !== actor.uid) fail('This waveform belongs to another account.', 403);
        if (onlyIfMissing && prior) return;
        tx.set(wavePath(waveform.id), prior ? { ...prior, waveform, revision: prior.revision + 1 }
          : { ownerUid: actor.uid, waveform, published: false, settings: DEFAULT_PAYMENT_SETTINGS, spent: 0, held: 0, revision: 1 });
      });
    },
    async link(visitorId: string, uid: string) {
      await database.transaction(async tx => {
        const anonymous = await read<Participant>(tx, personPath(visitorId)) ?? blankPerson();
        const account = await read<Participant>(tx, personPath(`account:${uid}`)) ?? blankPerson();
        if (anonymous.linkedUid === uid) return;
        if (anonymous.linkedUid || anonymous.active || account.active) fail('Finish the previous conversation before linking this browser.', 409);
        const uses = structuredClone(account.uses);
        for (const [id, use] of Object.entries(anonymous.uses)) {
          const previous = uses[id] ?? { used: 0, held: 0 };
          uses[id] = { used: previous.used + use.used, held: previous.held + use.held };
        }
        if (Object.keys(uses).length > 128) fail('This account has reached the allowance tracking limit.', 429);
        tx.set(personPath(`account:${uid}`), { ...account, uses, starts: [...account.starts, ...anonymous.starts].filter(t => now() - t < 60_000) });
        tx.set(personPath(visitorId), { ...anonymous, linkedUid: uid });
      });
    },
    async wallet(uid: string) {
      return database.transaction(async tx => {
        const wallet = await read<Wallet>(tx, walletPath(uid)) ?? blankWallet();
        return { ...wallet, available: free(wallet) };
      });
    },
    async capacity(policy: { concurrency: number; dailySeconds: number }) {
      return database.transaction(async tx => {
        const global = await tx.get('voiceAdmission/global');
        const slots = (global?.active ?? {}) as Record<string, string>;
        const day = new Date(now()).toISOString().slice(0, 10);
        const used = global?.day === day ? Number(global.reservedSeconds) : 0;
        return Object.values(slots).includes('uncertain') ? 'A previous connection needs confirmed cleanup.'
          : Object.keys(slots).length >= policy.concurrency ? 'All available voice connections are in use.'
            : used >= policy.dailySeconds ? 'The daily infrastructure limit has been reached.' : '';
      });
    },
    async publication(id: string) { return database.transaction(tx => read<Publication>(tx, wavePath(id))); },
    async publish(actor: PaidActor, waveform: Waveform, input: PaymentSettings, published: boolean, adminUnfunded = false) {
      const settings = paymentSettings(input, adminUnfunded || !published);
      if (!actor.uid) fail('Sign in to publish.', 401);
      return database.transaction(async tx => {
        await authorize(tx, actor);
        const prior = await read<Publication>(tx, wavePath(waveform.id));
        if (prior && prior.ownerUid !== actor.uid) fail('This waveform belongs to another account.', 403);
        const wallet = await read<Wallet>(tx, walletPath(actor.uid!)) ?? blankWallet();
        const spent = prior?.spent ?? 0, held = prior?.held ?? 0;
        const oldAllocation = prior ? Math.max(0, prior.settings.budgetSeconds - spent) : 0;
        const budget = settings.mode === 'visitor' || adminUnfunded ? spent + held : settings.budgetSeconds;
        if (budget < spent + held) fail('The budget must cover spent and currently reserved sponsored time.');
        const allocation = budget - spent;
        if (allocation > oldAllocation + free(wallet)) fail('Buy minutes or reduce the sponsorship budget.', 402);
        const next: Publication = { ownerUid: actor.uid!, waveform, published, settings: { ...settings, budgetSeconds: budget }, spent, held, revision: (prior?.revision ?? 0) + 1 };
        tx.set(wavePath(waveform.id), next);
        tx.set(walletPath(actor.uid!), { ...wallet, allocated: wallet.allocated - oldAllocation + allocation });
        audit(tx, `settings:${waveform.id}:${next.revision}`, { type: 'budget_allocation', uid: actor.uid, waveformId: waveform.id, seconds: allocation - oldAllocation, published, ...(adminUnfunded ? { adminOverride: 'unfunded_publish' } : {}) });
        return next;
      });
    },
    async quote(actor: PaidActor, id: string, choice: 'creator' | 'self') {
      return database.transaction(async tx => { const a = await allocation(tx, actor, id, choice); return { seconds: a.seconds, payer: choice }; });
    },
    async reserve(actor: PaidActor, waveformId: string, id: string, choice: 'creator' | 'self', policy: { concurrency: number; dailySeconds: number }) {
      return database.transaction(async tx => {
        if (await tx.get(segmentPath(id))) fail('This conversation identifier has already been used.');
        const global = await tx.get('voiceAdmission/global');
        const slots = (global?.active ?? {}) as Record<string, string>;
        if (Object.values(slots).includes('uncertain')) fail('A previous connection needs confirmed cleanup.', 503);
        if (Object.keys(slots).length >= policy.concurrency) fail('All available voice connections are in use.');
        const a = await allocation(tx, actor, waveformId, choice);
        const day = new Date(now()).toISOString().slice(0, 10);
        const daily = global?.day === day ? Number(global.reservedSeconds) : 0;
        if (!Number.isSafeInteger(daily) || daily < 0) fail('Capacity data requires review.', 503);
        if (Object.values(slots).includes('uncertain')) fail('A previous connection needs confirmed cleanup.', 503);
        if (Object.keys(slots).length >= policy.concurrency) fail('All available voice connections are in use.');
        if (daily + a.seconds > policy.dailySeconds) fail('The daily infrastructure limit has been reached.', 429);
        if (a.participant.active) fail('Your previous conversation must close before starting another.');
        const starts = a.participant.starts.filter(t => now() - t < 60_000);
        if (starts.length >= 3) fail('Please wait a minute before starting another conversation.', 429);
        if (!a.participant.uses[waveformId] && Object.keys(a.participant.uses).length >= 128) fail('This browser has reached the allowance tracking limit.', 429);
        const segment: PaidSegment = { id, viewer: a.participantId, visitorId: actor.visitorId,
          ...(actor.uid ? { viewerUid: actor.uid } : {}), ...(actor.accountSessionId ? { accountSessionId: actor.accountSessionId } : {}),
          payerUid: a.payerUid, waveformId, payer: choice, allowance: a.allowance, revision: a.publication.revision,
          reserved: a.seconds, createdAt: now(), expiresAt: now() + a.seconds * 1000, state: 'creating', canceled: false };
        tx.set(segmentPath(id), segment);
        tx.set(personPath(a.participantId), { ...a.participant, active: id, starts: [...starts, now()],
          uses: { ...a.participant.uses, [waveformId]: { ...a.use, held: a.use.held + (choice === 'creator' ? a.seconds : 0) } } });
        if (choice === 'creator') tx.set(wavePath(waveformId), { ...a.publication, held: a.publication.held + a.seconds });
        else tx.set(walletPath(a.payerUid), { ...a.wallet, held: a.wallet.held + a.seconds });
        tx.set('voiceAdmission/global', { day, reservedSeconds: daily + a.seconds, active: { ...slots, [id]: 'creating' } });
        audit(tx, `hold:${id}`, { type: 'reservation', uid: a.payerUid, waveformId, segmentId: id, seconds: a.seconds, payer: choice });
        return segment;
      });
    },
    async segment(id: string) { return database.transaction(tx => read<PaidSegment>(tx, segmentPath(id))); },
    async activeFor(uid: string) {
      return database.transaction(async tx => {
        const person = await read<Participant>(tx, personPath(`account:${uid}`));
        return person?.active ? read<PaidSegment>(tx, segmentPath(person.active)) : null;
      });
    },
    async updateSegment(id: string, update: 'created' | 'connected' | 'cancel', providerId?: string) {
      return database.transaction(async tx => {
        const segment = await read<PaidSegment>(tx, segmentPath(id));
        if (!segment || ['closed', 'rejected'].includes(segment.state)) return segment;
        if (providerId && segment.providerId && segment.providerId !== providerId) fail('Provider identifier mismatch.', 403);
        const next = { ...segment, ...(providerId ? { providerId } : {}),
          ...(update === 'created' ? { state: 'active' as const } : {}),
          ...(update === 'connected' && !segment.connectedAt ? { connectedAt: now() } : {}),
          ...(update === 'cancel' ? { canceled: true } : {}) };
        tx.set(segmentPath(id), next);
        return next;
      });
    },
    async cancelMissing(actor: PaidActor, waveformId: string, id: string) {
      await database.transaction(async tx => {
        const segment = await read<PaidSegment>(tx, segmentPath(id));
        if (segment) return;
        tx.set(segmentPath(id), { id, visitorId: actor.visitorId, viewer: actor.uid ? `account:${actor.uid}` : actor.visitorId,
          waveformId, state: 'rejected', canceled: true, createdAt: now(), expiresAt: now(), reserved: 0 });
      });
    },
    async mayStart(id: string) {
      return database.transaction(async tx => {
        const segment = await read<PaidSegment>(tx, segmentPath(id));
        if (!segment || segment.state !== 'creating' || segment.canceled || segment.expiresAt <= now()) return false;
        const wave = await read<Publication>(tx, wavePath(segment.waveformId));
        if (!wave || !wave.published && wave.ownerUid !== segment.viewerUid) return false;
        await authorize(tx, { visitorId: segment.visitorId, uid: segment.viewerUid, accountSessionId: segment.accountSessionId });
        return true;
      });
    },
    async settle(id: string, result: { finalized: boolean; seconds?: number; rejected?: boolean; providerId?: string }) {
      await database.transaction(async tx => {
        const segment = await read<PaidSegment>(tx, segmentPath(id));
        if (!segment || ['closed', 'rejected'].includes(segment.state)) return;
        if (result.providerId && segment.providerId && result.providerId !== segment.providerId) fail('Provider identifier mismatch.', 403);
        const global = await tx.get('voiceAdmission/global');
        const slots = { ...(global?.active ?? {}) as Record<string, string> };
        if (!result.finalized) {
          tx.set(segmentPath(id), { ...segment, state: 'uncertain' });
          tx.set('voiceAdmission/global', { ...global, active: { ...slots, [id]: 'uncertain' } });
          return; // An elapsed timer/REST acknowledgment never releases a hold.
        }
        if (!result.rejected && (typeof result.seconds !== 'number' || !Number.isFinite(result.seconds) || result.seconds < 0)) fail('Confirmed provider duration is required.', 503);
        // Failed setup is free. Duration comes only from validated provider closure, rounded up once.
        const charged = result.rejected || segment.connectedAt === undefined ? 0 : Math.min(segment.reserved,
          Math.ceil(result.seconds!), Math.max(0, Math.ceil((now() - segment.connectedAt) / 1000)));
        const wallet = await read<Wallet>(tx, walletPath(segment.payerUid)) ?? blankWallet();
        const person = await read<Participant>(tx, personPath(segment.viewer)) ?? blankPerson();
        const wave = await read<Publication>(tx, wavePath(segment.waveformId));
        if (!wave || person.active !== id) fail('Reservation requires reconciliation.', 503);
        const use = person.uses[segment.waveformId];
        if (!use) fail('Allowance requires reconciliation.', 503);
        delete slots[id];
        const { active: _active, ...rest } = person;
        void _active;
        tx.set(personPath(segment.viewer), { ...rest, uses: { ...person.uses, [segment.waveformId]: {
          used: use.used + (segment.payer === 'creator' ? charged : 0), held: use.held - (segment.payer === 'creator' ? segment.reserved : 0) } } });
        tx.set(walletPath(segment.payerUid), { ...wallet, balance: wallet.balance - charged,
          held: wallet.held - (segment.payer === 'self' ? segment.reserved : 0),
          allocated: wallet.allocated - (segment.payer === 'creator' ? wave.settings.mode === 'visitor' ? segment.reserved : charged : 0) });
        if (segment.payer === 'creator') tx.set(wavePath(segment.waveformId), { ...wave, held: wave.held - segment.reserved, spent: wave.spent + charged,
          settings: wave.settings.mode === 'visitor' ? { ...wave.settings, budgetSeconds: wave.spent + charged + wave.held - segment.reserved } : wave.settings });
        tx.set(segmentPath(id), { ...segment, state: result.rejected ? 'rejected' : 'closed', charged,
          providerSeconds: result.seconds ?? 0, settledAt: now(), overshootSeconds: Math.max(0, Math.ceil(result.seconds ?? 0) - segment.reserved) });
        tx.set('voiceAdmission/global', { ...global, active: slots });
        audit(tx, `debit:${id}`, { type: 'usage_debit', uid: segment.payerUid, segmentId: id, seconds: -charged });
        audit(tx, `release:${id}`, { type: 'released_hold', uid: segment.payerUid, segmentId: id, seconds: segment.reserved - charged });
      });
    },
    async beginPurchase(actor: PaidActor, id: string, destination: string, pack: MinutePack) {
      if (!actor.uid) fail('Sign in to buy minutes.', 401);
      return database.transaction(async tx => {
        await authorize(tx, actor);
        const existing = await read<Purchase>(tx, purchasePath(id));
        if (existing) { if (existing.uid !== actor.uid) fail('Purchase belongs to another account.', 403);
          if (existing.destination !== destination) fail('This checkout belongs to another waveform. Finish that checkout first.'); return existing; }
        const wallet = await read<Wallet>(tx, walletPath(actor.uid!)) ?? blankWallet();
        const open = wallet.openPurchase ? await read<Purchase>(tx, purchasePath(wallet.openPurchase)) : null;
        if (open?.status === 'pending' && now() - open.createdAt < 30 * 60_000) {
          if (open.destination !== destination) fail('A checkout for another waveform is pending. Finish it or wait for it to expire.');
          return open;
        }
        const purchase: Purchase = { id, uid: actor.uid!, destination, pack, createdAt: now(), status: 'pending', reversed: 0 };
        tx.set(purchasePath(id), purchase);
        tx.set(walletPath(actor.uid!), { ...wallet, openPurchase: id });
        return purchase;
      });
    },
    async checkoutCreated(id: string, checkoutId: string, checkoutUrl: string) {
      await database.transaction(async tx => {
        const purchase = await read<Purchase>(tx, purchasePath(id));
        if (!purchase || purchase.checkoutId && purchase.checkoutId !== checkoutId) fail('Checkout does not match purchase.', 503);
        tx.set(purchasePath(id), { ...purchase, checkoutId, checkoutUrl });
      });
    },
    async purchase(id: string) { return database.transaction(tx => read<Purchase>(tx, purchasePath(id))); },
    async fulfill(eventId: string, id: string, payment: { checkoutId: string; paymentIntent: string; uid: string; amount: number; currency: string; packId: string; seconds: number; priceId: string }) {
      await database.transaction(async tx => {
        const event = await tx.get(path('Events', eventId));
        const purchase = await read<Purchase>(tx, purchasePath(id));
        const reversal = await tx.get(path('Reversals', payment.paymentIntent));
        if (event) return;
        if (!purchase || purchase.uid !== payment.uid || purchase.pack.id !== payment.packId || purchase.pack.seconds !== payment.seconds
          || purchase.pack.priceId !== payment.priceId || purchase.pack.amount !== payment.amount || purchase.pack.currency !== payment.currency
          || purchase.checkoutId && purchase.checkoutId !== payment.checkoutId || purchase.paymentIntent && purchase.paymentIntent !== payment.paymentIntent) fail('Payment does not match the server purchase.', 400);
        const intent = await tx.get(path('Intents', payment.paymentIntent));
        if (intent && intent.purchaseId !== id) fail('Payment has already been allocated.', 400);
        const wallet = await read<Wallet>(tx, walletPath(purchase.uid)) ?? blankWallet();
        const reversedAmount = Math.min(payment.amount, Number(reversal?.amount ?? 0));
        const reversed = Math.ceil(purchase.pack.seconds * reversedAmount / purchase.pack.amount);
        if (purchase.status !== 'paid') {
          tx.set(walletPath(purchase.uid), { ...wallet, balance: wallet.balance + purchase.pack.seconds - reversed });
          audit(tx, `credit:${id}`, { type: 'purchase_credit', uid: purchase.uid, purchaseId: id, seconds: purchase.pack.seconds });
          if (reversed) audit(tx, `reversal-before:${id}`, { type: 'compensating_adjustment', uid: purchase.uid, purchaseId: id, seconds: -reversed });
        }
        tx.set(purchasePath(id), { ...purchase, status: 'paid', checkoutId: payment.checkoutId, paymentIntent: payment.paymentIntent, reversed: Math.max(purchase.reversed, reversed) });
        tx.set(path('Intents', payment.paymentIntent), { purchaseId: id });
        tx.set(path('Events', eventId), { type: 'fulfilled', purchaseId: id, at: now() });
      });
    },
    async failPurchase(id: string, checkoutId: string) {
      await database.transaction(async tx => {
        const p = await read<Purchase>(tx, purchasePath(id));
        if (p && p.status !== 'paid' && (!p.checkoutId || p.checkoutId === checkoutId)) tx.set(purchasePath(id), { ...p, status: 'failed' });
      });
    },
    async reverse(eventId: string, paymentIntent: string, amount: number) {
      if (!Number.isSafeInteger(amount) || amount < 0) fail('Invalid reversal amount.', 400);
      await database.transaction(async tx => {
        const seen = await tx.get(path('Events', eventId));
        const prior = await tx.get(path('Reversals', paymentIntent));
        const intent = await tx.get(path('Intents', paymentIntent));
        const purchase = intent ? await read<Purchase>(tx, purchasePath(String(intent.purchaseId))) : null;
        const wallet = purchase ? await read<Wallet>(tx, walletPath(purchase.uid)) ?? blankWallet() : null;
        if (seen) return;
        const cumulative = Math.max(amount, Number(prior?.amount ?? 0));
        if (purchase && wallet) {
          const reversed = Math.min(purchase.pack.seconds, Math.ceil(purchase.pack.seconds * cumulative / purchase.pack.amount));
          const delta = Math.max(0, reversed - purchase.reversed);
          tx.set(walletPath(purchase.uid), { ...wallet, balance: wallet.balance - delta });
          tx.set(purchasePath(purchase.id), { ...purchase, reversed: Math.max(purchase.reversed, reversed) });
          audit(tx, `adjust:${eventId}`, { type: 'compensating_adjustment', uid: purchase.uid, purchaseId: purchase.id, seconds: -delta });
        }
        tx.set(path('Reversals', paymentIntent), { amount: cumulative });
        tx.set(path('Events', eventId), { type: 'reversal', at: now() });
      });
    },
    defaults: DEFAULT_PAYMENT_SETTINGS,
  };
}
export type PaidStore = ReturnType<typeof createPaidStore>;
