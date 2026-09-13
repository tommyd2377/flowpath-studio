'use client';
import LoadingIndicator from './LoadingIndicator';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight, CircleHelp, Mail } from 'lucide-react';
import { authErrorMessage, loadAuthConfiguration, signInToWorkspace, type AuthConfiguration } from '@/lib/firebase/client';
import PersonalFooter from './PersonalFooter';
import ThemeToggle from './ThemeToggle';

export default function SignIn() {
  const [configuration, setConfiguration] = useState<AuthConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [configurationError, setConfigurationError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [createAccount, setCreateAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    loadAuthConfiguration(controller.signal).then(result => {
      if (!controller.signal.aborted) { setConfiguration(result); setLoading(false); }
    }).catch(error => {
      if (!controller.signal.aborted) { setConfigurationError(authErrorMessage(error)); setLoading(false); }
    });
    return () => controller.abort();
  }, [attempt]);

  async function signIn(method: 'google' | 'password') {
    if (inFlight.current || !configuration?.enabled || !configuration.config) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      await signInToWorkspace(configuration.config, method === 'google' ? { method } : { method, email: email.trim(), password, createAccount });
      setPassword('');
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Reload server state after creating the session cookie and clearing browser auth.
      window.location.assign('/');
    } catch (error) {
      setError(authErrorMessage(error)); setPassword(''); setBusy(false); inFlight.current = false;
    }
  }

  return <main className="auth-page">
    <header className="auth-topbar"><Link href="/" prefetch={false} className="auth-brand"><Image className="auth-brand-full" src="/brand/flowpath-logo-full.png" alt="FlowPath Studio" width={168} height={112} priority/><Image className="auth-brand-square" src="/brand/flowpath-icon-square.png" alt="" width={38} height={38} priority/><span className="auth-brand-name">FlowPath Studio</span></Link><ThemeToggle/></header>
    <section className="auth-card" aria-labelledby="sign-in-title">
      <div className="auth-intro"><span className="eyebrow">Your website workspace</span><h1 id="sign-in-title">{createAccount ? 'Make room for your ideas.' : 'Welcome to your studio.'}</h1><p>Bring your content, branding, and website together.</p></div>
      {loading ? <LoadingIndicator label="Checking sign-in availability…"/> : configuration?.enabled && configuration.config ? <>
        <button type="button" className="button secondary" disabled={busy} onClick={() => void signIn('google')}>Continue with Google<ArrowUpRight size={16}/></button>
        <div className="auth-divider"><span>or use your email</span></div>
        <form className="auth-form" onSubmit={event => { event.preventDefault(); void signIn('password'); }}>
          <label className="field">Email<input type="email" name="email" autoComplete="username" required maxLength={254} disabled={busy} value={email} onChange={event => setEmail(event.target.value)}/></label>
          <label className="field">Password<input type="password" name="password" autoComplete={createAccount ? 'new-password' : 'current-password'} required minLength={createAccount ? 6 : 1} disabled={busy} value={password} onChange={event => setPassword(event.target.value)}/>{createAccount && <span className="field-help">Use at least six characters.</span>}</label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="button primary" disabled={busy}><Mail size={16}/>{busy ? <LoadingIndicator label="Please wait…"/> : createAccount ? 'Create account' : 'Sign in'}</button>
        </form>
        <p className="auth-mode-switch">{createAccount ? 'Already have an account?' : 'New to FlowPath Studio?'} <button type="button" className="text-button" disabled={busy} onClick={() => { setCreateAccount(!createAccount); setPassword(''); setError(''); }}>{createAccount ? 'Sign in' : 'Create an account'}</button></p>
        <p className="auth-note">Creating an account does not start a paid subscription.</p>
      </> : <div className="auth-status">
        <div className="info-note"><CircleHelp size={20}/><div><h2>Sign-in needs configuration</h2><p>{configurationError || (configuration?.mode === 'demo' ? 'Firebase sign-in is not connected on this server yet. The local demo remains available while it is being set up.' : 'Firebase sign-in must be configured on this server before you can open your workspace.')}</p></div></div>
        {configuration?.mode === 'demo' && <Link href="/" prefetch={false} className="button primary">Open the local demo<ArrowUpRight size={16}/></Link>}
        <button type="button" className="button secondary" onClick={() => { setLoading(true); setConfigurationError(''); setAttempt(current => current + 1); }}>Check again</button>
      </div>}
    </section>
    <div className="auth-footer"><PersonalFooter/></div>
  </main>;
}
