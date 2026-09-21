import 'server-only';
import { z } from 'zod';
import { publicationRefSchema, type PublicationRef } from '@thevoice/platform-ui/query';
import { exploreKindSchema, exploreResultSchema, type ExploreResult } from './explore-model';
import { queryHash } from './catalog-query-index';

export const VISITOR_RESEARCH_MEMORY_BYTES = 96_000;
export const VISITOR_RESEARCH_PROMPT_BYTES = 12_000;
const resultBytes = 48_000; // Keep the existing per-result evidence/recall ceiling.
const researchIdentitySchema = z.object({ id: z.string().max(80), kind: exploreKindSchema, query: z.string().max(2000), fetchedAt: z.iso.datetime() }).strict();
const researchDirectoryEntrySchema = researchIdentitySchema.extend({ query: z.string().max(160), queryTruncated: z.boolean(), recallable: z.boolean() }).strict();
export const visitorResearchHistorySchema = z.object({ authority: z.literal('historical-external'), entries: z.array(researchDirectoryEntrySchema).max(8) }).strict();
const researchMemoryEntrySchema = z.object({
  sessionId: z.string().uuid(), publication: publicationRefSchema,
  retainedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  identity: researchIdentitySchema, result: exploreResultSchema.nullable(),
}).strict();
export const visitorResearchMemorySchema = z.array(researchMemoryEntrySchema).max(8).default([]);
export type VisitorResearchMemory = z.infer<typeof visitorResearchMemorySchema>;
type MemorySession = { id: string; publication: PublicationRef; createdAt: number; touchedAt: number; researchMemory: VisitorResearchMemory };
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
function currentEntries(session: MemorySession, now: number) {
  if (now - session.createdAt >= 2 * 60 * 60_000 || now - session.touchedAt >= 30 * 60_000) return [];
  return session.researchMemory.filter(entry => entry.sessionId === session.id && queryHash(entry.publication) === queryHash(session.publication) && Date.parse(entry.expiresAt) > now);
}
const directoryEntry = (entry: VisitorResearchMemory[number]) => ({ ...entry.identity, query: entry.identity.query.slice(0, 160), queryTruncated: entry.identity.query.length > 160, recallable: Boolean(entry.result) });

/** Discover exact recall IDs even when no historical context fits in the model prompt. */
export function visitorConversationResearchHistory(session: MemorySession, now = Date.now()) {
  return visitorResearchHistorySchema.parse({ authority: 'historical-external', entries: currentEntries(session, now).slice(-8).reverse().map(directoryEntry) });
}

/** Historical findings survive UI generations, but never another visitor/publication. */
export function pruneVisitorConversationMemory(session: MemorySession, now = Date.now()) {
  session.researchMemory = currentEntries(session, now).slice(-8);
  while (session.researchMemory.length && bytes(session.researchMemory) > VISITOR_RESEARCH_MEMORY_BYTES) session.researchMemory.shift();
}
export function retainVisitorConversationResearch(session: MemorySession, value: unknown, now = Date.now()) {
  const result = exploreResultSchema.parse(value);
  pruneVisitorConversationMemory(session, now);
  if (now - session.createdAt >= 2 * 60 * 60_000 || now - session.touchedAt >= 30 * 60_000) throw new Error('Visitor session expired.');
  const previous = session.researchMemory.find(entry => entry.identity.id === result.id);
  if (previous) {
    if (previous.result && queryHash(previous.result) !== queryHash(result)) throw new Error('Conflicting retained research identity.');
    return; // Recall does not refresh acquisition time, freshness, or retention.
  }
  const identity = { id: result.id, kind: result.kind, query: result.query, fetchedAt: result.fetchedAt };
  session.researchMemory.push({ sessionId: session.id, publication: structuredClone(session.publication),
    retainedAt: new Date(now).toISOString(), expiresAt: new Date(session.createdAt + 2 * 60 * 60_000).toISOString(),
    identity, result: bytes(result) <= resultBytes ? structuredClone(result) : null });
  pruneVisitorConversationMemory(session, now);
}
export function recallVisitorConversationResearch(session: MemorySession, id: string, now = Date.now()): ExploreResult {
  const entry = currentEntries(session, now).find(entry => entry.identity.id === id);
  if (!entry) throw new Error('That earlier research is unavailable or expired in this conversation.');
  if (!entry.result) throw new Error('That earlier research exceeded the retained result limit; its complete evidence is unavailable.');
  return structuredClone(entry.result);
}

/** Include complete findings or explicit recall metadata; never clip qualifications/citations. */
type ConversationMemory = { authority: 'historical-external'; available: ExploreResult[]; omitted: (z.infer<typeof researchDirectoryEntrySchema> & { reason: 'context-budget' | 'result-size' })[]; unlisted: number };
export function visitorConversationMemory(session: MemorySession, request?: string): ConversationMemory;
export function visitorConversationMemory(session: MemorySession, request: string | undefined, maxBytes: number, now?: number): ConversationMemory | null;
export function visitorConversationMemory(session: MemorySession, request = '', maxBytes = VISITOR_RESEARCH_PROMPT_BYTES, now = Date.now()): ConversationMemory | null {
  const words = new Set(request.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);
  const score = (entry: VisitorResearchMemory[number]) => {
    const text = `${entry.identity.query} ${entry.result?.answer ?? ''}`.normalize('NFKC').toLowerCase();
    return [...words].filter(word => text.includes(word)).length;
  };
  const entries = currentEntries(session, now).slice(-8).reverse().sort((a, b) => score(b) - score(a));
  const projection: ConversationMemory = { authority: 'historical-external', available: [], omitted: entries.map(entry => ({ ...directoryEntry(entry), reason: entry.result ? 'context-budget' : 'result-size' })), unlisted: 0 };
  const limit = Math.min(maxBytes, VISITOR_RESEARCH_PROMPT_BYTES);
  while (projection.omitted.length && bytes(projection) > limit) { projection.omitted.pop(); projection.unlisted++; }
  if (bytes(projection) > limit) return null;
  for (const entry of entries) {
    if (!entry.result) continue;
    const index = projection.omitted.findIndex(item => item.id === entry.identity.id);
    const metadata = index >= 0 ? projection.omitted.splice(index, 1)[0] : undefined;
    if (!metadata) projection.unlisted--;
    projection.available.push(entry.result);
    if (bytes(projection) > limit) {
      projection.available.pop();
      if (metadata) projection.omitted.splice(index, 0, metadata); else projection.unlisted++;
    }
  }
  return structuredClone(projection);
}
