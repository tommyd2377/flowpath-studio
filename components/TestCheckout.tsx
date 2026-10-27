'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { paidRead } from '@/lib/paid-client';
import { packLabel, type MinutePack } from '@/lib/paid-model';
import BrandLoader from './BrandLoader';
export default function TestCheckout({ id }: { id: string }) {
  const [order, setOrder] = useState<{ pack: MinutePack; destination: string; status: string } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);
  useEffect(() => { let current = true;
    void paidRead<{ pack: MinutePack; destination: string; status: string }>(`/api/billing/fixture?id=${id}`).then(p => { if (current) { setOrder(p); setPaid(p.status === 'paid'); } }).catch(e => { if (current) setMessage(e.message); });
    return () => { current = false; };
  }, [id]);
  if (!order && !message) return <BrandLoader variant="screen" label="Loading test checkout…" />;
  return <main className="account-page"><h1>Synthetic test checkout</h1><p>No money moves. No card or Stripe account is used.</p>
    {order && <><p>{packLabel(order.pack)}</p>{paid ? <><p role="status">Test credit confirmed. Continue when you’re ready; no conversation has started.</p>
      <Link className="primary-button" href={`${order.destination}?checkout=returned`}>Continue to waveform</Link></>
      : <div className="account-actions"><button className="primary-button" type="button" disabled={busy} aria-busy={busy} onClick={() => {
        if (busy) return; setBusy(true);
        void paidRead('/api/billing/fixture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
          .then(() => setPaid(true)).catch(e => setMessage(e.message)).finally(() => setBusy(false));
      }}>{busy && <BrandLoader variant="inline" />}Confirm synthetic test payment</button><Link className="secondary-button" href={`${order.destination}?checkout=canceled`}>Cancel checkout</Link></div>}</>}
    {message && <p role="alert">{message}</p>}</main>;
}
