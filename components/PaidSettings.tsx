'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PAYMENT_SETTINGS, packLabel, type PaymentSettings } from '@/lib/paid-model';
import { loadBilling, paidRead, startCheckout, type BillingView } from '@/lib/paid-client';

type PublishingView = { id: string; published: boolean; settings: PaymentSettings; spent: number; held: number };
export default function PaidSettings({ waveformId }: { waveformId: string }) {
  const [billing, setBilling] = useState<BillingView | null>(null);
  const [publication, setPublication] = useState<PublishingView | null>(null);
  const [settings, setSettings] = useState(DEFAULT_PAYMENT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [copyReady, setCopyReady] = useState(false);
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    let current = true;
    void (async () => {
      const b = await loadBilling(); if (!current) return; setBilling(b);
      if (!b.enabled) return;
      const p = await paidRead<PublishingView>('/api/publishing');
      if (current) { setPublication(p); setSettings(p.settings); }
    })().catch(error => { if (current) setMessage(error.message); });
    return () => { current = false; };
  }, [waveformId]);
  async function save(published: boolean) {
    if (busy) return;
    setBusy(true); setMessage(''); setCopyReady(false);
    try {
      const p = await paidRead<PublishingView>('/api/publishing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings, published }) });
      setPublication(p); setSettings(p.settings); setBilling(await loadBilling());
      setMessage(published ? 'Published. Your link is ready.' : 'Private. New visitor sessions are blocked. Active sessions finish their existing reserved segment.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally { setBusy(false); }
  }
  if (!billing?.enabled) return message ? <p className="account-error">{message}</p> : null;
  return <section className="paid-settings" aria-label="Publishing and prepaid minutes">
    <h2>Minutes and publishing</h2>
    <p>{billing.fixtures ? 'Synthetic test preview — no payment or real voice service.' : 'Sandbox preview — live payments are disabled.'}</p>
    <p>{Math.floor((billing.wallet?.available ?? 0) / 60)} minutes available · {billing.wallet?.allocated ?? 0} seconds allocated to sponsorship · {billing.wallet?.held ?? 0} seconds on hold.</p>
    <p>{packLabel(billing.pack)}. One prepaid pack for personal use and sponsorship. No subscription or automatic top-ups.</p>
    {!billing.voiceReady && <p>{billing.capacityMessage}</p>}
    <button className="secondary-button" type="button" disabled={busy || !billing.checkoutReady || !billing.voiceReady} onClick={() => {
      if (busy) return; setBusy(true); requestId.current ??= crypto.randomUUID();
      void startCheckout(`/w/${waveformId}`, requestId.current).catch(error => { setMessage(error.message); setBusy(false); });
    }}>{billing.fixtures ? 'Get a synthetic test pack' : 'Buy minutes'}</button>
    <label htmlFor="payment-mode">Who pays for visitors?</label>
    <select id="payment-mode" value={settings.mode} disabled={busy || !publication} onChange={e => setSettings({ ...settings, mode: e.target.value as PaymentSettings['mode'] })}>
      <option value="creator">Creator pays</option><option value="intro">Introductory allowance</option><option value="visitor">Visitor pays</option>
    </select>
    {settings.mode !== 'visitor' && <>
      <label htmlFor="sponsor-budget">Finite sponsorship budget (minutes, including time already spent)</label>
      <input id="sponsor-budget" type="number" min={1 / 60} step="any" max={10000000 / 60} value={settings.budgetSeconds / 60} disabled={busy || !publication} onChange={e => setSettings({ ...settings, budgetSeconds: Math.round(Number(e.target.value) * 60) })} />
      <p className="field-help">Allocated from your prepaid balance. Personal use and other waveforms cannot spend these allocated minutes. Creator pays has no configured per-visitor allowance; funds, this budget and safety limits still apply.</p>
    </>}
    {settings.mode === 'intro' && <><label htmlFor="intro-minutes">Sponsored minutes per visitor</label>
      <input id="intro-minutes" type="number" min={1 / 60} step="any" max={1440} value={settings.allowanceSeconds / 60} disabled={busy || !publication} onChange={e => setSettings({ ...settings, allowanceSeconds: Math.round(Number(e.target.value) * 60) })} />
      <p className="field-help">Cumulative across conversations and refreshes. Anonymous storage cannot guarantee one allowance per human across cleared cookies or different devices.</p></>}
    <p>AI-generated voice experience. Publishing exposes your name, color and portrait. Instructions stay server-side, but cannot be guaranteed secret from a conversation.</p>
    <p>{publication?.published ? 'Published' : 'Private'} · {publication?.spent ?? 0} sponsored seconds spent · {publication?.held ?? 0} reserved.</p>
    <div className="account-actions">
      <button className="primary-button" type="button" disabled={busy || !publication} onClick={() => void save(true)}>{publication?.published ? 'Save published settings' : 'Publish'}</button>
      {publication?.published && <><button className="secondary-button" type="button" disabled={busy} onClick={() => {
        setCopyReady(true);
        if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(`${location.origin}/p/${waveformId}`)
          .then(() => setMessage('Link copied.')).catch(() => setMessage('Select and copy the link below.'));
      }}>Copy link</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void save(false)}>Unpublish</button></>}
    </div>
    {copyReady && <div><label htmlFor="published-link">Select and copy your link</label><input id="published-link" readOnly value={`${location.origin}/p/${waveformId}`} onFocus={e => e.target.select()} autoFocus /></div>}
    {publication?.published && <Link className="account-back" href={`/p/${waveformId}`}>Open published experience</Link>}
    <p role="status">{message}</p>
  </section>;
}
