import { z } from 'zod';
import { taskIdSchema } from '@thevoice/platform-ui/query';
import { websiteValueRole } from '@thevoice/platform-ui/site-design';
import { projectField } from './catalog-query';
import type { CompiledQueryIndex } from './catalog-query-index';

export const priceTotalInputSchema = z.object({ lines: z.array(z.object({ recordId: taskIdSchema, fieldId: taskIdSchema, quantity: z.number().int().min(1).max(1000) }).strict()).min(1).max(12) }).strict();
const amount = z.string().regex(/^\d+(?:\.\d{1,4})?$/);
export const priceTotalOutputSchema = z.object({
  basis: z.literal('listed-prices-only'), currency: z.string().regex(/^[A-Z]{3}$/), fractionDigits: z.number().int().min(0).max(4),
  rounding: z.literal('Round each quantity-times-price line half up to the currency minor unit, then sum the rounded lines.'),
  lines: z.array(z.object({ recordId: taskIdSchema, fieldId: taskIdSchema, name: z.string().max(180), quantity: z.number().int().min(1).max(1000),
    unitPrice: z.number().finite().nonnegative(), unit: z.string().max(80).nullable(), per: z.string().max(80).nullable(), lineTotal: amount,
    sourceSummary: z.string().max(1600), sourceTerms: z.array(z.string().max(1000)).max(4), assertionIds: z.array(taskIdSchema).max(256),
  }).strict()).min(1).max(12),
  subtotalMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), subtotal: amount, formattedSubtotal: z.string().max(100),
  note: z.literal('Listed-price arithmetic only. Taxes, fees, availability and unlisted adjustments are not included or verified; retain source price qualifications.'),
}).strict();

/** Correctable published-price input; no provider or side effect has run. */
export class PublishedPriceInputError extends Error {}

function decimal(minor: bigint, digits: number) {
  const value = minor.toString().padStart(digits + 1, '0');
  return digits ? `${value.slice(0, -digits)}.${value.slice(-digits)}` : value;
}

/** Published references supply every price; no expression evaluation or external action. */
export function totalPublishedPrices(index: CompiledQueryIndex, input: z.infer<typeof priceTotalInputSchema>, asOf: string) {
  const request = priceTotalInputSchema.parse(input);
  if (new Set(request.lines.map(line => `${line.recordId}:${line.fieldId}`)).size !== request.lines.length) throw new PublishedPriceInputError('Combine quantities for each published record and price field into one line.');
  let currency: string | undefined, fractionDigits = 2, subtotalMinor = 0n;
  const lines = request.lines.map(line => {
    const record = index.records.get(line.recordId), field = index.space.fields.find(field => field.id === line.fieldId);
    const projected = projectField(index, line.recordId, line.fieldId, asOf);
    const price = projected.value;
    if (!record || field?.type !== 'money' || projected.state !== 'known' || price?.type !== 'money' || typeof price.value !== 'number' || !price.currency) throw new PublishedPriceInputError('Each calculation line needs a known, current, unconditional published money field. Clarify unknown or conflicting prices.');
    if (!Intl.supportedValuesOf('currency').includes(price.currency)) throw new PublishedPriceInputError('This published currency is not supported for minor-unit rounding.');
    if (currency && currency !== price.currency) throw new PublishedPriceInputError('A subtotal cannot mix currencies. No currency conversion is inferred.');
    currency = price.currency;
    fractionDigits = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits!;
    if (fractionDigits > 4 || price.value < 0 || price.value > 1_000_000_000 || Number(price.value.toFixed(6)) !== price.value) throw new PublishedPriceInputError('This published price exceeds the supported amount or six-decimal precision bound.');
    const millionths = BigInt(price.value.toFixed(6).replace('.', ''));
    const lineMinor = (millionths * BigInt(line.quantity) * 10n ** BigInt(fractionDigits) + 500_000n) / 1_000_000n;
    subtotalMinor += lineMinor;
    if (subtotalMinor > BigInt(Number.MAX_SAFE_INTEGER)) throw new PublishedPriceInputError('The calculation exceeds the supported total bound.');
    const sourceTerms = index.space.fields.filter(field => websiteValueRole(field) === 'price-terms').flatMap(field => {
      const projected = projectField(index, line.recordId, field.id, asOf);
      return projected.state === 'known' && typeof projected.value?.value === 'string' ? [projected.value.value] : [];
    });
    if (sourceTerms.length > 4 || sourceTerms.some(terms => terms.length > 1000)) throw new PublishedPriceInputError('Review the complete price qualifications before calculating this offering.');
    return { ...line, name: record.name, unitPrice: price.value, unit: price.unit ?? null, per: price.basis ?? null,
      lineTotal: decimal(lineMinor, fractionDigits), sourceSummary: record.summary, sourceTerms, assertionIds: projected.assertionIds };
  });
  const subtotal = decimal(subtotalMinor, fractionDigits);
  return priceTotalOutputSchema.parse({ basis: 'listed-prices-only', currency, fractionDigits,
    rounding: 'Round each quantity-times-price line half up to the currency minor unit, then sum the rounded lines.',
    lines, subtotalMinor: Number(subtotalMinor), subtotal, formattedSubtotal: `${currency} ${subtotal}`,
    note: 'Listed-price arithmetic only. Taxes, fees, availability and unlisted adjustments are not included or verified; retain source price qualifications.' });
}
