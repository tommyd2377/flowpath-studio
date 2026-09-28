import 'server-only';
import { estimateUpdateInputSchema, publishedEstimateNote, publishedEstimateRounding, publishedEstimateSchema, type EstimateLineReference, type PublishedEstimate } from '@thevoice/platform-ui/estimate';
import { queryTimeSchema } from '@thevoice/platform-ui/query';
import { queryHash, type CompiledQueryIndex } from './catalog-query-index';
import { totalPublishedPrices } from './visitor-price-calculation';

function storedEstimate(index: CompiledQueryIndex, stored: unknown) {
  if (stored === undefined) return undefined;
  const estimate = publishedEstimateSchema.parse(stored);
  if (queryHash(estimate.publication) !== queryHash(index.space.publication)) throw new Error('Estimate publication changed. Start a new visitor session.');
  return estimate;
}
function references(estimate: PublishedEstimate | undefined): EstimateLineReference[] {
  return estimate?.lines.map(({ recordId, fieldId, quantity }) => ({ recordId, fieldId, quantity })) ?? [];
}
function calculate(index: CompiledQueryIndex, lines: EstimateLineReference[], revision: number, asOf: string): PublishedEstimate {
  const date = queryTimeSchema.parse(asOf);
  const total = lines.length ? totalPublishedPrices(index, { lines }, date) : {
    basis: 'listed-prices-only', rounding: publishedEstimateRounding, lines: [], currency: null, fractionDigits: null,
    subtotalMinor: 0, subtotal: '0', formattedSubtotal: '0', note: publishedEstimateNote,
  };
  return publishedEstimateSchema.parse({ revision, publication: index.space.publication, asOf: date, ...total });
}

/** Revalue stored references from the current publication; cached names, prices and tax are never reused. */
export function readPublishedEstimate(index: CompiledQueryIndex, stored: unknown, asOf: string): PublishedEstimate {
  const estimate = storedEstimate(index, stored);
  return calculate(index, references(estimate), estimate?.revision ?? 0, asOf);
}

/** The caller persists the returned estimate under its existing session revision check. */
export function updatePublishedEstimate(index: CompiledQueryIndex, stored: unknown, input: unknown, asOf: string): PublishedEstimate {
  const request = estimateUpdateInputSchema.parse(input), estimate = storedEstimate(index, stored);
  const revision = estimate?.revision ?? 0;
  if (request.expectedRevision !== revision) throw new Error('Estimate changed. Reload the estimate before editing it.');
  let lines = references(estimate);
  if (request.op === 'clear') lines = [];
  else if (request.op === 'set') lines = request.lines;
  else if (request.op === 'upsert') for (const line of request.lines) {
    const position = lines.findIndex(existing => existing.recordId === line.recordId && existing.fieldId === line.fieldId);
    if (position < 0) lines.push(line); else lines[position] = line;
  }
  else for (const line of request.lines) {
    const position = lines.findIndex(existing => existing.recordId === line.recordId && existing.fieldId === line.fieldId);
    if (position < 0) throw new Error('Estimate line was not found. Reload the estimate before removing it.');
    lines.splice(position, 1);
  }
  return calculate(index, lines, revision + 1, asOf);
}
