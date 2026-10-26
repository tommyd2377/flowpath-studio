'use client';
import { useEffect, useRef } from 'react';

export default function AdminLimitDialog({ message, onAdmin, onRegular, detail = 'You can continue as admin within the original 15-minute conversation window. Staying a regular user keeps the normal limit in place.' }: {
  message: string; detail?: string; onAdmin: () => void; onRegular: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="admin-limit-dialog" aria-labelledby="admin-limit-title" aria-describedby="admin-limit-description"
    onCancel={event => { event.preventDefault(); onRegular(); }}>
    <h2 id="admin-limit-title">Normal user limit reached</h2>
    <p id="admin-limit-description">{message} This is the normal limit for regular users.</p>
    <p>{detail}</p>
    <div className="admin-limit-actions">
      <button type="button" className="secondary-button" autoFocus onClick={onRegular}>Continue as regular user</button>
      <button type="button" className="primary-button" onClick={onAdmin}>Continue as admin</button>
    </div>
  </dialog>;
}
