'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Plus } from 'lucide-react';
import { summarize, type Site, type SiteSummary } from '@/lib/site-model';
import type { WorkspaceUser } from '@/lib/firebase/types';
import type { EditorStatus } from '@/lib/editor-types';
import Dashboard from './Dashboard';
import { CreateSiteDialog } from './EditorPanels';
import PersonalFooter from './PersonalFooter';
import SignOutButton from './SignOutButton';
import ThemeToggle from './ThemeToggle';

export default function Workspace({ initialSites, initialSite, user, editor, initialPanel }: { initialSites: SiteSummary[]; initialSite: Site | null; user: WorkspaceUser; editor: EditorStatus; initialPanel?: 'billing' }) {
  const [site, setSite] = useState(initialSite);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  async function createSite(name: string, slug: string, kind: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/sites', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, slug, kind }) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Your site could not be created. Try again.');
      setSite(result.site as Site); setCreating(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Your site could not be created. Try again.');
    } finally {
      inFlight.current = false; setBusy(false);
    }
  }

  if (site) return <Dashboard initialSite={site} initialSites={initialSites.some(item => item.id === site.id) ? initialSites : [...initialSites, summarize(site)]} user={user} editor={editor} initialPanel={initialPanel}/>;

  return <main className="auth-page">
    <header className="auth-topbar"><span className="auth-brand"><Image className="auth-brand-full" src="/brand/flowpath-logo-full.png" alt="FlowPath Studio" width={168} height={112} priority/><Image className="auth-brand-square" src="/brand/flowpath-icon-square.png" alt="" width={38} height={38} priority/><span className="auth-brand-name">FlowPath Studio</span></span><div className="inline-actions"><ThemeToggle/>{user.mode === 'firebase' && <SignOutButton disabled={busy || creating} onBusyChange={value => { inFlight.current = value; setBusy(value); }}/>}</div></header>
    <section className="auth-card onboarding-card" aria-labelledby="onboarding-title">
      <span className="eyebrow">Your workspace is ready</span><h1 id="onboarding-title">Let’s create your first site.</h1><p>Start with a sample, add your branding, and shape the content in your editor. You can review every change before publishing.</p>
      <div className="workspace-owner"><span>{(user.displayName || user.email || 'W').slice(0, 1).toUpperCase()}</span><div><strong>{user.displayName || user.email || 'Your workspace'}</strong><small>{user.mode === 'firebase' ? 'Signed in · saved with Firebase' : 'Local demo workspace'}</small></div></div>
      <div className="onboarding-actions"><button className="button primary" disabled={busy} onClick={() => { setError(''); setCreating(true); }}><Plus size={17}/>Create your first site</button>{user.mode === 'demo' && <Link href="/sign-in" prefetch={false} className="text-button">Connect Firebase</Link>}</div>
      <p className="auth-note">{editor.message} Visitor chat and voice can be enabled in The Voice. Review the launch offer in Usage & billing after creating your site. Live payments and custom domains require separate setup.</p>
    </section>
    <div className="auth-footer"><PersonalFooter/></div>
    {creating && <CreateSiteDialog mode={user.mode} busy={busy} error={error} onClose={() => { setCreating(false); setError(''); }} onCreate={(name, slug, kind) => void createSite(name, slug, kind)}/>}
  </main>;
}
