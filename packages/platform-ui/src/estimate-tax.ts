import { z } from 'zod';
import { taskIdSchema } from './query.js';

const text = z.string().trim().min(1).max(1000);
const amount = z.string().regex(/^\d+(?:\.\d{1,4})?$/);
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const estimateTaxRateSchema = z.string().regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,6})?$/).refine(value => Number(value) <= 100, 'Use a percentage from 0 through 100.');
const evidenceReference = z.object({ resultId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), url: z.string().url().max(2048), excerpt: z.string().min(1).max(2400) }).strict();
const evidenceSelection = z.object({ resultId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), excerptId: z.string().regex(/^excerpt_[a-f0-9]{32}$/) }).strict();
const taxLine = z.object({ recordId: taskIdSchema, fieldId: taskIdSchema,
  taxability: z.enum(['taxable', 'exempt', 'unknown']), classification: text.nullable(), taxabilityNotes: text,
  ratePercent: estimateTaxRateSchema.nullable(), evidence: z.array(z.union([evidenceSelection, evidenceReference])).max(4),
}).strict();
export const visitorEstimateTaxInputSchema = z.object({
  mode: z.enum(['researched', 'hypothetical']), jurisdiction: text.nullable(), location: text.nullable(), fulfillment: text.nullable(),
  applicabilityNotes: z.array(text).max(8), visitorAssumption: text.nullable(), lines: z.array(taxLine).max(12),
}).strict();
export type VisitorEstimateTaxInput = z.infer<typeof visitorEstimateTaxInputSchema>;

export const scopedEstimateTaxSchema = z.object({
  mode: z.enum(['researched', 'hypothetical']), status: z.enum(['complete', 'incomplete']),
  label: z.enum(['Researched tax estimate', 'Hypothetical tax estimate']),
  calculatedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), basisHash: z.string().regex(/^[a-f0-9]{64}$/),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(), fractionDigits: z.number().int().min(0).max(4).nullable(),
  jurisdiction: text.nullable(), location: text.nullable(), fulfillment: text.nullable(),
  applicabilityNotes: z.array(text).max(8), visitorAssumption: text.nullable(),
  rounding: z.literal('Round each line tax half up to the currency minor unit, then sum the rounded taxes.'),
  lines: z.array(taxLine.extend({
    evidence: z.array(evidenceReference.extend({ title: z.string().max(300), fetchedAt: z.iso.datetime(), start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict()).max(4),
    taxMinor: minor.nullable(), tax: amount.nullable(),
  }).strict()).max(12),
  estimatedTaxMinor: minor.nullable(), estimatedTax: amount.nullable(), estimatedTotalMinor: minor.nullable(), estimatedTotal: amount.nullable(),
  missing: z.array(z.string().max(1000)).max(128), notes: z.array(z.string().max(1000)).max(8),
}).strict();
export type ScopedEstimateTax = z.infer<typeof scopedEstimateTaxSchema>;
