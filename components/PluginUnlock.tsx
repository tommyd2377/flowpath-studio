'use client';

import { useState } from 'react';
import { PLUGINS } from '@/lib/plugin-contract';
import type { ProtectedPlugin } from '@/lib/plugin-access';
import type { Waveform } from '@/lib/account-model';
import styles from './PluginUnlock.module.css';

export type PluginPlayback = Pick<Waveform, 'textPanel' | 'visualDisplay'> & {
  locked: ProtectedPlugin[];
  expiresAt?: number;
};

export default function PluginUnlock({ id, locked, session, onUnlock, onBusy, disabled, publicDemo }: {
  id: string; publicDemo?: boolean; locked: ProtectedPlugin[]; onBusy(busy: boolean): void; disabled: boolean; session(): string | undefined; onUnlock(view: PluginPlayback): void;
}) {
  const [selected, setSelected] = useState<ProtectedPlugin | ''>('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  if (!locked.length) return null;
  const target = selected && locked.includes(selected) ? selected : locked[0];
  const endpoint = `/api/plugin-access?waveformId=${encodeURIComponent(id)}${publicDemo ? '&audience=curated' : ''}`;
  return <details className={styles.unlock} onKeyDown={event => {
    if (event.key !== 'Escape' || !event.currentTarget.open) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.open = false;
    event.currentTarget.querySelector('summary')?.focus();
  }}><summary>Unlock plugins</summary><form aria-label="Unlock a plugin" onSubmit={async event => {
    event.preventDefault();
    if (busy || disabled) return;
    setBusy(true);
    onBusy(true);
    setStatus('');
    try {
      const sessionId = session();
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, plugins: [target], ...(sessionId ? { sessionId } : {}) }) });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? 'Plugin access is unavailable.');
      const playback = await fetch(`${endpoint}&playback=1`, { cache: 'no-store' });
      if (!playback.ok) throw new Error('Plugin access could not be refreshed.');
      onUnlock(await playback.json());
      setCode('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The plugin could not be unlocked.');
    } finally { setBusy(false); onBusy(false); }
  }}>
    <label>Plugin <select disabled={busy || disabled} value={target} onChange={event => setSelected(event.target.value as ProtectedPlugin)}>
      {PLUGINS.filter(plugin => locked.includes(plugin.id)).map(plugin => <option key={plugin.id} value={plugin.id}>{plugin.name}</option>)}
    </select></label>
    <label>Access code <input type="password" disabled={busy || disabled} required autoComplete="off" maxLength={128} value={code} onChange={event => setCode(event.target.value)} /></label>
    <button type="submit" className="secondary-button" disabled={busy || disabled}>Unlock plugin</button>
    <p role="status">{status}</p>
  </form></details>;
}
