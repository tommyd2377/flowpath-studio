'use client';

import { useEffect, useState } from 'react';
import { PLUGINS } from '@/lib/plugin-contract';
import type { PluginAccessView, ProtectedPlugin } from '@/lib/plugin-access';

export default function PluginAccessSettings({ id, applied }: { id: string; applied: ProtectedPlugin[] }) {
  const endpoint = `/api/plugin-access?waveformId=${encodeURIComponent(id)}`;
  const [saved, setSaved] = useState<PluginAccessView>();
  const [selected, setSelected] = useState<ProtectedPlugin[]>([]);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) return;
      const view: PluginAccessView = await response.json();
      setSaved(view);
      setSelected(view.protectedPlugins);
    }).catch(() => {});
    return () => controller.abort();
  }, [endpoint]);
  if (!saved) return null;

  async function save() {
    if (!saved || busy) return;
    setBusy(true);
    setStatus('');
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: saved.revision, protectedPlugins: selected.filter(plugin => applied.includes(plugin)), ...(code ? { code } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setSaved(result);
      setSelected(result.protectedPlugins);
      setCode('');
      setStatus('Plugin protection saved.');
      if (typeof BroadcastChannel !== 'undefined') {
        const updates = new BroadcastChannel('flowpath-plugin-policy');
        updates.postMessage(id);
        updates.close();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Plugin protection could not be saved.');
    } finally { setBusy(false); }
  }
  return <fieldset disabled={busy}>
    <legend>Plugin access</legend>
    {PLUGINS.filter(plugin => applied.includes(plugin.id)).map(plugin => <div key={plugin.id}>
      <label><input type="checkbox" checked={selected.includes(plugin.id)} onChange={event => {
        const checked = event.target.checked;
        setSelected(ids => checked ? [...ids, plugin.id] : ids.filter(id => id !== plugin.id));
      }} /> Require access code for {plugin.name}</label>
    </div>)}
    {selected.some(id => applied.includes(id)) && <label>{saved.codeConfigured ? 'Replace shared access code (optional)' : 'Shared access code'}
      <input type="password" autoComplete="new-password" value={code} maxLength={128} onChange={event => setCode(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }} />
    </label>}
    <button type="button" className="secondary-button" onClick={() => void save()}>Save plugin access</button>
    <p role="status">{status}</p>
  </fieldset>;
}
