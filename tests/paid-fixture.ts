import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { VoiceDatabase, VoiceTransaction } from '../lib/production-voice-store';
import { createPaidStore, type PaidActor } from '../lib/paid-store';
import { DEFAULT_PACK } from '../lib/paid-model';
import type { Waveform } from '../lib/account-model';

export class PaidMemoryDatabase implements VoiceDatabase {
  rows = new Map<string, Record<string, unknown>>();
  private pending = Promise.resolve();
  async transaction<T>(work: (tx: VoiceTransaction) => Promise<T>) {
    const prior = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>(resolve => { release = resolve; });
    await prior;
    const next = structuredClone(this.rows);
    let wrote = false;
    try {
      const value = await work({ get: async path => {
        assert.equal(wrote, false, 'Firestore transactions must read before writing');
        return structuredClone(next.get(path) ?? null);
      }, set: (path, value) => { wrote = true; next.set(path, structuredClone(value) as Record<string, unknown>); } });
      this.rows = next;
      return value;
    } finally { release(); }
  }
}
export function paidFixture() {
  const db = new PaidMemoryDatabase();
  let time = Date.UTC(2026, 9, 25, 12);
  const now = () => time;
  const store = createPaidStore(db, now);
  const owner: PaidActor = { uid: 'creator', visitorId: 'owner-browser' };
  const guest: PaidActor = { visitorId: 'guest-browser' };
  const wave: Waveform = { id: randomUUID(), name: 'Public voice', initialPrompt: 'Private instructions must never be in public responses.',
    voice: 'marin', accentColor: '#3a66ff', profilePhoto: null, updatedAt: new Date(time).toISOString() };
  const pack = { ...DEFAULT_PACK, priceId: 'price_fixture' };
  const credit = async (actor: PaidActor = owner) => {
    const id = randomUUID();
    const p = await store.beginPurchase(actor, id, `/p/${wave.id}`, pack);
    const payment = { uid: actor.uid!, checkoutId: `cs_test_${id}`, paymentIntent: `pi_${id}`,
      packId: pack.id, priceId: pack.priceId, seconds: pack.seconds, amount: pack.amount, currency: pack.currency };
    await store.fulfill(`evt_${id}`, p.id, payment);
    return { id: p.id, payment };
  };
  const publish = (mode: 'creator' | 'intro' | 'visitor' = 'creator', budgetSeconds = 900, allowanceSeconds = 300, published = true) => store.publish(owner, wave, { mode, budgetSeconds, allowanceSeconds }, published);
  const policy = { concurrency: 3, dailySeconds: 90_000 };
  const reserve = (actor = guest, choice: 'creator' | 'self' = 'creator', id = randomUUID()) => store.reserve(actor, wave.id, id, choice, policy);
  const connect = async (id: string) => { await store.updateSegment(id, 'created', `provider_${id}`); await store.updateSegment(id, 'connected'); };
  return { db, store, owner, guest, wave, pack, credit, publish, policy, reserve, connect, now, advance: (ms: number) => { time += ms; } };
}
