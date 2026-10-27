'use client';
import { useEffect, useState, type FormEvent } from 'react';
import BrandLoader from './BrandLoader';

export default function DemoCodeGate({ onState, onAccess }: { onState?: (required: boolean) => void; onAccess?: (allowed: boolean) => void }) {
  const [required, setRequired] = useState(false), [accepted, setAccepted] = useState(false);
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    void fetch('/api/demo-access', { cache: 'no-store' }).then(async response => {
      if (!response.ok) return;
      const result = await response.json();
      if (current) { setRequired(result.enabled === true); setAccepted(result.allowed === true); onState?.(result.enabled === true); onAccess?.(result.enabled !== true || result.allowed === true); }
    }).catch(() => undefined);
    return () => { current = false; };
  }, [onState, onAccess]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const response = await fetch('/api/demo-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const result = await response.json();
      if (!response.ok || result.allowed !== true) throw new Error(result.error ?? 'The demo code could not be checked.');
      setAccepted(true); setCode(''); onAccess?.(true);
    } catch (error) { setError(error instanceof Error ? error.message : 'The demo code could not be checked.'); }
    finally { setBusy(false); }
  }
  if (!required) return null;
  return <div className="demo-code-gate">
    {accepted ? <p role="status">Demo unlocked</p> : <form onSubmit={submit}>
      <label htmlFor="demo-code">Demo code</label><div className="demo-code-entry"><input id="demo-code" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={80} required value={code} onChange={event => setCode(event.target.value)} disabled={busy} />
        <button className="secondary-button" disabled={busy} type="submit">{busy ? <BrandLoader variant="inline" label="Checking code…" /> : 'Unlock demo'}</button></div>
      {error && <p role="alert">{error}</p>}
    </form>}
  </div>;
}
