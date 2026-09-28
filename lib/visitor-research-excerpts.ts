import 'server-only';
import { exploreResultSchema, type ExploreResult } from './explore-model';
import { queryHash } from './catalog-query-index';

export type ResearchEvidenceExcerpt = { resultId: string; excerptId: string; url: string; excerpt: string; start: number; end: number };
const maxCharacters = 1000, maxExcerpts = 8, maxBytes = 8000;
function pageUrl(value: string) {
  const url = new URL(value); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); return url.href;
}

/** Selectable model guidance only. Canonical research and citation authority remain unchanged. */
export function researchEvidenceExcerpts(input: ExploreResult): { evidenceExcerpts: ResearchEvidenceExcerpt[]; omittedEvidenceExcerpts: number } {
  const result = exploreResultSchema.parse(input), primary: Omit<ResearchEvidenceExcerpt, 'excerptId'>[] = [], paragraphs: typeof primary = [];
  let unavailable = 0;
  const citations = [...result.citations].sort((a, b) => a.start - b.start || a.end - b.end || a.url.localeCompare(b.url));
  const resultHash = queryHash({ ...result, citations, sources: [...result.sources].sort((a, b) => a.url.localeCompare(b.url) || a.title.localeCompare(b.title)) });
  for (const citation of citations) {
    const source = result.sources.find(source => pageUrl(source.url) === pageUrl(citation.url));
    if (!source || citation.end - citation.start > maxCharacters) { unavailable++; continue; }
    const separator = citation.start < 2 ? -1 : result.answer.lastIndexOf('\n\n', citation.start - 2), following = result.answer.indexOf('\n\n', citation.end);
    const paragraphStart = separator < 0 ? 0 : separator + 2, paragraphEnd = following < 0 ? result.answer.length : following;
    const end = Math.min(paragraphEnd, Math.max(citation.end, paragraphStart + maxCharacters));
    const start = Math.max(paragraphStart, end - maxCharacters);
    const paragraph = { resultId: result.id, url: source.url, excerpt: result.answer.slice(start, end), start, end };
    // Extend across complete preceding paragraphs while retaining the full named citation.
    let contextStart = start;
    while (contextStart === paragraphStart || contextStart < paragraphStart) {
      if (contextStart < 2) break;
      const previous = result.answer.lastIndexOf('\n\n', contextStart - 3), previousStart = previous < 0 ? 0 : previous + 2;
      if (previousStart >= contextStart || end - previousStart > maxCharacters) break;
      contextStart = previousStart;
    }
    primary.push({ ...paragraph, start: contextStart, excerpt: result.answer.slice(contextStart, end) });
    if (contextStart !== start) paragraphs.push(paragraph);
  }
  const seen = new Set<string>();
  const candidates = [...primary, ...paragraphs].filter(excerpt => {
    const key = JSON.stringify([pageUrl(excerpt.url), excerpt.start, excerpt.end]);
    if (seen.has(key)) return false; seen.add(key); return true;
  }).map(excerpt => ({ ...excerpt, excerptId: `excerpt_${queryHash({ resultHash, url: pageUrl(excerpt.url), start: excerpt.start, end: excerpt.end }).slice(0, 32)}` }));
  const projection = { evidenceExcerpts: [] as ResearchEvidenceExcerpt[], omittedEvidenceExcerpts: candidates.length + unavailable };
  for (const candidate of candidates) {
    if (projection.evidenceExcerpts.length >= maxExcerpts) break;
    const proposed = { evidenceExcerpts: [...projection.evidenceExcerpts, candidate], omittedEvidenceExcerpts: projection.omittedEvidenceExcerpts - 1 };
    if (Buffer.byteLength(JSON.stringify(proposed)) > maxBytes) continue;
    projection.evidenceExcerpts.push(candidate); projection.omittedEvidenceExcerpts--;
  }
  return projection;
}
