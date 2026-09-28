import { z } from 'zod';
import { publicationRefSchema, queryTimeSchema, taskIdSchema } from './query.js';
import { scopedEstimateTaxSchema } from './estimate-tax.js';

const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amount = z.string().regex(/^\d+(?:\.\d{1,4})?$/);
export const publishedEstimateNote = 'Listed-price arithmetic only. Taxes, fees, availability and unlisted adjustments are not included or verified; retain source price qualifications.';
export const publishedEstimateRounding = 'Round each quantity-times-price line half up to the currency minor unit, then sum the rounded lines.';
export const estimateLineKeySchema = z.object({ recordId: taskIdSchema, fieldId: taskIdSchema }).strict();
export const estimateLineReferenceSchema = estimateLineKeySchema.extend({ quantity: z.number().int().min(1).max(1000) });
export type EstimateLineReference = z.infer<typeof estimateLineReferenceSchema>;
export const publishedEstimateLineSchema = estimateLineReferenceSchema.extend({
  name: z.string().max(180), unitPrice: z.number().finite().nonnegative(), unit: z.string().max(80).nullable(), per: z.string().max(80).nullable(), lineTotal: amount,
  sourceSummary: z.string().max(1600), sourceTerms: z.array(z.string().max(1000)).max(4), assertionIds: z.array(taskIdSchema).max(256),
});
function uniqueLines(lines: { recordId: string; fieldId: string }[]) {
  return new Set(lines.map(line => JSON.stringify([line.recordId, line.fieldId]))).size === lines.length;
}
const references = z.array(estimateLineReferenceSchema).max(12).refine(uniqueLines, 'Each published record and price field may appear once.');
export const estimateUpdateInputSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), expectedRevision: revision, lines: references }).strict(),
  z.object({ op: z.literal('upsert'), expectedRevision: revision, lines: references.min(1) }).strict(),
  z.object({ op: z.literal('remove'), expectedRevision: revision, lines: z.array(estimateLineKeySchema).min(1).max(12).refine(uniqueLines, 'Each estimate line may be removed once.') }).strict(),
  z.object({ op: z.literal('clear'), expectedRevision: revision }).strict(),
]);
export type EstimateUpdateInput = z.infer<typeof estimateUpdateInputSchema>;
export const publishedEstimateSchema = z.object({
  revision, publication: publicationRefSchema, asOf: queryTimeSchema,
  basis: z.literal('listed-prices-only'), rounding: z.literal(publishedEstimateRounding),
  lines: z.array(publishedEstimateLineSchema).max(12).refine(uniqueLines, 'Each published record and price field may appear once.'),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(), fractionDigits: z.number().int().min(0).max(4).nullable(),
  subtotalMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), subtotal: amount, formattedSubtotal: z.string().max(100),
  note: z.literal(publishedEstimateNote), tax: scopedEstimateTaxSchema.optional(),
}).strict().superRefine((estimate, ctx) => {
  if (!estimate.lines.length) {
    if (estimate.currency !== null || estimate.fractionDigits !== null || estimate.subtotalMinor !== 0 || estimate.subtotal !== '0' || estimate.formattedSubtotal !== '0'
      || estimate.tax && (estimate.tax.status !== 'incomplete' || estimate.tax.estimatedTaxMinor !== null || estimate.tax.estimatedTotalMinor !== null)) ctx.addIssue({ code: 'custom', message: 'An empty estimate has no currency or priced total.' });
  } else if (!estimate.currency || estimate.fractionDigits === null) ctx.addIssue({ code: 'custom', message: 'A priced estimate requires its published currency and precision.' });
  if (estimate.tax && (estimate.tax.currency !== estimate.currency || estimate.tax.fractionDigits !== estimate.fractionDigits)) ctx.addIssue({ code: 'custom', message: 'Tax estimates must use the basket currency and precision.' });
});
export type PublishedEstimate = z.infer<typeof publishedEstimateSchema>;
