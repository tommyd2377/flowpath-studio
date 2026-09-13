import 'server-only';
import { z } from 'zod';
import { exploreResultSchema, exploreKindSchema, publicWebUrl, type ExploreResult, type ExploreKind } from './explore-model';
import { capability, type Capability } from './visitor-capabilities';
import { resolveEvidence } from './visitor-evidence-store';

export type VisitorResearch = (query: string, kind: ExploreKind, signal: AbortSignal) => Promise<ExploreResult>;
export const taskMapSchema = z.object({ label: z.string().max(160), latitude: z.number().min(-80).max(80), longitude: z.number().min(-180).max(180), zoom: z.number().int().min(2).max(12), approximate: z.literal(true), demo: z.boolean(), sources: z.array(z.object({ title: z.string().max(300), url: z.string().refine(publicWebUrl) }).strict()).max(20) }).strict();
/** Both transports use this lookup. Showing results is a separate acknowledged action. */
export async function lookupVisitorResearch(search: VisitorResearch, query: string, kind: ExploreKind, signal: AbortSignal) {
  signal.throwIfAborted(); const result = exploreResultSchema.parse(await search(query, kind, signal)); signal.throwIfAborted(); return result;
}
export function researchCapabilities(): Capability[] {
  const lookup = capability('research.lookup', 'Look up external web, images or approximate map evidence only when publisher-enabled. Results remain server-owned; lookup does not display.', z.object({ query: z.string().min(1).max(2000), kind: exploreKindSchema }).strict(), 'research', async (context, input) => {
    if (!context.research) throw new Error('Research is not enabled for this publication.');
    return lookupVisitorResearch(context.research, input.query, input.kind, context.signal);
  }, 'read'); lookup.output = exploreResultSchema;
  const map = capability('map.fromEvidence', 'Prepare an approximate geographic view from actual server-owned lookup evidence. Missing coordinates require another lookup, never invention.', z.object({ evidence: exploreResultSchema }).strict(), 'map', async (context, input) => {
    // Raw tool arguments cannot mint external authority: a matching retained result is mandatory.
    const retained = context.session.evidence.find(value => value.handle.type === 'research' && (value.data as ExploreResult).id === input.evidence.id);
    const evidence = retained ? exploreResultSchema.parse(resolveEvidence(context.session, retained.handle.id, 'research')) : null;
    if (!evidence?.map) throw new Error('The retained evidence has no coordinates. Request a map lookup or clarify the place.');
    return { ...evidence.map, approximate: true, demo: evidence.demo, sources: evidence.sources };
  }, 'read'); map.output = taskMapSchema;
  return [lookup, map];
}
