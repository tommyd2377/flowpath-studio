'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { loadBilling, paidRead, startCheckout, type BillingView } from '@/lib/paid-client';
import { packLabel, type PublicWaveform } from '@/lib/paid-model';
import VoiceExperience from './VoiceExperience';
import { clientAnalytics } from '@/lib/analytics-runtime';
import { liveTextPanelEnabled } from '@/lib/text-panel';

type PublicView = { waveform: PublicWaveform; mode: string; sponsoredSeconds: number; own: boolean; reason: string; adminTesting?: boolean; adminVoiceReady?: boolean };
export default function PaidExperience({ id, personal = false }: { id: string; personal?: boolean }) {
  const [billing, setBilling] = useState<BillingView | null>(null);
  const [view, setView] = useState<PublicView | null>(null);
  const [payer, setPayer] = useState<'creator' | 'self' | undefined>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [finished, setFinished] = useState(false);
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    if (view && billing && (view.own || view.sponsoredSeconds < 1)) clientAnalytics.record({ eventName: 'paywall_shown', properties: { mode: view.mode } });
  }, [view, billing]);
  const destination = `/${personal ? 'w' : 'p'}/${id}`;
  useEffect(() => {
    const changed = () => { setPayer(undefined); setView(null); setBilling(null); setFinished(false); setMessage(''); setRevision(r => r + 1); };
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('flowpath-account') : null;
    channel?.addEventListener('message', changed);
    window.addEventListener('flowpath-account-change', changed);
    return () => { channel?.close(); window.removeEventListener('flowpath-account-change', changed); };
  }, []);
  useEffect(() => {
    let current = true;
    void (async () => {
      const b = await loadBilling();
      if (!b.enabled) throw new Error('This waveform is unavailable.');
      const p = await paidRead<PublicView>(`/api/published?id=${id}`);
      if (current) {
        setBilling(b); setView(p);
        const checkout = new URL(location.href).searchParams.get('checkout');
        if (checkout === 'canceled') setMessage('Checkout canceled. No conversation has started.');
        else if (checkout === 'returned') setMessage(b.purchaseStatus === 'paid'
          ? 'Payment confirmed. Choose Continue when you’re ready; no conversation has started.'
          : b.purchaseStatus === 'failed' ? 'Payment was not completed. No conversation has started.'
            : 'Payment confirmation is pending. Refresh to check; the return page does not grant minutes.');
      }
    })().catch(error => { if (current) setMessage(error.message); });
    return () => { current = false; };
  }, [id, revision]);
  const nextConversation = () => { setPayer(undefined); setView(null); setBilling(null); setFinished(false); setRevision(r => r + 1); };
  if ((payer || view?.adminTesting && view.adminVoiceReady) && view) return <VoiceExperience key={id} waveformId={id} name={view.waveform.name} accentColor={view.waveform.accentColor}
    profilePhoto={view.waveform.profilePhoto} textPanel={view.waveform.textPanel} analyticsSurface={personal ? 'private' : 'public'} paidPayer={payer}
    nextConversation={finished && payer ? nextConversation : undefined}
    onSettled={() => { if (liveTextPanelEnabled(view.waveform.textPanel)) setFinished(true); else nextConversation(); }} />;
  const canSponsor = !!view && !view.own && view.sponsoredSeconds > 0;
  return <main className="account-page paid-experience">
    <Link className="account-back" href="/">← Back to FlowPath</Link>
    <h1>{view?.waveform.name ?? 'Voice experience'}</h1>
    <p>AI-generated voice experience</p>
    {billing?.fixtures && <p className="local-account-note">Synthetic test preview. No real charge or paid voice call.</p>}
    {!view && !message && <p role="status">Loading experience…</p>}
    {view && billing && <>
      {!billing.voiceReady && <p role="status">{billing.capacityMessage}</p>}
      {canSponsor ? <>
        <p>The creator pays. {view.mode === 'intro' ? `${view.sponsoredSeconds} sponsored seconds available in the next conversation. Your introductory allowance is cumulative.`
          : 'No configured per-visitor allowance. Creator funds, their finite sponsorship budget and safety limits apply.'}</p>
        <button className="primary-button" type="button" disabled={!billing.voiceReady} onClick={() => { clientAnalytics.record({ eventName: 'payer_selected', properties: { payer: 'creator' } }); setPayer('creator'); }}>Continue with creator-funded time</button>
      </> : <p>{view.own ? 'Your personal usage uses your prepaid balance.' : view.reason || 'An account and available paid minutes are needed to continue.'}</p>}
      {!canSponsor && (!billing.signedIn ? <>
        <Link className="primary-button" href={`/account?returnTo=${encodeURIComponent(destination)}`}>Sign up or log in to continue</Link>
      </> : (billing.wallet?.available ?? 0) > 0 ? <>
        <p>{billing.wallet?.available} paid seconds available. The next conversation will use your balance only if you choose to continue.</p>
        <button className="primary-button" type="button" disabled={!billing.voiceReady} onClick={() => { clientAnalytics.record({ eventName: 'payer_selected', properties: { payer: 'self' } }); setPayer('self'); }}>Continue using my own balance</button>
      </> : <>
        <p>{packLabel(billing.pack)}. No subscription or automatic top-ups.</p>
        <button className="primary-button" type="button" disabled={busy || !billing.checkoutReady || !billing.voiceReady} onClick={() => {
          if (busy) return; setBusy(true); requestId.current ??= crypto.randomUUID();
          void startCheckout(destination, requestId.current).catch(error => { setMessage(error.message); setBusy(false); });
        }}>{billing.fixtures ? 'Get a synthetic test pack' : 'Buy minutes'}</button>
      </>)}
      <p className="field-help">Anonymous allowance uses persistent browser storage. Clearing it or changing devices can create a new identity. Signing in carries consumed allowance forward.</p>
    </>}
    {message && <p role="alert">{message}</p>}
  </main>;
}
