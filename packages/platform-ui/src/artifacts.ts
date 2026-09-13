import { z } from 'zod';
import { publicationRefSchema, queryTimeSchema, taskIdSchema } from './query.js';
const baseArtifactSchema = z.object({ version: z.literal(2), id: taskIdSchema, revision: z.number().int().nonnegative(), publication: publicationRefSchema,
  title: z.string().min(1).max(160), notes: z.string().max(4000), saved: z.boolean(),
  sources: z.array(z.object({ handleId: taskIdSchema, title: z.string().max(160), excerpt: z.string().max(1200), observedAt: queryTimeSchema, urls: z.array(z.string().url()).max(4) }).strict()).max(4).default([]),
  entries: z.array(z.object({ recordId: taskIdSchema, title: z.string().max(180), summary: z.string().max(1600), note: z.string().max(1000), time: queryTimeSchema.optional(), timeZone: z.string().max(80).optional() }).strict()).max(24),
}).strict();
export const briefArtifactSchema = baseArtifactSchema.extend({ kind: z.literal('brief'), objective: z.string().max(2000).default('') });
export const readingListArtifactSchema = baseArtifactSchema.extend({ kind: z.literal('reading-list'), readingGoal: z.string().max(2000).default('') });
export const itineraryArtifactSchema = baseArtifactSchema.extend({ kind: z.literal('itinerary'), timeZone: z.string().max(80).default('UTC').refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }) });
export const visitorArtifactSchema = z.discriminatedUnion('kind', [briefArtifactSchema, readingListArtifactSchema, itineraryArtifactSchema]);
export type VisitorArtifact = z.infer<typeof visitorArtifactSchema>;
/** Export only this already-authorized artifact; no hidden source material is accepted. */
export function artifactMarkdown(artifact: VisitorArtifact): string {
  const safe = (text: string) => text.replace(/[\\`*_{}\[\]<>#]/g, character => `\\${character}`);
  return `# ${safe(artifact.title)}\n\n${safe(artifact.kind === 'brief' ? artifact.objective : artifact.kind === 'reading-list' ? artifact.readingGoal : `Time zone: ${artifact.timeZone}`)}\n\n${safe(artifact.notes)}\n\n${artifact.entries.map((entry, i) => `## ${i + 1}. ${safe(entry.title)}\n\n${safe(entry.summary)}\n\n${safe(entry.note)}${entry.time ? `\n\n${entry.time} (${safe(entry.timeZone ?? 'UTC')})` : ''}`).join('\n\n')}${artifact.sources.length ? `\n\n## External research\n\n${artifact.sources.map(source => `${safe(source.title)} (${safe(source.observedAt)})\n\n${safe(source.excerpt)}\n\n${source.urls.map(url => safe(url)).join('\n')}`).join('\n\n')}` : ''}`;
}
