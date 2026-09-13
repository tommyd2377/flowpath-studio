import { z } from 'zod';
export const fakeLineSchema = z.object({ recordId: z.string().max(100), quantity: z.number().int().min(1).max(99), unitMinor: z.number().int().min(0).max(100_000_000) }).strict();
export const fakeQuoteSchema = z.object({ id: z.string().uuid(), cartRevision: z.number().int(), currency: z.literal('USD'), destination: z.enum(['fixture-pickup', 'fixture-delivery']),
  subtotalMinor: z.number().int(), taxMinor: z.number().int(), deliveryMinor: z.number().int(), totalMinor: z.number().int(), expiresAt: z.number(), estimate: z.literal(true), demoOnly: z.literal(true), payloadHash: z.string().length(64) }).strict();
export const fakeSlotSchema = z.object({ id: z.string(), startsAt: z.string().datetime(), timeZone: z.string(), resourceRevision: z.number().int() }).strict();
export const fakeBookingSchema = z.object({ id: z.string().uuid(), slot: fakeSlotSchema, expiresAt: z.number(), payloadHash: z.string().length(64), demoOnly: z.literal(true) }).strict();
export const fakeReceiptSchema = z.object({ id: z.string().uuid(), confirmationId: z.string().uuid(), operationId: z.string().uuid(), kind: z.enum(['order', 'booking']), status: z.literal('confirmed'), demoOnly: z.literal(true), payloadHash: z.string().length(64), totalMinor: z.number().int().optional(), slotId: z.string().optional() }).strict();
