'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { signInAccount, signOutAccount } from '@/lib/account-client';
import { WAVEFORM_NAME_LIMIT, WAVEFORM_PROMPT_LIMIT, type AccountMode, type AccountUser, type Waveform } from '@/lib/account-model';
import { DEFAULT_VOICE, VOICE_OPTIONS, isVoiceName, type VoiceName } from '@/lib/voice-options';

type Account = { mode: AccountMode; user: AccountUser | null };

async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Your changes could not be loaded. Please try again.');
  return result as T;
}

export default function AccountSettings() {
  const [account, setAccount] = useState<Account | null>(null);
  const [waveform, setWaveform] = useState<Waveform | null>(null);
  const [name, setName] = useState('');
  const [voice, setVoice] = useState<VoiceName>(DEFAULT_VOICE);
  const [initialPrompt, setInitialPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const accountRevision = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    const load = (changed = false) => {
      const requestedRevision = ++revision;
      const current = () => !cancelled && requestedRevision === revision;
      if (changed) {
        accountRevision.current++;
        setBusy(false); setLoading(true); setAccount(null); setWaveform(null); setName(''); setVoice(DEFAULT_VOICE); setInitialPrompt(''); setMessage(''); setError('');
      }
      void (async () => {
        const result = await readResponse<Account>(await fetch('/api/account', { cache: 'no-store' }));
        const saved = result.user ? await readResponse<{ waveform: Waveform | null }>(await fetch('/api/waveform', { cache: 'no-store' })) : null;
        if (!current()) return;
        setAccount(result);
        setWaveform(saved?.waveform ?? null);
        setName(saved?.waveform?.name ?? '');
        setVoice(saved?.waveform?.voice ?? DEFAULT_VOICE);
        setInitialPrompt(saved?.waveform?.initialPrompt ?? '');
      })().catch(() => { if (current()) setError('Your account could not be loaded. Refresh to try again.'); })
        .finally(() => { if (current()) setLoading(false); });
    };
    const changed = () => load(true);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('flowpath-account') : null;
    channel?.addEventListener('message', changed);
    window.addEventListener('flowpath-account-change', changed);
    load();
    return () => { cancelled = true; channel?.close(); window.removeEventListener('flowpath-account-change', changed); };
  }, []);

  async function signIn(localAccount?: string) {
    if (!account || account.mode === 'unavailable') return;
    setBusy(true); setError(''); setMessage('');
    try {
      await signInAccount(account.mode, localAccount);
    } catch (error) { setError(error instanceof Error ? error.message : 'Sign-in could not be completed. Please try again.'); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true); setError(''); setMessage('');
    try {
      await signOutAccount();
    } catch { setError('Sign-out could not be completed. Please try again.'); }
    finally { setBusy(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestedRevision = accountRevision.current;
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await readResponse<{ waveform: Waveform }>(await fetch('/api/waveform', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, voice, initialPrompt }),
      }));
      if (requestedRevision !== accountRevision.current) return;
      setWaveform(saved.waveform); setName(saved.waveform.name); setVoice(saved.waveform.voice); setInitialPrompt(saved.waveform.initialPrompt);
      setMessage('Saved. Your settings will apply to your next conversation.');
    } catch (error) { if (requestedRevision === accountRevision.current) setError(error instanceof Error ? error.message : 'Your waveform could not be saved. Please try again.'); }
    finally { if (requestedRevision === accountRevision.current) setBusy(false); }
  }

  return <main className="account-page">
    <Link className="account-back" href="/">← Back to FlowPath</Link>
    <h1>My waveform</h1>
    <p className="account-intro">Your voice, with a little direction from you.</p>
    {loading ? <p role="status">Loading your account…</p> : account?.user ? <>
      <div className="account-identity"><span>Signed in as {account.user.displayName}</span><button type="button" onClick={() => void signOut()} disabled={busy}>Sign out</button></div>
      {account.mode === 'local' && <p className="local-account-note">Local test account. No Google account or Firebase service is connected.</p>}
      <form onSubmit={event => void save(event)}>
        <label htmlFor="waveform-name">Waveform name</label>
        <input id="waveform-name" value={name} onChange={event => setName(event.target.value)} maxLength={WAVEFORM_NAME_LIMIT} required disabled={busy} autoComplete="off" placeholder="Tom’s assistant" />
        <label htmlFor="waveform-voice">Voice</label>
        <select id="waveform-voice" value={voice} onChange={event => { if (isVoiceName(event.target.value)) setVoice(event.target.value); }} disabled={busy} aria-describedby="voice-help">
          {VOICE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <p id="voice-help" className="field-help">{VOICE_OPTIONS.find(option => option.id === voice)?.description} Your choice applies to your next conversation.</p>
        <label htmlFor="initial-prompt">What should your voice know about itself?</label>
        <textarea id="initial-prompt" value={initialPrompt} onChange={event => setInitialPrompt(event.target.value)} maxLength={WAVEFORM_PROMPT_LIMIT} required rows={8} disabled={busy} aria-describedby="prompt-help" placeholder="You are Tom’s assistant. Speak warmly and keep your answers concise." />
        <p id="prompt-help" className="field-help">Give it an identity and a style. Conversations start fresh; these instructions don’t add tools or conversation memory.</p>
        <div className="account-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save waveform'}</button>{waveform && <Link className="secondary-button" href={`/w/${encodeURIComponent(waveform.id)}`}>Open waveform</Link>}</div>
      </form>
      {waveform && <p className="field-help">Your waveform is private. Only you can open it while signed in.</p>}
    </> : account ? <section className="account-sign-in" aria-label="Sign in">
      <p>Create an account to save one waveform and its starting instructions. It stays private to you.</p>
      {account.mode === 'local' ? <>
        <p className="local-account-note">Local preview: use a test account. This does not create a Google or Firebase account.</p>
        <div className="account-actions"><button className="primary-button" type="button" onClick={() => void signIn('owner-a')} disabled={busy}>Use test owner A</button><button className="secondary-button" type="button" onClick={() => void signIn('owner-b')} disabled={busy}>Use test owner B</button></div>
      </> : account.mode === 'firebase' ? <button className="primary-button" type="button" onClick={() => void signIn()} disabled={busy}>{busy ? 'Signing in…' : 'Continue with Google'}</button> : <p>Account sign-in is not connected for this preview.</p>}
    </section> : null}
    <p className="account-status" role="status" aria-live="polite">{message}</p>
    {error && <p className="account-error" role="alert">{error}</p>}
  </main>;
}
