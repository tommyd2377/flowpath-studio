'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { authenticateWithEmail, signInAccount, signOutAccount, type EmailAccountAction } from '@/lib/account-client';
import { WAVEFORM_DEFAULT_COLOR, WAVEFORM_NAME_LIMIT, WAVEFORM_PROMPT_LIMIT, type AccountMode, type AccountUser, type Waveform } from '@/lib/account-model';
import { appearanceTheme } from '@/lib/appearance-theme';
import { prepareProfilePhoto } from '@/lib/prepare-profile-photo';
import { DEFAULT_VOICE, VOICE_OPTIONS, isVoiceName, type VoiceName } from '@/lib/voice-options';
import PaidSettings from './PaidSettings';
import { returnDestination } from '@/lib/paid-model';
import { useCreationReview } from '@/lib/use-creation-review';
import CreationSafetyStatus from './CreationSafetyStatus';
import CreationReviewQueue from './CreationReviewQueue';
import { clientAnalytics, observeVisit } from '@/lib/analytics-runtime';
import type { TextPanelConfiguration } from '@/lib/text-panel';
import { PLUGINS } from '@/lib/plugin-contract';
import BrandLoader from './BrandLoader';
import DemoCodeGate from './DemoCodeGate';
import WaveformSettingsPreview from './WaveformSettingsPreview';
import { AudioLines, BookOpen, LockKeyhole, MessageSquareText, Puzzle, Settings2, SlidersHorizontal, TextCursorInput, ArrowUpRight, Mail } from 'lucide-react';

type Account = { mode: AccountMode; user: AccountUser | null; creationSafetyEnabled?: boolean; safetyAdminFixture?: boolean; localUnmeteredTesting?: boolean; hostedTesterDemo?: boolean };

function normalizedColor(value: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

class ReviewRequiredError extends Error {
  constructor(message: string, readonly reviewStatus: 'stale' | 'unavailable') { super(message); }
}

async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json();
  if (!response.ok && result.reviewRequired === true) throw new ReviewRequiredError(result.error, response.status === 503 ? 'unavailable' : 'stale');
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Your changes could not be loaded. Please try again.');
  return result as T;
}

export default function AccountSettings() {
  const [account, setAccount] = useState<Account | null>(null);
  const [demoAllowed, setDemoAllowed] = useState(false);
  const [waveform, setWaveform] = useState<Waveform | null>(null);
  const [name, setName] = useState('');
  const [voice, setVoice] = useState<VoiceName>(DEFAULT_VOICE);
  const [initialPrompt, setInitialPrompt] = useState('');
  const [textPanel, setTextPanel] = useState<TextPanelConfiguration | null>(null);
  const [section, setSection] = useState<'appearance' | 'instructions' | 'plugins' | 'sharing' | 'account'>('appearance');
  const [adminTesting, setAdminTesting] = useState(false);
  const promptTooLong = initialPrompt.length > WAVEFORM_PROMPT_LIMIT;
  const [accentColor, setAccentColor] = useState(WAVEFORM_DEFAULT_COLOR);
  const [previewColor, setPreviewColor] = useState(WAVEFORM_DEFAULT_COLOR);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busy = busyAction !== null;
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailAction, setEmailAction] = useState<Exclude<EmailAccountAction, 'resend-verification'>>('sign-in');
  const [showEmail, setShowEmail] = useState(false);
  const [verificationAvailable, setVerificationAvailable] = useState(false);
  const [returnTo, setReturnTo] = useState('/account');
  const accountRevision = useRef(0);
  const photoRevision = useRef<symbol | null>(null);
  const safety = useCreationReview({ enabled: !!account?.creationSafetyEnabled && !!account.user && (!account.hostedTesterDemo || demoAllowed),
    candidate: { name, initialPrompt, textPanel, profilePhoto }, ownerKey: account?.user?.uid ?? '',
    automatic: !waveform || name !== waveform.name || initialPrompt !== waveform.initialPrompt
      || JSON.stringify(textPanel) !== JSON.stringify(waveform.textPanel ?? null) || profilePhoto !== waveform.profilePhoto });
  useEffect(() => { observeVisit('account'); clientAnalytics.record({ eventName: 'creation_step', properties: { step: 'opened', outcome: 'success' } }); }, []);
  useEffect(() => {
    if (safety.status) clientAnalytics.record({ eventName: 'creation_step', properties: {
      step: safety.status === 'allowed' ? 'review_approved' : safety.status === 'blocked' || safety.status === 'manual-review' ? 'review_rejected' : 'review_pending',
      outcome: safety.status === 'blocked' || safety.status === 'manual-review' || safety.status === 'unavailable' ? 'blocked' : 'success',
    } });
  }, [safety.status]);

  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    const load = (changed = false) => {
      const requestedRevision = ++revision;
      const current = () => !cancelled && requestedRevision === revision;
      if (changed) {
        setTextPanel(null);
        setSection('appearance');
        setAdminTesting(false);
        accountRevision.current++;
        photoRevision.current = null;
        setAccentColor(WAVEFORM_DEFAULT_COLOR); setPreviewColor(WAVEFORM_DEFAULT_COLOR); setProfilePhoto(null); setPreparingPhoto(false);
        setEmail(''); setPassword(''); setEmailAction('sign-in'); setVerificationAvailable(false);
        setBusyAction(null); setLoading(true); setAccount(null); setWaveform(null); setName(''); setVoice(DEFAULT_VOICE); setInitialPrompt(''); setMessage(''); setError('');
      }
      void (async () => {
        const result = await readResponse<Account>(await fetch('/api/account', { cache: 'no-store' }));
        const saved = result.user ? await readResponse<{ waveform: Waveform | null }>(await fetch('/api/waveform', { cache: 'no-store' })) : null;
        if (!current()) return;
        setReturnTo(returnDestination(new URL(location.href).searchParams.get('returnTo')));
        setAccount(result);
        setWaveform(saved?.waveform ?? null);
        setName(saved?.waveform?.name ?? '');
        setVoice(saved?.waveform?.voice ?? DEFAULT_VOICE);
        setInitialPrompt(saved?.waveform?.initialPrompt ?? '');
        setTextPanel(saved?.waveform?.textPanel ?? null);
        setAdminTesting(result.user?.role === 'admin' && saved?.waveform?.adminTesting === true);
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
    setBusyAction(localAccount ?? 'google'); setError(''); setMessage('');
    try {
      await signInAccount(account.mode, localAccount);
    } catch (error) { setError(error instanceof Error ? error.message : 'Sign-in could not be completed. Please try again.'); }
    finally { setBusyAction(null); }
  }

  async function signOut() {
    setBusyAction('sign-out'); setError(''); setMessage('');
    try {
      await signOutAccount();
    } catch { setError('Sign-out could not be completed. Please try again.'); }
    finally { setBusyAction(null); }
  }

  function chooseEmailAction(action: typeof emailAction) {
    setEmailAction(action); setShowEmail(action !== 'create-account'); setPassword(''); setError(''); setMessage('');
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || account?.mode !== 'firebase') return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const action = submitter?.getAttribute('value') === 'resend-verification' ? 'resend-verification' : emailAction;
    if (action === 'create-account' && !demoAllowed) { setError('Unlock beta access above before creating an account.'); return; }
    const requestedRevision = accountRevision.current;
    setBusyAction(action); setError(''); setMessage('');
    try {
      const result = await authenticateWithEmail(action, email, password);
      if (requestedRevision !== accountRevision.current) return;
      if (result === 'verification-sent' || result === 'verification-required') {
        setEmailAction('sign-in'); setVerificationAvailable(true);
        setMessage(result === 'verification-sent'
          ? `Check your inbox for a verification link, then sign in here. Enter your password again if you need to resend the email.`
          : `Verify your email before signing in. Check your inbox, or enter your password again to resend the verification email.`);
      } else if (result === 'password-reset-sent') {
        setMessage('If an account uses that email, a password reset link is on its way.');
      }
    } catch (error) {
      if (requestedRevision === accountRevision.current) setError(error instanceof Error ? error.message : 'Your account request could not be completed. Please try again.');
    } finally {
      if (requestedRevision === accountRevision.current) { setBusyAction(null); setPassword(''); }
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || preparingPhoto) return;
    const invalid = event.currentTarget.querySelector<HTMLInputElement | HTMLTextAreaElement>(':invalid');
    if (invalid) {
      setSection(invalid.id === 'initial-prompt' ? 'instructions' : 'appearance');
      requestAnimationFrame(() => invalid.reportValidity());
      return;
    }
    if (!safety.canSave) { setError('This version must pass its safety review before saving.'); return; }
    if (promptTooLong) { setError(`Your full prompt is still in the editor. Shorten it to ${WAVEFORM_PROMPT_LIMIT.toLocaleString('en-US')} characters before saving.`); return; }
    const color = normalizedColor(accentColor);
    if (!color) { setError(`Enter a six-digit hex color, such as ${WAVEFORM_DEFAULT_COLOR}.`); return; }
    const requestedRevision = accountRevision.current;
    setBusyAction('save'); setError(''); setMessage('');
    try {
      const saved = await readResponse<{ waveform: Waveform }>(await fetch('/api/waveform', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, voice, initialPrompt, accentColor: color, profilePhoto, textPanel,
          ...(account?.user?.role === 'admin' ? { adminTesting } : {}) }),
      }));
      if (requestedRevision !== accountRevision.current) return;
      setWaveform(saved.waveform); setName(saved.waveform.name); setVoice(saved.waveform.voice); setInitialPrompt(saved.waveform.initialPrompt);
      setTextPanel(saved.waveform.textPanel ?? null);
      setAdminTesting(account?.user?.role === 'admin' && saved.waveform.adminTesting === true);
      setAccentColor(saved.waveform.accentColor); setPreviewColor(saved.waveform.accentColor); setProfilePhoto(saved.waveform.profilePhoto);
      setMessage('Saved. Your draft is private until you publish it.');
      clientAnalytics.record({ eventName: 'creation_step', properties: { step: 'saved', outcome: 'success' } });
    } catch (error) { if (requestedRevision === accountRevision.current) {
      if (error instanceof ReviewRequiredError) safety.invalidateReview(error.reviewStatus);
      setError(error instanceof Error ? error.message : 'Your waveform could not be saved. Please try again.');
    } }
    finally { if (requestedRevision === accountRevision.current) setBusyAction(null); }
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

  const dirty = name !== (waveform?.name ?? '') || voice !== (waveform?.voice ?? DEFAULT_VOICE)
    || initialPrompt !== (waveform?.initialPrompt ?? '') || accentColor !== (waveform?.accentColor ?? WAVEFORM_DEFAULT_COLOR)
    || profilePhoto !== (waveform?.profilePhoto ?? null) || JSON.stringify(textPanel) !== JSON.stringify(waveform?.textPanel ?? null)
    || adminTesting !== (waveform?.adminTesting === true);
  function discard() {
    photoRevision.current = null; setPreparingPhoto(false);
    setName(waveform?.name ?? ''); setVoice(waveform?.voice ?? DEFAULT_VOICE); setInitialPrompt(waveform?.initialPrompt ?? '');
    setAccentColor(waveform?.accentColor ?? WAVEFORM_DEFAULT_COLOR); setPreviewColor(waveform?.accentColor ?? WAVEFORM_DEFAULT_COLOR);
    setProfilePhoto(waveform?.profilePhoto ?? null); setTextPanel(waveform?.textPanel ?? null); setAdminTesting(waveform?.adminTesting === true);
    setError(''); setMessage('Unsaved changes discarded. Your saved waveform is unchanged.');
  }
  const sections = [
    { id: 'appearance', label: 'Appearance & voice', icon: SlidersHorizontal },
    { id: 'instructions', label: 'Instructions', icon: MessageSquareText },
    { id: 'plugins', label: 'Plugins', icon: Puzzle },
    { id: 'sharing', label: 'Sharing & usage', icon: LockKeyhole },
    { id: 'account', label: 'Account & tools', icon: Settings2 },
  ] as const;
  const creating = emailAction === 'create-account';
  const resetting = emailAction === 'reset-password';
  if (loading) return <BrandLoader variant="screen" label="Loading your account…" />;
  return <main className={account?.user ? 'account-page settings-workspace' : account?.mode === 'firebase' ? 'account-page auth-entry' : 'account-page'} style={appearanceTheme(previewColor)}>
    {(account?.user || account?.mode !== 'firebase') && <DemoCodeGate onAccess={setDemoAllowed} purpose="beta" />}
    {account?.user ? <>
      <header className="settings-topbar"><Link className="settings-brand" href="/" aria-label="Back to FlowPath"><Image src="/brand/flowpath-icon-square.png" alt="" width={36} height={36} loading="eager" />FlowPath <span>Studio</span></Link>
        <div className="account-identity"><span>Signed in as {account.user.displayName}</span><button type="button" onClick={() => void signOut()} disabled={busy} aria-busy={busyAction === 'sign-out'}>{busyAction === 'sign-out' && <BrandLoader variant="inline" />}Sign out</button></div>
      </header>
      <div className="settings-page-heading"><span className="settings-eyebrow">Your workspace</span><h1>My waveform</h1><p className="account-intro">Make it yours. Give it a voice. Add what it can do.</p></div>
      {account.mode === 'local' && <p className="local-account-note">Local test account. No Google account or Firebase service is connected.</p>}
      {returnTo !== '/account' && <Link className="secondary-button settings-return" href={returnTo}>Continue to waveform</Link>}
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Waveform settings">{sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}><Icon aria-hidden="true" /><span>{label}</span>{id === 'plugins' && <span className="settings-nav-count" aria-hidden="true">{PLUGINS.length}</span>}</button>)}</nav>
        <div className="settings-editor">
          <form id="waveform-settings-form" noValidate onSubmit={event => void save(event)}>
            <section className="settings-panel" hidden={section !== 'appearance'} aria-labelledby="appearance-heading">
              <div className="settings-section-heading"><h2 id="appearance-heading">Appearance & voice</h2><p>How your waveform looks and sounds.</p></div>
        <label htmlFor="profile-photo">Profile photo</label>
        <div className="profile-photo-field">
          {!profilePhoto && <span className="settings-photo-placeholder" aria-hidden="true"><AudioLines /></span>}
          {/* A private, validated data URL is rendered locally, with no image proxy. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {profilePhoto && <img className="profile-photo-preview" src={profilePhoto} alt="Profile photo preview" width={64} height={64} />}
          <div className="profile-photo-controls"><input id="profile-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || preparingPhoto} aria-describedby="photo-help" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void choosePhoto(file); }} />
            {profilePhoto && <button className="photo-remove" type="button" disabled={busy || preparingPhoto} onClick={() => { photoRevision.current = null; setProfilePhoto(null); setMessage(''); }}>Remove photo</button>}</div>
        </div>
        <p id="photo-help" className="field-help">JPEG, PNG or WebP, up to 5 MB. We crop the center into a small round portrait. {preparingPhoto ? <BrandLoader variant="inline" label="Preparing your photo…" /> : 'Save to keep it with your waveform.'}</p>
        <label htmlFor="waveform-name">Waveform name</label>
        <input id="waveform-name" value={name} onChange={event => { setName(event.target.value); clientAnalytics.record({ eventName: 'creation_step', properties: { step: 'editing', outcome: 'success' } }); }} maxLength={WAVEFORM_NAME_LIMIT} required disabled={busy} autoComplete="off" placeholder="Tom’s assistant" />
        <div className="appearance-colors">
          <div><label htmlFor="waveform-color">Waveform color</label><input id="waveform-color" type="color" value={previewColor} onChange={event => changeColor(event.target.value)} disabled={busy} aria-describedby="color-help" /></div>
          <div><label htmlFor="waveform-color-hex">Color hex code</label><input id="waveform-color-hex" value={accentColor} onChange={event => changeColor(event.target.value)} pattern="#?[0-9a-fA-F]{6}" maxLength={7} required disabled={busy} autoComplete="off" spellCheck={false} title={`Enter a six-digit hex color, such as ${WAVEFORM_DEFAULT_COLOR}.`} aria-describedby="color-help" /></div>
        </div>
        <p id="color-help" className="field-help">Choose any color or enter its hex code. It colors your waveform and its page.</p>
        <label htmlFor="waveform-voice">Voice</label>
        <select id="waveform-voice" value={voice} onChange={event => { if (isVoiceName(event.target.value)) setVoice(event.target.value); }} disabled={busy} aria-describedby="voice-help">
          {VOICE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <p id="voice-help" className="field-help">{VOICE_OPTIONS.find(option => option.id === voice)?.description} Your choice applies to your next conversation.</p>

            </section>
            <section className="settings-panel" hidden={section !== 'instructions'} aria-labelledby="instructions-heading">
              <div className="settings-section-heading"><h2 id="instructions-heading">Instructions</h2><p>Describe its personality, perspective and boundaries.</p></div>
        <label htmlFor="initial-prompt">What should your voice know about itself?</label>
        <textarea id="initial-prompt" value={initialPrompt} onChange={event => setInitialPrompt(event.target.value)} aria-invalid={promptTooLong} required rows={8} disabled={busy} aria-describedby={`prompt-help prompt-count${promptTooLong ? ' prompt-limit-error' : ''}`} placeholder="You are Tom’s assistant. Speak warmly and keep your answers concise." />
        <p id="prompt-count" className="field-help" aria-live="polite">{initialPrompt.length.toLocaleString('en-US')} / {WAVEFORM_PROMPT_LIMIT.toLocaleString('en-US')} characters</p>
        {promptTooLong && <p id="prompt-limit-error" className="account-error" role="alert">Your full text is preserved. Shorten it by {(initialPrompt.length - WAVEFORM_PROMPT_LIMIT).toLocaleString('en-US')} characters before saving.</p>}
        {waveform?.initialPrompt.length === 4_000 && <p className="field-help">This saved prompt reaches the previous 4,000-character limit. If your original was longer, paste it again to restore the missing ending.</p>}
        <p id="prompt-help" className="field-help">Give it an identity and a style, up to {WAVEFORM_PROMPT_LIMIT.toLocaleString('en-US')} characters. Longer drafts stay intact so you can edit them. Conversations start fresh; these instructions don’t add tools or conversation memory.</p>

              <button type="button" className="settings-inline-link" onClick={() => setSection('plugins')}><BookOpen aria-hidden="true" />Add reference documents with Knowledge</button>
            </section>
            <section className="settings-panel" hidden={section !== 'plugins'} aria-labelledby="plugins-heading">
              <div className="settings-section-heading"><h2 id="plugins-heading">Plugins <span className="settings-badge">{PLUGINS.length} available</span></h2><p>Choose what your waveform can do.</p></div>
              <div className="settings-plugin-list">{PLUGINS.map(plugin => <article key={plugin.id} className="settings-plugin" aria-labelledby={'plugin-' + plugin.id + '-heading'}>
                <span className="settings-plugin-icon">{plugin.id === 'knowledge' ? <BookOpen aria-hidden="true" /> : <TextCursorInput aria-hidden="true" />}</span>
                <div className="settings-plugin-body"><div className="settings-plugin-heading"><h3 id={'plugin-' + plugin.id + '-heading'}>{plugin.name}</h3><span className="settings-plugin-state">{plugin.id === 'knowledge' ? 'Private library' : textPanel?.version === 2 ? 'Applied' : textPanel ? 'Legacy text saved' : 'Not applied'}</span></div>
                  {plugin.id === 'knowledge' ? <><p>Answers grounded in your documents. Show relevant passages and sources with Text Box.</p>{waveform ? <Link className="secondary-button settings-manage-knowledge" href="/account/knowledge">Manage documents <ArrowUpRight aria-hidden="true" /></Link> : <p className="field-help">Save your draft to add Knowledge.</p>}<p className="field-help">Your uploaded documents stay private to you.</p></>
                    : <><p>Dictate notes or ask your waveform to display an answer.</p><div className="settings-plugin-actions"><button type="button" className="secondary-button" disabled={busy || textPanel?.version === 2} onClick={() => { setTextPanel({ type: 'text', version: 2 }); setMessage('Text Box applied. Save your draft to use it in your next conversation.'); setError(''); }}>{textPanel?.version === 2 ? 'Plugin applied' : 'Apply plugin'}</button>{textPanel && <button type="button" className="settings-inline-link" disabled={busy} onClick={() => { setTextPanel(null); setMessage('Text Box removed. Save your draft to keep this change.'); setError(''); }}>Remove Text Box</button>}</div><details className="settings-plugin-help"><summary>How it works</summary><p className="field-help">Say “Start writing,” “Stop writing,” or ask the waveform to put an answer in the box. The panel appears only when requested. Hiding it keeps voice connected. Each conversation starts with its own text.</p>{textPanel?.version === 1 && <p className="field-help">Your existing saved text is preserved. Apply Text Box to replace it with an empty, voice-controlled panel.</p>}</details></>}
                </div>
              </article>)}</div>
            </section>
          </form>
          <section className="settings-panel" hidden={section !== 'sharing'} aria-labelledby="sharing-heading"><div className="settings-section-heading"><h2 id="sharing-heading">Sharing & usage</h2><p>Control access and manage the existing publishing options.</p></div><div className="settings-private-note"><LockKeyhole aria-hidden="true" /><div><strong>Your personal waveform is private.</strong><p className="field-help">Your settings and personal address stay private. Publishing is a separate, explicit choice when available.</p></div></div>{waveform ? <PaidSettings key={waveform.id} waveformId={waveform.id} unsavedDraft={dirty} /> : <p className="field-help">Save your draft to see its available usage controls.</p>}</section>
          <section className="settings-panel" hidden={section !== 'account'} aria-labelledby="account-heading"><div className="settings-section-heading"><h2 id="account-heading">Account & tools</h2><p>{account.user.role === 'admin' ? 'Your account and founder controls.' : 'Manage your account.'}</p></div><p>Signed in as {account.user.displayName}.</p>
        {account.hostedTesterDemo && <p className="field-help">{account.user.role === 'admin' ? 'Founder access: no personal time limit on your own waveform. The Studio introduction still has a three-minute daily limit.' : 'Your private waveform includes three minutes of voice per day during this free beta. Payments are disabled.'}</p>}
        {account.user.role === 'admin' && !account.hostedTesterDemo && <div>
          <label className="admin-testing-toggle" htmlFor="admin-testing"><input id="admin-testing" type="checkbox" role="switch" checked={adminTesting} disabled={busy} onChange={event => setAdminTesting(event.target.checked)} aria-describedby="admin-testing-help" /> Admin testing</label>
          <p id="admin-testing-help" className="field-help">{account.localUnmeteredTesting
            ? 'Local founder testing has no daily, start-count, elapsed-time or silence quota. End conversations when finished. Turn off to experience regular-user limits. Save to apply on your next conversation.'
            : 'Skip your prepaid, personal time and silence limits. Conversations end at 15 minutes. Each start uses a 15-minute block from the shared daily testing budget, even if you end early. Shared capacity limits still apply. Turn off to experience regular-user limits. Save to apply on your next conversation.'}</p>
        </div>}

            <CreationReviewQueue verifiedAdmin={account.user.role === 'admin' && account.creationSafetyEnabled === true} reviewStatus={safety.status} />
            {account.user.role !== 'admin' && <p className="field-help">Your waveform belongs to this account. Use Sign out above to change accounts.</p>}
          </section>
        </div>
        <WaveformSettingsPreview name={name} voice={VOICE_OPTIONS.find(option => option.id === voice)?.label ?? voice} photo={profilePhoto} waveformId={waveform?.id} textEnabled={!!textPanel} />
      </div>
      <footer className="settings-savebar"><div className="settings-save-status"><span className="settings-draft-state">{dirty ? 'Unsaved changes' : waveform ? 'All changes saved' : 'Create your waveform'}</span>
        <CreationSafetyStatus status={safety.status} categories={safety.categories} />
        {account.creationSafetyEnabled && !safety.canSave && <button type="button" className="secondary-button" disabled={busy || preparingPhoto || safety.status === 'pending'} onClick={safety.requestReview}>Review this version</button>}
        {account.safetyAdminFixture && <p className="local-account-note">Safety decisions in this local preview are synthetic.</p>}

        <p className="field-help">Save to preview your draft. Publish to update what visitors see.</p><p className="account-status" role="status" aria-live="polite">{message}</p>{error && <p className="account-error" role="alert">{error}</p>}
      </div><div className="settings-save-actions">{dirty && <button type="button" className="settings-inline-link" disabled={busy || preparingPhoto} onClick={discard}>Discard changes</button>}<button className="primary-button" form="waveform-settings-form" type="submit" disabled={busy || preparingPhoto || promptTooLong || !safety.canSave} aria-busy={busyAction === 'save'}>{busyAction === 'save' && <BrandLoader variant="inline" />}{busyAction === 'save' ? 'Saving…' : 'Save draft'}</button></div></footer>
    </> : account?.mode === 'firebase' ? <>
      <header className="auth-header"><Link className="auth-brand" href="/" aria-label="FlowPath Studio home"><Image src="/brand/flowpath-icon-square.png" alt="" width={32} height={32} priority /><span>FlowPath <span className="auth-brand-studio">Studio</span></span></Link><Link className="auth-home" href="/">Home</Link></header>
      <section className="auth-content" aria-label={creating ? 'Create account' : resetting ? 'Reset password' : 'Sign in'}>
        <div className="auth-eyebrow">{creating ? 'Private beta' : resetting ? 'Account recovery' : 'Your workspace'}</div>
        <h1>{creating ? <>Create your<br />waveform.</> : resetting ? 'Reset your password.' : 'Welcome back.'}</h1>
        <p className="auth-description">{creating ? 'A voice, shaped by you.' : resetting ? 'We’ll send a link to help you get back in.' : <>Your voice. Your instructions.<br />Pick up where you left off.</>}</p>
        <div className="auth-access" hidden={!creating}>
          <DemoCodeGate onAccess={setDemoAllowed} purpose="beta" />
          {!demoAllowed && <p className="field-help">One code for the demos and your account. Unlock access, then continue below.</p>}
        </div>
        {!resetting && <>
          <button className="secondary-button google-sign-in auth-google" type="button" onClick={() => void signIn()} disabled={busy} aria-busy={busyAction === 'google'}>{busyAction === 'google' ? <BrandLoader variant="inline" /> : <Image src="/brand/google-g.png" alt="" width={20} height={20} unoptimized />}Continue with Google</button>
          {creating && !showEmail ? <button className="secondary-button auth-email-choice" type="button" aria-expanded={showEmail} aria-controls="email-account-form" disabled={busy} onClick={() => { setShowEmail(true); requestAnimationFrame(() => document.getElementById('account-email')?.focus()); }}><Mail aria-hidden="true" />Continue with email</button> : <p className="auth-divider">or use email</p>}
        </>}
        <form id="email-account-form" className="email-sign-in" hidden={creating && !showEmail} onSubmit={event => void submitEmail(event)} aria-label="Email account">
          <label htmlFor="account-email">Email</label>
          <input id="account-email" type="email" value={email} onChange={event => { setEmail(event.target.value); setVerificationAvailable(false); setError(''); setMessage(''); }} required disabled={busy} autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" />
          {!resetting && <>
            <div className="auth-password-label"><label htmlFor="account-password">Password</label>{!creating && <button className="auth-text-button" type="button" disabled={busy} onClick={() => chooseEmailAction('reset-password')}>Forgot password?</button>}</div>
            <input id="account-password" type="password" value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} minLength={creating ? 6 : undefined} autoComplete={creating ? 'new-password' : 'current-password'} aria-describedby={creating ? 'password-help' : undefined} placeholder={creating ? 'At least 6 characters' : 'Your password'} />
            {creating && <p id="password-help" className="field-help">We’ll send a link to verify your email.</p>}
          </>}
          <div className="account-actions"><button className="primary-button" type="submit" disabled={busy} aria-busy={busyAction === emailAction}>{busyAction === emailAction && <BrandLoader variant="inline" />}{busyAction === emailAction ? 'Please wait…' : creating ? 'Create account' : resetting ? 'Send reset link' : 'Sign in'}</button>
            {verificationAvailable && emailAction === 'sign-in' && <button className="secondary-button" type="submit" value="resend-verification" disabled={busy} aria-busy={busyAction === 'resend-verification'}>{busyAction === 'resend-verification' && <BrandLoader variant="inline" />}Resend verification email</button>}
          </div>
        </form>
        <p className="account-status" role="status" aria-live="polite">{message}</p>{error && <p className="account-error" role="alert">{error}</p>}
        <div className="auth-footer">{creating ? <>Already have an account? <button className="auth-text-button" type="button" disabled={busy} onClick={() => chooseEmailAction('sign-in')}>Sign in</button></> : resetting ? <button className="auth-text-button" type="button" disabled={busy} onClick={() => chooseEmailAction('sign-in')}>Back to email sign-in</button> : <>New to FlowPath? <button className="auth-text-button" type="button" disabled={busy} onClick={() => chooseEmailAction('create-account')}>Create an account</button></>}</div>
        {creating && <p className="auth-private"><LockKeyhole aria-hidden="true" />Your draft stays private.</p>}
      </section>
    </> : <><Link className="account-back" href="/">← Back to FlowPath</Link><h1>My waveform</h1><p className="account-intro">Your voice, with a little direction from you.</p>
      {account?.mode === 'local' ? <section className="account-sign-in" aria-label="Local sign in"><p className="local-account-note">Local preview: use a test account. This does not create a Google or Firebase account.</p><div className="account-actions"><button className="primary-button" type="button" onClick={() => void signIn('owner-a')} disabled={busy} aria-busy={busyAction === 'owner-a'}>{busyAction === 'owner-a' && <BrandLoader variant="inline" />}Use test owner A</button><button className="secondary-button" type="button" onClick={() => void signIn('owner-b')} disabled={busy} aria-busy={busyAction === 'owner-b'}>{busyAction === 'owner-b' && <BrandLoader variant="inline" />}Use test owner B</button>{account.safetyAdminFixture && <button className="secondary-button" type="button" onClick={() => void signIn('owner-admin')} disabled={busy} aria-busy={busyAction === 'owner-admin'}>{busyAction === 'owner-admin' && <BrandLoader variant="inline" />}Use test safety admin</button>}</div></section> : <p>Account sign-in is not connected for this preview.</p>}
      <p className="account-status" role="status" aria-live="polite">{message}</p>{error && <p className="account-error" role="alert">{error}</p>}
    </>}
  </main>;
}
