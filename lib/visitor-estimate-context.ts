import 'server-only';
import { publishedEstimateSchema } from '@thevoice/platform-ui/estimate';
import { visitorEstimateTaxInputSchema } from '@thevoice/platform-ui/estimate-tax';
import type { CapabilityContext } from './visitor-capabilities';
import type { VisitorTaskSession } from './visitor-task-store';
import { estimatePriceOptions } from './visitor-estimate-price-options';
import { recallVisitorConversationResearch } from './visitor-conversation-memory';
import { researchEvidenceExcerpts } from './visitor-research-excerpts';

/** Current server-owned basket facts, not a historical display or inferred tax. */
export function visitorEstimateContext(session: VisitorTaskSession, context: Pick<CapabilityContext, 'index'>) {
  const parsed = publishedEstimateSchema.safeParse(session.business.estimate);
  if (!parsed.success) return { revision: 0, lines: [] };
  const estimate = parsed.data;
  const priceOptions: { recordId: string; fieldId: string; label: string; text: string }[] = [];
  let omittedPriceOptions = 0;
  for (const recordId of new Set(estimate.lines.map(line => line.recordId))) {
    for (const option of estimatePriceOptions(context, recordId)) {
      const candidate = { recordId, ...option };
      if (Buffer.byteLength(JSON.stringify([...priceOptions, candidate])) <= 3_000) priceOptions.push(candidate);
      else omittedPriceOptions++;
    }
  }
  const taxResearch = [] as { resultId: string; fetchedAt: string; evidenceExcerpts: ReturnType<typeof researchEvidenceExcerpts>['evidenceExcerpts']; omittedEvidenceExcerpts: number }[];
  const omittedTaxResearch: string[] = [];
  // A variant edit deliberately clears its old tax treatment. Keep the prior
  // cited research available for a new applicability decision, not as a rule.
  const retainedTax = visitorEstimateTaxInputSchema.safeParse(session.business.estimateTax);
  const researchIds = new Set([
    ...(estimate.tax?.lines.flatMap(line => line.evidence.map(evidence => evidence.resultId)) ?? []),
    ...(retainedTax.success ? retainedTax.data.lines.flatMap(line => line.evidence.map(evidence => evidence.resultId)) : []),
  ]);
  for (const id of researchIds) {
    try {
      // Scope, expiry and exact cited text are checked by the normal recall
      // boundary. Supplying excerpts does not approve their new applicability.
      const result = recallVisitorConversationResearch(session, id);
      const excerpts = researchEvidenceExcerpts(result);
      const entry = { resultId: id, fetchedAt: result.fetchedAt, ...excerpts, evidenceExcerpts: [] as typeof excerpts.evidenceExcerpts };
      entry.omittedEvidenceExcerpts += excerpts.evidenceExcerpts.length;
      for (const excerpt of excerpts.evidenceExcerpts) {
        const candidate = { ...entry, evidenceExcerpts: [...entry.evidenceExcerpts, excerpt], omittedEvidenceExcerpts: entry.omittedEvidenceExcerpts - 1 };
        if (Buffer.byteLength(JSON.stringify([...taxResearch, candidate])) <= 4_000) Object.assign(entry, candidate);
      }
      if (entry.evidenceExcerpts.length) taxResearch.push(entry); else omittedTaxResearch.push(id);
    } catch { omittedTaxResearch.push(id); }
  }
  return {
    revision: estimate.revision,
    lines: estimate.lines.map(({ recordId, fieldId, name, quantity, unitPrice, unit, per, lineTotal }) => ({ recordId, fieldId, name, quantity, unitPrice, unit, per, lineTotal })),
    currency: estimate.currency, formattedSubtotal: estimate.formattedSubtotal,
    priceOptions, omittedPriceOptions, taxResearch, omittedTaxResearch,
    tax: estimate.tax ? { status: estimate.tax.status, mode: estimate.tax.mode, jurisdiction: estimate.tax.jurisdiction, location: estimate.tax.location, fulfillment: estimate.tax.fulfillment,
      estimatedTax: estimate.tax.estimatedTax, estimatedTotal: estimate.tax.estimatedTotal, expiresAt: estimate.tax.expiresAt,
      lines: estimate.tax.lines.map(({ recordId, fieldId, taxability, classification, ratePercent, evidence }) => ({ recordId, fieldId, taxability, classification, ratePercent, evidence: evidence.map(({ resultId, url }) => ({ resultId, url })) })) } : null,
  };
}
