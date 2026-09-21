import { z } from 'zod';
import { referenceKey, workspaceReferenceSchema, type WorkspaceAuthority, type WorkspaceReference } from '@thevoice/platform-ui/workspace';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';

const inputSchema = z.object({ query: z.string().max(2000), reference: workspaceReferenceSchema.nullable(), offset: z.number().int().min(0).max(100000) }).strict();
// Model tool: describe bounded published-text search and exact-reference pagination without changing the view.
export const publishedContentTool = {
  type: 'function', name: 'read_published_content',
  description: 'Read or search the full published website text without changing the screen or searching the web. For a site question, use its words as query, reference:null, offset:0. To read a particular source fully, use its returned reference, query:"", and offset:0, then nextOffset as needed. Results are excerpts, not an exhaustive offering list unless complete. Structured facts and their qualifications remain authoritative.',
  parameters: z.toJSONSchema(inputSchema, { target: 'draft-7' }),
};
export const PUBLISHED_CONTENT_BYTES = 16000;
const stop = new Set(['a', 'an', 'and', 'are', 'at', 'can', 'could', 'do', 'does', 'for', 'from', 'have', 'how', 'i', 'in', 'is', 'it', 'me', 'of', 'on', 'please', 'show', 'tell', 'the', 'there', 'these', 'this', 'to', 'what', 'which', 'with', 'you', 'your']);
const words = (text: string) => text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word && !stop.has(word)).map(word => word.length > 3 && /s$/.test(word) && !/ss$/.test(word) ? word.slice(0, -1) : word);
type Passage = { reference: WorkspaceReference; name: string; blockId: string; heading: string; start: number; end: number; blockLength: number; text: string };

/** Only the already-authorized public snapshot. No private artifacts or fetches.
 * A stable reference + empty query pages through every character of its text. */
export function readPublishedContent(raw: unknown, authority: WorkspaceAuthority, catalog?: KnowledgeCatalog | null) {
  const input = inputSchema.parse(raw);
  const sources = authority.records.filter(record => record.reference.kind === 'source' || record.reference.kind === 'entity');
  const selected = input.reference ? sources.filter(record => referenceKey(record.reference) === referenceKey(input.reference!)) : sources;
  if (input.reference && !selected.length) throw new Error('Unknown published content reference.');
  const terms = [...new Set(words(input.query))];
  const candidates: { passage: Passage; score: number; order: number }[] = [];
  const entities = new Map(catalog?.entities.map(entity => [entity.id, entity]));
  for (const source of selected) {
    const entity = source.reference.kind === 'entity' ? entities.get(source.reference.id) : undefined;
    const blocks = [ ...(source.body ? [{ id: 'summary', kind: 'paragraph', text: source.body }] : []), ...(entity?.blocks ?? []) ];
    let heading = '';
    const titleWords = new Set(words(`${source.name} ${(entity?.aliases ?? []).join(' ')}`));
    for (const block of blocks) {
      if (block.kind === 'heading') heading = block.text;
      // A heading supplies context to its paragraphs; it is not an answer by
      // itself. Exact-reference reading still includes every original block.
      if (terms.length && block.kind === 'heading') continue;
      for (let start = 0; start < block.text.length;) {
        let end = Math.min(start + 1600, block.text.length);
        if (end < block.text.length) {
          const boundary = Math.max(block.text.lastIndexOf('\n', end), block.text.lastIndexOf(' ', end));
          if (boundary > start + 800) end = boundary + 1;
          else if (/^[\uDC00-\uDFFF]$/.test(block.text[end])) end--;
        }
        const text = block.text.slice(start, end), bodyWords = words(text), headingWords = new Set(words(heading));
        const score = terms.reduce((total, term) => total + Number(titleWords.has(term)) + Number(headingWords.has(term)) * 3 + Math.min(3, bodyWords.filter(word => word === term).length) * 6 / (1 + bodyWords.length / 60), 0)
          * (block.id === 'summary' && entity?.blocks?.length ? 0.5 : 1);
        if (!terms.length || score) candidates.push({ passage: { reference: source.reference, name: source.name, blockId: block.id, heading: heading.slice(0, 160), start, end, blockLength: block.text.length, text }, score, order: candidates.length });
        start = end;
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
  const result = { publicationId: authority.publicationId, status: 'retrieved' as const, totalPassages: candidates.length, offset: input.offset,
    passages: [] as Passage[], nextOffset: null as number | null };
  // Reserve metadata space as well as escaping/multibyte text. Never make the
  // model guess whether a bounded response omitted more published content.
  for (const candidate of candidates.slice(input.offset, input.offset + 6)) {
    const next = [...result.passages, candidate.passage];
    if (new TextEncoder().encode(JSON.stringify({ ...result, passages: next, nextOffset: input.offset + next.length })).length > PUBLISHED_CONTENT_BYTES) break;
    result.passages = next;
  }
  if (input.offset + result.passages.length < candidates.length) result.nextOffset = input.offset + result.passages.length;
  return result;
}
