import { requestWaveformId, type createAccountServer } from './account-server';
import { DEFAULT_PACK, DEFAULT_PAYMENT_SETTINGS, paymentSettings, returnDestination, validWaveformId, type MinutePack } from './paid-model';
import { issuePaidVisitor, paidJson, paidResponse as json, paidVisitor } from './paid-http';
import { sameWaveformVersion, type PaidActor, type PaidStore } from './paid-store';
import type { createStripeTest } from './stripe-test';
import { isAllowedRequest } from './request-origin';
import { VoiceAdmissionError } from './production-voice-store';
import { projectTextPanelConfiguration } from './text-panel';
import { serverAnalytics } from './analytics-runtime';

type Options = { projectPlugins?: (uid: string, id: string, waveform: import('./account-model').Waveform) => Promise<{ waveform: import('./account-model').Waveform }>; store: PaidStore; accounts: Pick<ReturnType<typeof createAccountServer>, 'resolveIdentity' | 'resolveVoiceWaveform'> & Partial<Pick<ReturnType<typeof createAccountServer>, 'resolveAdmin'>>;
  enabled: boolean; fixtures: boolean; publicOrigin?: string; trustedProxyHost?: string; pack?: MinutePack;
  stripe?: ReturnType<typeof createStripeTest>; voiceReady?: () => boolean; adminVoiceReady?: () => boolean };
export function createPaidApi(options: Options) {
  const { store, accounts } = options;
  const pack = options.pack ?? DEFAULT_PACK;
  const allowed = (request: Request, mutation: boolean) => options.enabled && isAllowedRequest(request, mutation, options.publicOrigin, options.trustedProxyHost);
  type Identity = Awaited<ReturnType<Options['accounts']['resolveIdentity']>>;
  async function registeredVisitor(request: Request) {
    const visitorId = paidVisitor(request);
    if (!visitorId || !await store.knownVisitor(visitorId)) throw new VoiceAdmissionError('Allow browser storage, then try again.', 409);
    return visitorId;
  }
  async function linkedActor(visitorId: string, identity: Identity): Promise<PaidActor> {
    if (identity) await store.link(visitorId, identity.owner.uid);
    return { visitorId, ...(identity ? { uid: identity.owner.uid, accountSessionId: identity.accountSessionId } : {}) };
  }
  async function actor(request: Request): Promise<PaidActor> {
    const visitorId = await registeredVisitor(request);
    return linkedActor(visitorId, await accounts.resolveIdentity(request));
  }
  const forbidden = () => json({ error: 'Paid preview is unavailable on this host.' }, 403);
  const failure = (error: unknown) => json({ error: error instanceof VoiceAdmissionError ? error.message : 'The paid preview could not complete this request.' }, error instanceof VoiceAdmissionError ? error.status : 503);
  return {
    actor,
    async billingGET(request: Request) {
      if (!options.enabled) return json({ enabled: false });
      if (!allowed(request, false)) return forbidden();
      const visitor = paidVisitor(request);
      if (!visitor || !await store.knownVisitor(visitor)) {
        const issued = issuePaidVisitor(Boolean(options.publicOrigin));
        await store.registerVisitor(issued.visitorId);
        return json({ enabled: true, identityPending: true, pack, fixtures: options.fixtures }, 200, { 'Set-Cookie': issued.cookie });
      }
      try {
        const a = await linkedActor(visitor, await accounts.resolveIdentity(request));
        const [wallet, capacity] = await Promise.all([a.uid ? store.wallet(a.uid) : null,
          store.capacity({ concurrency: 3, dailySeconds: 9_000 })]);
        const purchase = wallet?.openPurchase ? await store.purchase(wallet.openPurchase) : null;
        return json({ enabled: true, pack, fixtures: options.fixtures, signedIn: !!a.uid,
          wallet, purchaseStatus: purchase?.uid === a.uid ? purchase?.status ?? null : null,
          voiceReady: !!options.voiceReady?.() && !capacity, checkoutReady: options.fixtures || !!options.stripe,
          capacityMessage: !options.voiceReady?.() ? 'Paid voice is paused until upstream cutoff and recovery are verified. Purchases are unavailable.' : capacity });
      } catch (error) { return failure(error); }
    },
    async publishingGET(request: Request) {
      if (!allowed(request, false)) return forbidden();
      try {
        const waveform = await accounts.resolveVoiceWaveform(request, requestWaveformId(request), 'cleanup');
        if (!waveform) return json({ error: 'Sign in and save your waveform first.' }, 401);
        const p = await store.publication(waveform.waveform.id);
        if (p && p.ownerUid !== waveform.ownerUid) return json({ error: 'Waveform is unavailable.' }, 403);
        return json({ published: p?.published ?? false, settings: p?.settings ?? DEFAULT_PAYMENT_SETTINGS,
          spent: p?.spent ?? 0, held: p?.held ?? 0, id: waveform.waveform.id });
      } catch (error) { return failure(error); }
    },
    async publishingPOST(request: Request) {
      if (!allowed(request, true)) return forbidden();
      try {
        const body = await paidJson(request);
        if (Object.keys(body).some(k => !['settings', 'published', 'continueAsAdmin'].includes(k)) || typeof body.published !== 'boolean'
          || body.continueAsAdmin !== undefined && typeof body.continueAsAdmin !== 'boolean') return json({ error: 'Invalid publishing request.' }, 400);
        const identity = await accounts.resolveIdentity(request);
        const a = await actor(request);
        const waveform = await accounts.resolveVoiceWaveform(request, requestWaveformId(request), body.published ? 'admission' : 'cleanup');
        if (!a.uid || !waveform || waveform.ownerUid !== a.uid) return json({ error: 'Sign in and save your waveform first.' }, 401);
        const adminTesting = identity?.owner.role === 'admin' && identity.owner.uid === waveform.ownerUid
          && waveform.waveform.adminTesting === true && await identity.isCurrent() === true;
        if (body.continueAsAdmin === true && !adminTesting) return json({ error: 'Enable admin testing in your waveform settings first.' }, 403);
        let settings;
        try { settings = paymentSettings(body.settings, true); } catch (error) { return json({ error: (error as Error).message }, 400); }
        if (body.published && settings.mode !== 'visitor' && settings.budgetSeconds === 0 && !adminTesting) {
          return json({ error: 'Sponsored publishing normally requires a funded sponsorship budget.' }, 402);
        }
        const publication = await store.publish(a, waveform.waveform, settings, body.published, adminTesting);
        if (body.published) serverAnalytics.record({ eventName: 'creation_step', properties: { step: 'published', outcome: 'success' } });
        return json({ published: publication.published, settings: publication.settings, spent: publication.spent,
          held: publication.held, id: waveform.waveform.id, ...(adminTesting ? { adminUnfunded: true } : {}) });
      } catch (error) {
        return failure(error);
      }
    },
    async publishedGET(request: Request) {
      if (!allowed(request, false)) return forbidden();
      const query = new URL(request.url).searchParams;
      const id = query.get('id');
      const preview = query.get('preview') === 'draft';
      if (query.has('preview') && !preview) return json({ error: 'Invalid preview.' }, 400);
      if (!validWaveformId(id)) return json({ error: 'This waveform is unavailable.' }, 404);
      try {
        const [initialPublication, identity] = await Promise.all([preview ? store.publication(id) : store.approvedPublication(id), accounts.resolveIdentity(request)]);
        let p = initialPublication;
        const draft = preview && identity ? await accounts.resolveVoiceWaveform(request, id) : null;
        if (preview && (!draft || draft.ownerUid !== identity?.owner.uid || !await draft.isCurrent())) return json({ error: 'This waveform is unavailable.' }, 404);
        if (draft && (!sameWaveformVersion(p?.draft, draft.waveform))) {
          await store.saveWaveform({ visitorId: paidVisitor(request) ?? 'owner-index', uid: draft.ownerUid,
            accountSessionId: draft.accountSessionId }, draft.waveform);
          p = await store.publication(id);
        }
        if (!p && identity) {
          const existing = await accounts.resolveVoiceWaveform(request, id);
          if (existing?.ownerUid === identity.owner.uid && await existing.isCurrent()) {
            // Older owner records need a private billing index, never a rewrite or automatic publication.
            await store.saveWaveform({ visitorId: paidVisitor(request) ?? 'owner-index', uid: identity.owner.uid,
              accountSessionId: identity.accountSessionId }, existing.waveform, true);
            p = await store.approvedPublication(id);
          }
        }
        if (!p || !p.published && p.ownerUid !== identity?.owner.uid) return json({ error: 'This waveform is unavailable.' }, 404);
        const own = identity?.owner.uid === p.ownerUid;
        const admin = own && identity?.owner.role === 'admin' && !preview ? await accounts.resolveAdmin?.(request) : null;
        const saved = own && identity?.owner.role === 'admin' && (preview || !accounts.resolveAdmin)
          ? draft || await accounts.resolveVoiceWaveform(request, id) : null;
        const adminTesting = admin ? admin.uid === identity?.owner.uid && admin.testing === true && await admin.isCurrent()
          : !!saved && saved.ownerUid === identity?.owner.uid && saved.waveform.adminTesting === true && await identity!.isCurrent() === true;
        // Strict allowlist: no saved instructions, voice config, owner UID, budget or ledger.
        const source = preview ? p.draft ?? p.waveform : p.waveform;
        const display = options.projectPlugins ? (await options.projectPlugins(p.ownerUid, id, source)).waveform : source;
        const { name, accentColor, profilePhoto } = display;
        let quote = null, reason = '';
        try { quote = await store.quote(await linkedActor(await registeredVisitor(request), identity), id, identity?.owner.uid === p.ownerUid ? 'self' : 'creator', preview); }
        catch (error) { reason = error instanceof VoiceAdmissionError ? error.message : 'Usage is temporarily unavailable.'; }
        if ((!p.published || preview) && (!identity || !await identity.isCurrent())) return json({ error: 'Sign in again to continue.' }, 401);
        return json({ waveform: { id, name, accentColor, profilePhoto,
          ...(display.textPanel ? { textPanel: projectTextPanelConfiguration(display.textPanel) } : {}),
          ...(display.visualDisplay ? { visualDisplay: structuredClone(display.visualDisplay) } : {}) }, mode: p.settings.mode,
          adminVoiceReady: !!options.adminVoiceReady?.(),
          adminTesting,
          own, sponsoredSeconds: quote?.payer === 'creator' ? quote.seconds : 0, reason });
      } catch (error) { return failure(error); }
    },
    async checkoutPOST(request: Request) {
      if (!allowed(request, true)) return forbidden();
      try {
        if (!options.voiceReady?.() && !options.fixtures) return json({ error: 'Purchases are paused until reliable upstream enforcement is verified.' }, 503);
        const capacity = await store.capacity({ concurrency: 3, dailySeconds: 9_000 });
        if (capacity) return json({ error: capacity }, 409);
        const body = await paidJson(request);
        if (!validWaveformId(body.requestId) || Object.keys(body).some(k => !['requestId', 'destination'].includes(k))) return json({ error: 'Invalid checkout request.' }, 400);
        const a = await actor(request);
        const purchase = await store.beginPurchase(a, body.requestId, returnDestination(body.destination), pack);
        if (options.fixtures) return json({ url: `/checkout-test/${purchase.id}`, test: true });
        if (!options.stripe) return json({ error: 'Stripe sandbox checkout is not configured.' }, 503);
        return json({ url: await options.stripe.checkout(purchase), test: true });
      } catch (error) { return failure(error); }
    },
    async fixtureGET(request: Request) {
      if (!options.fixtures || !allowed(request, false)) return forbidden();
      try {
        const a = await actor(request);
        const purchase = await store.purchase(new URL(request.url).searchParams.get('id') ?? '');
        if (!purchase || !a.uid || purchase.uid !== a.uid) return json({ error: 'Purchase unavailable.' }, 404);
        return json({ pack: purchase.pack, destination: purchase.destination, status: purchase.status });
      } catch (error) { return failure(error); }
    },
    async fixturePOST(request: Request) {
      if (!options.fixtures || !allowed(request, true)) return forbidden();
      try {
        const body = await paidJson(request);
        if (Object.keys(body).some(k => k !== 'id') || !validWaveformId(body.id)) return json({ error: 'Invalid purchase.' }, 400);
        const a = await actor(request);
        const p = await store.purchase(body.id);
        if (!p || !a.uid || p.uid !== a.uid) return json({ error: 'Purchase unavailable.' }, 404);
        await store.fulfill(`evt_fixture_${p.id}`, p.id, { checkoutId: `cs_test_${p.id}`, paymentIntent: `pi_fixture_${p.id}`,
          uid: a.uid, amount: p.pack.amount, currency: p.pack.currency, packId: p.pack.id, seconds: p.pack.seconds, priceId: p.pack.priceId });
        return json({ destination: p.destination });
      } catch (error) { return failure(error); }
    },
  };
}
