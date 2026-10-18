'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import VoiceExperience from './VoiceExperience';
import type { Waveform } from '@/lib/account-model';

export default function OwnerWaveform({ id }: { id: string }) {
  const [waveform, setWaveform] = useState<Pick<Waveform, 'id' | 'name' | 'accentColor' | 'profilePhoto'> | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'private' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    const load = (changed = false) => {
      const requestedRevision = ++revision;
      const current = () => !cancelled && requestedRevision === revision;
      if (changed) { setWaveform(null); setState('loading'); }
      void fetch(`/api/waveform?id=${encodeURIComponent(id)}`, { cache: 'no-store' }).then(async response => {
        if (!current()) return;
        if (response.status === 401) { setState('signed-out'); return; }
        if (response.status === 404 || response.status === 403) { setState('private'); return; }
        if (!response.ok) throw new Error('Unavailable');
        const result = await response.json();
        if (!current()) return;
        if (result.waveform?.id !== id || typeof result.waveform.name !== 'string') { setState('private'); return; }
        setWaveform({ id: result.waveform.id, name: result.waveform.name,
          accentColor: result.waveform.accentColor, profilePhoto: result.waveform.profilePhoto });
        setState('ready');
      }).catch(() => { if (current()) setState('error'); });
    };
    const changed = () => load(true);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('flowpath-account') : null;
    channel?.addEventListener('message', changed);
    window.addEventListener('flowpath-account-change', changed);
    load();
    return () => { cancelled = true; channel?.close(); window.removeEventListener('flowpath-account-change', changed); };
  }, [id]);

  if (state === 'ready' && waveform) return <VoiceExperience key={waveform.id} waveformId={waveform.id} name={waveform.name}
    accentColor={waveform.accentColor} profilePhoto={waveform.profilePhoto} />;
  return <main className="account-page">
    <Link className="account-back" href="/">← Back to FlowPath</Link>
    <h1>Your waveform</h1>
    <p role="status">{state === 'loading' ? 'Loading your waveform…' : state === 'signed-out' ? 'Sign in to open your private waveform.' : state === 'private' ? 'This waveform is private.' : 'Your waveform could not be loaded. Refresh to try again.'}</p>
    {state !== 'loading' && <Link className="secondary-button" href="/account">Go to my account</Link>}
  </main>;
}
