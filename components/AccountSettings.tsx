'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { signInAccount, signOutAccount } from '@/lib/account-client';
import { WAVEFORM_DEFAULT_COLOR, WAVEFORM_NAME_LIMIT, WAVEFORM_PROMPT_LIMIT, type AccountMode, type AccountUser, type Waveform } from '@/lib/account-model';
import { appearanceTheme } from '@/lib/appearance-theme';
import { prepareProfilePhoto } from '@/lib/prepare-profile-photo';
import { DEFAULT_VOICE, VOICE_OPTIONS, isVoiceName, type VoiceName } from '@/lib/voice-options';

type Account = { mode: AccountMode; user: AccountUser | null };

function normalizedColor(value: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

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
  const [accentColor, setAccentColor] = useState(WAVEFORM_DEFAULT_COLOR);
  const [previewColor, setPreviewColor] = useState(WAVEFORM_DEFAULT_COLOR);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const accountRevision = useRef(0);
  const photoRevision = useRef<symbol | null>(null);

  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    const load = (changed = false) => {
      const requestedRevision = ++revision;
      const current = () => !cancelled && requestedRevision === revision;
      if (changed) {
        accountRevision.current++;
        photoRevision.current = null;
        setAccentColor(WAVEFORM_DEFAULT_COLOR); setPreviewColor(WAVEFORM_DEFAULT_COLOR); setProfilePhoto(null); setPreparingPhoto(false);
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
        setAccentColor(saved?.waveform?.accentColor ?? WAVEFORM_DEFAULT_COLOR);
        setPreviewColor(saved?.waveform?.accentColor ?? WAVEFORM_DEFAULT_COLOR);
        setProfilePhoto(saved?.waveform?.profilePhoto ?? null);
      })().catch(() => { if (current()) setError('Your account could not be loaded. Refresh to try again.'); })
        .finally(() => { if (current()) setLoading(false); });
    };
    const changed = () => load(true);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('flowpath-account') : null;
    channel?.addEventListener('message', changed);
    window.addEventListener('flowpath-account-change', changed);
    load();
    return () => { cancelled = true; photoRevision.current = null; channel?.close(); window.removeEventListener('flowpath-account-change', changed); };
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
    if (preparingPhoto) return;
    const color = normalizedColor(accentColor);
    if (!color) { setError('Enter a six-digit hex color, such as #ddbf92.'); return; }
    const requestedRevision = accountRevision.current;
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await readResponse<{ waveform: Waveform }>(await fetch('/api/waveform', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, voice, initialPrompt, accentColor: color, profilePhoto }),
      }));
      if (requestedRevision !== accountRevision.current) return;
      setWaveform(saved.waveform); setName(saved.waveform.name); setVoice(saved.waveform.voice); setInitialPrompt(saved.waveform.initialPrompt);
      setAccentColor(saved.waveform.accentColor); setPreviewColor(saved.waveform.accentColor); setProfilePhoto(saved.waveform.profilePhoto);
      setMessage('Saved. Your settings will apply to your next conversation.');
    } catch (error) { if (requestedRevision === accountRevision.current) setError(error instanceof Error ? error.message : 'Your waveform could not be saved. Please try again.'); }
    finally { if (requestedRevision === accountRevision.current) setBusy(false); }
  }

  function changeColor(value: string) {
    setAccentColor(value);
    const normalized = normalizedColor(value);
    if (normalized) setPreviewColor(normalized);
  }

  async function choosePhoto(file: File) {
    const requestedRevision = Symbol();
    photoRevision.current = requestedRevision;
    setPreparingPhoto(true); setError(''); setMessage('');
    try {
      const photo = await prepareProfilePhoto(file);
      if (requestedRevision === photoRevision.current) setProfilePhoto(photo);
    } catch (error) {
      if (requestedRevision === photoRevision.current) setError(error instanceof Error ? error.message : 'That photo could not be opened. Try another image.');
    } finally {
      if (requestedRevision === photoRevision.current) setPreparingPhoto(false);
    }
  }

  return <main className="account-page" style={appearanceTheme(previewColor)}>
    <Link className="account-back" href="/">← Back to FlowPath</Link>
    <h1>My waveform</h1>
    <p className="account-intro">Your voice, with a little direction from you.</p>
    {loading ? <p role="status">Loading your account…</p> : account?.user ? <>
      <div className="account-identity"><span>Signed in as {account.user.displayName}</span><button type="button" onClick={() => void signOut()} disabled={busy}>Sign out</button></div>
      {account.mode === 'local' && <p className="local-account-note">Local test account. No Google account or Firebase service is connected.</p>}
      <form onSubmit={event => void save(event)}>
        <label htmlFor="waveform-name">Waveform name</label>
        <input id="waveform-name" value={name} onChange={event => setName(event.target.value)} maxLength={WAVEFORM_NAME_LIMIT} required disabled={busy} autoComplete="off" placeholder="Tom’s assistant" />
        <div className="appearance-colors">
          <div><label htmlFor="waveform-color">Waveform color</label><input id="waveform-color" type="color" value={previewColor} onChange={event => changeColor(event.target.value)} disabled={busy} aria-describedby="color-help" /></div>
          <div><label htmlFor="waveform-color-hex">Color hex code</label><input id="waveform-color-hex" value={accentColor} onChange={event => changeColor(event.target.value)} pattern="#?[0-9a-fA-F]{6}" maxLength={7} required disabled={busy} autoComplete="off" spellCheck={false} title="Enter a six-digit hex color, such as #ddbf92." aria-describedby="color-help" /></div>
        </div>
        <p id="color-help" className="field-help">Choose any color or enter its hex code. It colors your waveform and its page.</p>
        <label htmlFor="profile-photo">Profile photo</label>
        <div className="profile-photo-field">
          {/* A private, validated data URL is rendered locally, with no image proxy. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {profilePhoto && <img className="profile-photo-preview" src={profilePhoto} alt="Profile photo preview" width={64} height={64} />}
          <div className="profile-photo-controls"><input id="profile-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || preparingPhoto} aria-describedby="photo-help" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void choosePhoto(file); }} />
            {profilePhoto && <button className="photo-remove" type="button" disabled={busy || preparingPhoto} onClick={() => { photoRevision.current = null; setProfilePhoto(null); setMessage(''); }}>Remove photo</button>}</div>
        </div>
        <p id="photo-help" className="field-help">JPEG, PNG or WebP, up to 5 MB. We crop the center into a small round portrait. {preparingPhoto ? 'Preparing your photo…' : 'Save to keep it with your waveform.'}</p>
        <label htmlFor="waveform-voice">Voice</label>
        <select id="waveform-voice" value={voice} onChange={event => { if (isVoiceName(event.target.value)) setVoice(event.target.value); }} disabled={busy} aria-describedby="voice-help">
          {VOICE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <p id="voice-help" className="field-help">{VOICE_OPTIONS.find(option => option.id === voice)?.description} Your choice applies to your next conversation.</p>
        <label htmlFor="initial-prompt">What should your voice know about itself?</label>
        <textarea id="initial-prompt" value={initialPrompt} onChange={event => setInitialPrompt(event.target.value)} maxLength={WAVEFORM_PROMPT_LIMIT} required rows={8} disabled={busy} aria-describedby="prompt-help" placeholder="You are Tom’s assistant. Speak warmly and keep your answers concise." />
        <p id="prompt-help" className="field-help">Give it an identity and a style, up to {WAVEFORM_PROMPT_LIMIT.toLocaleString('en-US')} characters. Conversations start fresh; these instructions don’t add tools or conversation memory.</p>
        <div className="account-actions"><button className="primary-button" type="submit" disabled={busy || preparingPhoto}>{busy ? 'Saving…' : 'Save waveform'}</button>{waveform && <Link className="secondary-button" href={`/w/${encodeURIComponent(waveform.id)}`}>Open waveform</Link>}</div>
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
