import 'server-only';
import { z } from 'zod';
import { estimateUpdateInputSchema, publishedEstimateSchema, type PublishedEstimate } from '@thevoice/platform-ui/estimate';
import { capability, type CapabilityContext } from './visitor-capabilities';
import { readPublishedEstimate, updatePublishedEstimate } from './visitor-estimate';
import { estimateVisitorTax, visitorEstimateTaxInputSchema } from './visitor-estimate-tax';

const today = () => new Date().toISOString().slice(0, 10);
const empty = z.object({}).strict();

/** Reuse evidence for the same priced lines; new variants require a fresh applicability decision. */
function withRetainedTax(context: CapabilityContext, estimate: PublishedEstimate): PublishedEstimate {
  const retained = visitorEstimateTaxInputSchema.safeParse(context.session.business.estimateTax);
  if (!estimate.lines.length || !retained.success) return estimate;
  const input = { ...retained.data, lines: retained.data.lines.filter(rule => estimate.lines.some(line => line.recordId === rule.recordId && line.fieldId === rule.fieldId)) };
  // Missing/new classifications produce an incomplete estimate, never a guessed rate.
  try { return publishedEstimateSchema.parse({ ...estimate, tax: estimateVisitorTax({ session: context.session, estimate, input }) }); }
  catch { return estimate; } // Evicted evidence is not silently promoted into a current tax rule.
}

export function currentPublishedEstimate(context: CapabilityContext) {
  return withRetainedTax(context, readPublishedEstimate(context.index, context.session.business.estimate, today()));
}
function show(context: CapabilityContext, estimate: PublishedEstimate) {
  context.session.business.estimate = estimate;
  context.session.presentation = { type: 'estimate', data: estimate };
  context.session.activeQueryId ??= context.session.queries[0]?.current.queryId ?? null;
  return estimate;
}
export function estimateCapabilities() {
  return [
    // Model capability: inspect the retained planning basket without changing the display.
    capability('estimate.read', 'Read the current editable estimate: exact published item/price-field references, quantities, subtotal and retained tax assumptions. Revision 0 means no estimate yet. No search, display or order.', empty, 'estimate', async context => currentPublishedEstimate(context), 'read'),
    // Model capability: apply voice/chat quantity edits to the shared estimate view.
    capability('estimate.update', 'Create or edit and display a planning estimate from published prices. Use set to replace all lines, upsert for absolute quantities, remove for exact lines, clear to empty. Use the current estimate context for expectedRevision, or estimate.read if absent/stale. Match each requested unit to its published priceOptions field. Existing tax evidence is reused only for still-matching lines; new variants need applicability review. No order, payment or inventory.', estimateUpdateInputSchema, 'estimate', async (context, input) => {
      const estimate = updatePublishedEstimate(context.index, context.session.business.estimate, input, today());
      if (!estimate.lines.length) delete context.session.business.estimateTax;
      return show(context, withRetainedTax(context, estimate));
    }),
    // Model capability: open the current estimate without replaying a historical mutation.
    capability('estimate.show', 'Display the current read-only planning estimate. Recalculate from current published prices and applicable retained evidence. Does not search or order.', empty, 'estimate', async context => show(context, currentPublishedEstimate(context))),
    // Model capability: combine already-retrieved research with host-calculated published prices.
    capability('estimate.tax', 'Apply and display a tax estimate for the current basket. Select returned research evidenceExcerpts by resultId and excerptId to support rate/jurisdiction and item treatment, or use explicit visitor-requested hypothetical assumptions. Establish transaction location, fulfillment, classification and conditions; address alone is insufficient. Unknown treatment stays incomplete. Reuse applicable earlier research without another search. This is a planning estimate, never a verified tax quote.', z.object({ expectedRevision: z.number().int().nonnegative(), tax: visitorEstimateTaxInputSchema }).strict(), 'estimate', async (context, input) => {
      const current = currentPublishedEstimate(context);
      const estimate = updatePublishedEstimate(context.index, context.session.business.estimate, { op: 'set', expectedRevision: input.expectedRevision, lines: current.lines.map(({ recordId, fieldId, quantity }) => ({ recordId, fieldId, quantity })) }, today());
      if (!estimate.lines.length) throw new Error('Add published priced items before estimating tax.');
      const tax = estimateVisitorTax({ session: context.session, estimate, input: input.tax });
      context.session.business.estimateTax = input.tax;
      return show(context, publishedEstimateSchema.parse({ ...estimate, tax }));
    }),
  ];
}
