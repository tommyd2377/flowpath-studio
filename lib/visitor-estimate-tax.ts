import 'server-only';
import { z } from 'zod';
import { publicationRefSchema, taskIdSchema } from '@thevoice/platform-ui/query';
import { scopedEstimateTaxSchema, visitorEstimateTaxInputSchema, type VisitorEstimateTaxInput } from '@thevoice/platform-ui/estimate-tax';
import { exploreResultSchema, publicWebUrl } from './explore-model';
import { recallVisitorConversationResearch } from './visitor-conversation-memory';
import { queryHash } from './catalog-query-index';
import { researchEvidenceExcerpts } from './visitor-research-excerpts';

export { visitorEstimateTaxInputSchema } from '@thevoice/platform-ui/estimate-tax';
export class TaxEstimateInputError extends Error {
  constructor(message: string) { super(message); this.name = 'TaxEstimateInputError'; }
}
function evidencePageUrl(value: string) {
  const url = new URL(value); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); return url.href;
}
const basisSchema = z.object({
  revision: z.number().int().nonnegative(), publication: publicationRefSchema, asOf: z.iso.date(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(), fractionDigits: z.number().int().min(0).max(4).nullable(),
  subtotalMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lines: z.array(z.object({ recordId: taskIdSchema, fieldId: taskIdSchema, quantity: z.number().int().min(1).max(1000), lineTotal: z.string().regex(/^\d+(?:\.\d{1,4})?$/) })).max(12),
});
type EstimateBasis = z.infer<typeof basisSchema>;
type MemorySession = Parameters<typeof recallVisitorConversationResearch>[0];
const maxResearchAge = 24 * 60 * 60_000;
const scale = 1_000_000n;
const rateUnits = (rate: string) => { const [whole, fraction = ''] = rate.split('.'); return BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0')); };
const vulgarFractions: Record<string, readonly [number, number]> = {
  '¼': [1, 4], '½': [1, 2], '¾': [3, 4], '⅐': [1, 7], '⅑': [1, 9], '⅒': [1, 10], '⅓': [1, 3], '⅔': [2, 3],
  '⅕': [1, 5], '⅖': [2, 5], '⅗': [3, 5], '⅘': [4, 5], '⅙': [1, 6], '⅚': [5, 6], '⅛': [1, 8], '⅜': [3, 8], '⅝': [5, 8], '⅞': [7, 8],
};
function evidenceHasRate(excerpt: string, rate: string) {
  // Match entire percentage tokens. Fraction comparisons stay rational: a
  // repeating fraction cannot silently become an approximate decimal rate.
  const percentages = /(?<![\p{L}\p{N}.,+\-/⁄])(?:(\d{1,3})[\p{Zs}\t]+(\d{1,3})[/⁄](\d{1,3})|(\d{1,3})?[\p{Zs}\t]*([¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])|(\d{1,3})[/⁄](\d{1,3})|(\d{1,3}(?:\.\d{1,6})?))\s*(?:%|percent\b)/giu;
  const expected = rateUnits(rate);
  return [...excerpt.matchAll(percentages)].some(match => {
    if (match[8]) return rateUnits(match[8]) === expected;
    const whole = BigInt(match[1] ?? match[4] ?? '0');
    const [numerator, denominator] = match[5] ? vulgarFractions[match[5]].map(BigInt)
      : [BigInt(match[2] ?? match[6]), BigInt(match[3] ?? match[7])];
    return denominator > 0n && (whole * denominator + numerator) * scale === expected * denominator;
  });
}
function evidenceNamesJurisdiction(excerpt: string, jurisdiction: string) {
  // Match every declared name in one passage; this infers neither aliases nor legal applicability.
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/gu, ' ').trim();
  const names = jurisdiction.split(/[(),/]/u).map(normalize).filter(Boolean), passage = normalize(excerpt);
  return names.length > 0 && names.every(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u').test(passage);
  });
}
const lineKey = (line: { recordId: string; fieldId: string }) => JSON.stringify([line.recordId, line.fieldId]);
function decimal(value: bigint, digits: number) {
  const padded = value.toString().padStart(digits + 1, '0');
  return digits ? `${padded.slice(0, -digits)}.${padded.slice(-digits)}` : padded;
}
function lineMinor(value: string, digits: number) {
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > digits) throw new Error('Tax calculation requires already rounded server estimate lines.');
  return BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
}
/** Binds a tax result to the exact server-calculated basket, publication and date. */
export function estimateTaxBasisHash(estimate: EstimateBasis) { return queryHash(basisSchema.parse(estimate)); }

/** Pure calculation over session-owned research; never searches or creates commerce authority. */
export function estimateVisitorTax({ session, estimate, input, now = Date.now() }: { session: MemorySession; estimate: EstimateBasis; input: VisitorEstimateTaxInput; now?: number }) {
  const basis = basisSchema.parse(estimate), request = visitorEstimateTaxInputSchema.parse(input);
  if (!Number.isFinite(now) || queryHash(session.publication) !== queryHash(basis.publication)) throw new Error('Tax estimate must use the current visitor publication and time.');
  const calculatedAt = new Date(now).toISOString(), missing: string[] = [];
  let expires = Math.min(session.createdAt + 2 * 60 * 60_000, Date.parse(`${calculatedAt.slice(0, 10)}T00:00:00.000Z`) + 24 * 60 * 60_000);
  if (basis.asOf !== calculatedAt.slice(0, 10)) missing.push('Recalculate the basket for the current estimate date.');
  if (!basis.lines.length || !basis.currency || basis.fractionDigits === null) missing.push('Add published priced lines before estimating tax.');
  if (now - session.createdAt >= 2 * 60 * 60_000 || now - session.touchedAt >= 30 * 60_000) missing.push('The visitor session has expired.');
  for (const key of ['jurisdiction', 'location', 'fulfillment'] as const) if (!request[key]) missing.push(`Clarify the ${key} for this estimate.`);
  if (!request.applicabilityNotes.length) missing.push('State the applicable conditions and exemptions for this estimate.');
  if (request.mode === 'hypothetical' && !request.visitorAssumption) missing.push('A hypothetical estimate needs the visitor\'s explicit assumption.');
  if (request.mode === 'researched' && request.visitorAssumption) throw new TaxEstimateInputError('Visitor assumptions cannot become researched tax authority.');
  const keys = new Set(basis.lines.map(lineKey));
  if (keys.size !== basis.lines.length) throw new Error('Each estimate must contain each record/price field at most once.');
  if (new Set(request.lines.map(lineKey)).size !== request.lines.length) throw new TaxEstimateInputError('Each tax rule must contain each record/price field at most once.');
  if (request.lines.some(line => !keys.has(lineKey(line)))) throw new TaxEstimateInputError('Tax rules reference a line outside the current estimate.');
  const scopeMissing = missing.length > 0;
  let taxTotal = 0n;
  const lines = basis.lines.map(line => {
    const supplied = request.lines.find(value => lineKey(value) === lineKey(line));
    const rule = supplied ?? { recordId: line.recordId, fieldId: line.fieldId, taxability: 'unknown' as const, classification: null, taxabilityNotes: 'Tax treatment has not been established.', ratePercent: null, evidence: [] };
    const problems: string[] = [];
    if (!rule.classification || rule.taxability === 'unknown') problems.push('Clarify the item classification and tax treatment.');
    if (rule.taxability === 'taxable' && rule.ratePercent === null) problems.push('Establish the applicable rate.');
    if (rule.taxability === 'exempt' && rule.ratePercent !== null && rateUnits(rule.ratePercent) !== 0n) throw new TaxEstimateInputError('Exempt lines cannot have a positive tax rate.');
    const evidence: z.infer<typeof scopedEstimateTaxSchema>['lines'][number]['evidence'] = [];
    if (request.mode === 'hypothetical' && rule.evidence.length) throw new TaxEstimateInputError('A hypothetical rate cannot carry researched authority.');
    if (request.mode === 'researched') {
      for (const suppliedReference of rule.evidence) {
        const result = (() => {
          try { return exploreResultSchema.parse(recallVisitorConversationResearch(session, suppliedReference.resultId, now)); }
          catch (error) {
            if ('excerptId' in suppliedReference) throw new TaxEstimateInputError('The selected research is unavailable or expired in this conversation. Recall available evidence before selecting its excerpt ID.');
            throw error;
          }
        })();
        const selected = 'excerptId' in suppliedReference
          ? researchEvidenceExcerpts(result).evidenceExcerpts.find(value => value.excerptId === suppliedReference.excerptId) : undefined;
        let reference: { resultId: string; url: string; excerpt: string };
        if ('excerptId' in suppliedReference) {
          if (!selected) throw new TaxEstimateInputError('The excerpt ID is not available in this exact retained research result. Select an excerpt ID returned by research.lookup or research.recall.');
          reference = { resultId: result.id, url: selected.url, excerpt: selected.excerpt };
        } else reference = suppliedReference;
        if (!publicWebUrl(reference.url)) throw new TaxEstimateInputError('Tax evidence must use public HTTPS sources.');
        const pageUrl = evidencePageUrl(reference.url);
        const source = result.sources.find(source => evidencePageUrl(source.url) === pageUrl);
        const start = selected?.start ?? result.answer.indexOf(reference.excerpt), end = selected?.end ?? start + reference.excerpt.length;
        // A short excerpt may span blocks only when it contains the named citation.
        // A nearby citation in one paragraph still supports an exact shorter quote.
        const previousParagraph = result.answer.lastIndexOf('\n\n', start);
        const paragraphStart = previousParagraph < 0 ? 0 : previousParagraph + 2;
        const nextParagraph = result.answer.indexOf('\n\n', start);
        const paragraphEnd = nextParagraph < 0 ? result.answer.length : nextParagraph;
        const cited = start >= 0 && result.citations.some(citation => evidencePageUrl(citation.url) === pageUrl
          && (end <= paragraphEnd && citation.start < paragraphEnd && citation.end > paragraphStart
            || reference.excerpt.length <= 1000 && citation.start >= start && citation.end <= end));
        if (!source || !cited) throw new TaxEstimateInputError('Tax evidence must quote a cited paragraph from the exact retained research result, or an excerpt of at most 1000 characters containing the named citation.');
        if (result.demo || result.kind !== 'web') problems.push('Use actual retained web research, not synthetic or image/map results.');
        const age = now - Date.parse(result.fetchedAt);
        if (age < 0 || age > maxResearchAge) problems.push('Refresh stale or future-dated tax research.');
        expires = Math.min(expires, Date.parse(result.fetchedAt) + maxResearchAge);
        evidence.push({ ...reference, title: source.title, fetchedAt: result.fetchedAt, start, end });
      }
      if (!evidence.length) problems.push('Retain cited research supporting this line\'s rate and tax treatment.');
      if (request.jurisdiction && !evidence.some(value => evidenceNamesJurisdiction(value.excerpt, request.jurisdiction!))) problems.push('The cited passage must identify the declared jurisdiction.');
      if (rule.taxability === 'taxable' && rule.ratePercent !== null && !evidence.some(value => evidenceHasRate(value.excerpt, rule.ratePercent!))) problems.push('The declared percentage is not supported by the cited passage.');
    }
    for (const problem of problems) missing.push(`${line.recordId}/${line.fieldId}: ${problem}`);
    let taxMinor: bigint | null = null;
    if (!scopeMissing && !problems.length && basis.fractionDigits !== null) {
      const rate = rule.taxability === 'exempt' ? 0n : rateUnits(rule.ratePercent!);
      taxMinor = (lineMinor(line.lineTotal, basis.fractionDigits) * rate + 50n * scale) / (100n * scale);
      taxTotal += taxMinor;
      if (taxTotal + BigInt(basis.subtotalMinor) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('The tax estimate exceeds the supported total bound.');
    }
    return { ...rule, evidence, taxMinor: taxMinor === null ? null : Number(taxMinor), tax: taxMinor === null ? null : decimal(taxMinor, basis.fractionDigits!) };
  });
  if (basis.fractionDigits !== null && basis.lines.reduce((sum, line) => sum + lineMinor(line.lineTotal, basis.fractionDigits!), 0n) !== BigInt(basis.subtotalMinor)) throw new Error('Tax estimate lines must match the server-calculated subtotal.');
  const complete = !missing.length, total = BigInt(basis.subtotalMinor) + taxTotal;
  return scopedEstimateTaxSchema.parse({ ...request, lines, status: complete ? 'complete' : 'incomplete',
    label: request.mode === 'researched' ? 'Researched tax estimate' : 'Hypothetical tax estimate',
    calculatedAt, expiresAt: new Date(expires).toISOString(), basisHash: estimateTaxBasisHash(basis), currency: basis.currency, fractionDigits: basis.fractionDigits,
    rounding: 'Round each line tax half up to the currency minor unit, then sum the rounded taxes.',
    estimatedTaxMinor: complete ? Number(taxTotal) : null, estimatedTax: complete ? decimal(taxTotal, basis.fractionDigits!) : null,
    estimatedTotalMinor: complete ? Number(total) : null, estimatedTotal: complete ? decimal(total, basis.fractionDigits!) : null, missing,
    notes: [request.mode === 'researched' ? 'Rates and item classifications are interpreted from retained external research, not verified tax authority.' : 'Uses the visitor\'s hypothetical rate and assumptions; no applicable tax rule has been verified.',
      'Planning estimate only, not a tax quote, invoice or amount due. Fees, discounts, exemptions and source price qualifications may change the result.'],
  });
}
