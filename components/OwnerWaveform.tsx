'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import VoiceExperience from './VoiceExperience';
import PaidExperience from './PaidExperience';
import BrandLoader from './BrandLoader';
import type { Waveform } from '@/lib/account-model';
import { loadBilling, type BillingView } from '@/lib/paid-client';

export default function OwnerWaveform({ id }: { id: string }) {
  const [billing, setBilling] = useState<BillingView | null>(null);
  const [billingFailed, setBillingFailed] = useState(false);
  const [waveform, setWaveform] = useState<Pick<Waveform, 'id' | 'name' | 'accentColor' | 'profilePhoto' | 'textPanel'> | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'private' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    let controller: AbortController | null = null;
    const load = (changed = false) => {
      controller?.abort();
      const pending = new AbortController(); controller = pending;
      const requestedRevision = ++revision;
      const current = () => !cancelled && requestedRevision === revision;
      if (changed) { setWaveform(null); setState('loading'); setBilling(null); setBillingFailed(false); }
      // Resolve routing before mounting voice; an unknown billing mode is not disabled billing.
      void loadBilling(pending.signal).then(result => { if (current()) setBilling(result); })
        .catch(() => { if (current()) setBillingFailed(true); });
      void fetch(`/api/waveform?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal: pending.signal }).then(async response => {
        if (!current()) return;
        if (response.status === 401) { setState('signed-out'); return; }
        if (response.status === 404 || response.status === 403) { setState('private'); return; }
        if (!response.ok) throw new Error('Unavailable');
        const result = await response.json();
        if (!current()) return;
        if (result.waveform?.id !== id || typeof result.waveform.name !== 'string') { setState('private'); return; }
        setWaveform({ id: result.waveform.id, name: result.waveform.name,
          accentColor: result.waveform.accentColor, profilePhoto: result.waveform.profilePhoto, textPanel: result.waveform.textPanel });
        setState('ready');
      }).catch(() => { if (current()) setState('error'); });
    };
    const changed = () => load(true);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('flowpath-account') : null;
    channel?.addEventListener('message', changed);
    window.addEventListener('flowpath-account-change', changed);
    load();
    return () => { cancelled = true; controller?.abort(); channel?.close(); window.removeEventListener('flowpath-account-change', changed); };
  }, [id]);

  if (state === 'loading' || state === 'ready' && !billing && !billingFailed) return <BrandLoader variant="screen" label="Loading your waveform…" />;
  if (state === 'ready' && waveform && billing?.enabled) return <PaidExperience key={id} id={id} personal initialBilling={billing} />;
  if (state === 'ready' && waveform && billing && !billing.enabled) return <VoiceExperience key={waveform.id} waveformId={waveform.id} name={waveform.name}
    accentColor={waveform.accentColor} profilePhoto={waveform.profilePhoto} textPanel={waveform.textPanel} />;
  return <main className="account-page">
    <Link className="account-back" href="/">← Back to FlowPath</Link>
    <h1>Your waveform</h1>
    <p role="status">{state === 'signed-out' ? 'Sign in to open your private waveform.' : state === 'private' ? 'This waveform is private.' : 'Your waveform could not be loaded. Refresh to try again.'}</p>
    <Link className="secondary-button" href="/account">Go to my account</Link>
  </main>;
}
