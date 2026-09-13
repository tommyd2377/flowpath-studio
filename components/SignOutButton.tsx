'use client';
import LoadingIndicator from './LoadingIndicator';

import { useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { signOutOfWorkspace } from '@/lib/firebase/client';

export default function SignOutButton({ disabled = false, onBusyChange }: { disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  async function leaveWorkspace() {
    if (disabled || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); onBusyChange?.(true);
    try {
      await signOutOfWorkspace();
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Reload the page to discard all workspace state after removing the session cookie.
      window.location.assign('/sign-in');
    } catch {
      setError('We couldn’t sign you out. Please try again.');
      inFlight.current = false; setBusy(false); onBusyChange?.(false);
    }
  }

  return <div className="sign-out-control">
    <button type="button" className="icon-button" disabled={disabled || busy} aria-label={busy ? 'Signing out' : 'Sign out'} title={disabled ? 'Save or clear pending edits before signing out' : 'Sign out'} onClick={() => void leaveWorkspace()}><>{busy ? <LoadingIndicator label="Signing out…"/> : <LogOut size={17}/>}</></button>
    {error && <p className="auth-error" role="alert">{error}</p>}
  </div>;
}
