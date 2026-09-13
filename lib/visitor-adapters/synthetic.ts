import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { queryHash } from '../catalog-query-index';
import type { TaskDocuments } from '../task-persistence';

import { fakeLineSchema, fakeQuoteSchema, fakeBookingSchema, fakeReceiptSchema } from '@thevoice/platform-ui/business';
export { fakeQuoteSchema, fakeSlotSchema, fakeBookingSchema, fakeReceiptSchema } from '@thevoice/platform-ui/business';
const stateSchema = z.object({ revision: z.number().int(), cartRevision: z.number().int(), lines: z.array(fakeLineSchema).max(24), quote: fakeQuoteSchema.nullable(), booking: fakeBookingSchema.nullable(), occupied: z.array(z.string()).max(32), receipts: z.array(fakeReceiptSchema).max(100) }).strict();
export type SyntheticState = z.infer<typeof stateSchema>;
export class SyntheticVisitorAdapter {
  constructor(private readonly documents: TaskDocuments, private readonly key: string, private readonly prices: Map<string, number>, private readonly now = Date.now, private readonly resourceKey = key) {}
  async state(): Promise<SyntheticState> {
    const value = await this.documents.read(this.key); if (value) return stateSchema.parse(value);
    const initial: SyntheticState = { revision: 0, cartRevision: 0, lines: [], quote: null, booking: null, occupied: [], receipts: [] };
    try { await this.documents.create(this.key, initial); } catch { return stateSchema.parse(await this.documents.read(this.key)); } return initial;
  }
  private async save(state: SyntheticState) { const next = stateSchema.parse({ ...state, revision: state.revision + 1 }); await this.documents.compareAndSwap(this.key, state.revision, next); return next; }
  async cart(recordId: string, quantity: number) {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99 || !this.prices.has(recordId)) throw new Error('Unsupported synthetic item or quantity.');
    const state = await this.state(); state.lines = state.lines.filter(line => line.recordId !== recordId);
    if (quantity) state.lines.push({ recordId, quantity, unitMinor: this.prices.get(recordId)! });
    state.cartRevision++; state.quote = null; return this.save(state);
  }
  async quote(destination: 'fixture-pickup' | 'fixture-delivery') {
    const state = await this.state(); if (!state.lines.length) throw new Error('The synthetic cart is empty.');
    const subtotalMinor = state.lines.reduce((total, line) => total + line.quantity * line.unitMinor, 0);
    // Fixed synthetic fixture rate, never inferred jurisdictional tax advice.
    const taxMinor = Math.round(subtotalMinor * 825 / 10_000), deliveryMinor = destination === 'fixture-delivery' ? 500 : 0;
    state.quote = fakeQuoteSchema.parse({ id: randomUUID(), cartRevision: state.cartRevision, currency: 'USD', destination, subtotalMinor, taxMinor, deliveryMinor,
      totalMinor: subtotalMinor + taxMinor + deliveryMinor, expiresAt: this.now() + 60_000, estimate: true, demoOnly: true, payloadHash: queryHash({ lines: state.lines, destination, cartRevision: state.cartRevision }) });
    return (await this.save(state)).quote!;
  }
  private calendar() { return this.resourceKey === this.key ? this : new SyntheticVisitorAdapter(this.documents, this.resourceKey, this.prices, this.now); }
  async availability() {
    const state = await this.calendar().state();
    return [0, 1, 2].map(i => ({ id: `fixture-slot-${i}`, startsAt: `2030-10-${15 + i}T22:00:00.000Z`, timeZone: 'America/New_York', resourceRevision: state.revision })).filter(slot => !state.occupied.includes(slot.id));
  }
  async prepareBooking(slotId: string) {
    const state = await this.state(), slot = (await this.availability()).find(slot => slot.id === slotId);
    if (!slot) throw new Error('Synthetic slot no longer available.');
    state.booking = { id: randomUUID(), slot, expiresAt: this.now() + 60_000, payloadHash: queryHash(slot), demoOnly: true };
    return (await this.save(state)).booking!;
  }
  async confirm(kind: 'order' | 'booking', confirmationId: string, payloadHash: string, operationId: string, timeout: 'none' | 'before' | 'after' = 'none') {
    const state = await this.state();
    const calendar = kind === 'booking' ? await this.calendar().state() : state;
    const replay = [...state.receipts, ...calendar.receipts].find(receipt => receipt.operationId === operationId || receipt.confirmationId === confirmationId);
    if (replay) { if (replay.confirmationId !== confirmationId || replay.kind !== kind || replay.payloadHash !== payloadHash) throw new Error('Conflicting confirmation reuse.'); return replay; }
    const draft = kind === 'order' ? state.quote : state.booking;
    if (!draft || draft.id !== confirmationId || draft.payloadHash !== payloadHash || draft.expiresAt <= this.now()) throw new Error('Confirmation changed or expired. Review a fresh draft.');
    if (kind === 'order' && state.quote!.cartRevision !== state.cartRevision) throw new Error('Cart changed. Review a new quote.');
    if (kind === 'booking' && calendar.occupied.includes(state.booking!.slot.id)) throw new Error('Synthetic slot was taken.');
    if (timeout === 'before') throw new Error('Simulated unknown outcome. Inspect status before another attempt.');
    const receipt = fakeReceiptSchema.parse({ id: randomUUID(), operationId, confirmationId, payloadHash, kind, status: 'confirmed', demoOnly: true,
      ...(kind === 'order' ? { totalMinor: state.quote!.totalMinor } : { slotId: state.booking!.slot.id }) });
    state.receipts.push(receipt);
    if (kind === 'booking') {
      if (this.resourceKey === this.key) state.occupied.push(state.booking!.slot.id);
      else { calendar.receipts.push(receipt); calendar.occupied.push(state.booking!.slot.id); await this.calendar().save(calendar); }
    }
    await this.save(state);
    if (timeout === 'after') throw new Error('Simulated timeout after commit. Reconcile without another mutation.');
    return receipt;
  }
  async status(operationId: string) {
    for (const key of new Set([this.key, this.resourceKey])) { const raw = await this.documents.read(key); if (!raw) continue; const receipt = stateSchema.parse(raw).receipts.find(receipt => receipt.operationId === operationId); if (receipt) return receipt; }
    return null;
  }
}
