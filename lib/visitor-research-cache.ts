import 'server-only';
import { exploreResultSchema, type ExploreResult, type ExploreKind } from './explore-model';
import type { VisitorResearch } from './visitor-research';

/** Session-local evidence reuse. Freshness-sensitive requests always search again. */
export function createVisitorResearchCache() {
  const entries = new Map<string, { result: ExploreResult; expires: number }>();
  return async (search: VisitorResearch, query: string, kind: ExploreKind, signal: AbortSignal, scope = '') => {
    signal.throwIfAborted();
    const key = JSON.stringify([scope, kind, query.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()]);
    const fresh = /\b(latest|now|today|current|newest|recent|live|refresh|again|updated)\b/i.test(query);
    const cached = entries.get(key);
    if (!fresh && cached && cached.expires > Date.now()) return structuredClone(cached.result);
    const result = exploreResultSchema.parse(await search(query, kind, signal));
    signal.throwIfAborted();
    if (!fresh) { if (entries.size >= 6) entries.delete(entries.keys().next().value!); entries.set(key, { result: structuredClone(result), expires: Date.now() + 60_000 }); }
    return result;
  };
}
/** A completed, cited answer may satisfy one exact factual lookup. The entire
 * request must match; comparisons, multi-step instructions and displays do not. */
export function completedSearchAnswer(request: string | undefined, result: ExploreResult): string | undefined {
  if (!request || /[;\n]/.test(request) || result.kind !== 'web' || !result.citations.length || result.annotationTarget) return;
  const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim()
    .replace(/^(?:please |can you |could you )+/, '').replace(/^(?:search (?:the web |online )?for |look up |find information (?:on|about) )/, '');
  const text = normalize(request);
  if (text !== normalize(result.query) || /\b(and|or|then|also|compare|versus|vs|why|explain|analy[sz]e|recommend|show|open|display|create|save|add|book|buy)\b|[;?!]/i.test(text)) return;
  if (!/^(?:what (?:is|are|was|were)|who (?:is|was)|when (?:is|was|did)|where (?:is|are))\b/.test(text)) return;
  // Preserve complete answer and citation offsets; don't truncate a claim.
  return result.answer.trim() && result.answer.length <= 1600 ? result.answer : undefined;
}
