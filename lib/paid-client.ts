'use client';
import type { MinutePack } from './paid-model';
export type BillingView = { enabled: boolean; signedIn?: boolean; fixtures?: boolean; voiceReady?: boolean; checkoutReady?: boolean;
  purchaseStatus?: 'pending' | 'paid' | 'failed' | null;
  identityPending?: boolean; capacityMessage?: string; pack: MinutePack; wallet?: { balance: number; available: number; held: number; allocated: number } | null };
export class PaidRequestError extends Error {
  constructor(message: string, readonly adminLimit = false) { super(message); }
}
export async function paidRead<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const value = await response.json();
  if (!response.ok) throw new PaidRequestError(value.error ?? 'This request could not be completed.', value.adminLimit === true);
  return value;
}
export async function loadBilling(signal?: AbortSignal) {
  const load = () => paidRead<BillingView>('/api/billing', { signal });
  // Settle the server-issued persistent cookie across tabs before any allowance request.
  const run = async () => { const view = await load(); return view.identityPending ? load() : view; };
  return typeof navigator !== 'undefined' && navigator.locks?.request ? navigator.locks.request('flowpath-paid-identity', { signal }, run) : run();
}
export async function startCheckout(destination: string, requestId: string) {
  const value = await paidRead<{ url: string; test: boolean }>('/api/billing/checkout', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destination, requestId }) });
  const target = new URL(value.url, location.origin);
  if (target.origin !== location.origin && target.origin !== 'https://checkout.stripe.com') throw new Error('Unexpected checkout destination.');
  location.assign(target.href);
}
