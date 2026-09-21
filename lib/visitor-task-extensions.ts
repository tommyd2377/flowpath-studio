import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { visitorArtifactSchema, artifactMarkdown } from '@thevoice/platform-ui/artifacts';
import { capability, type Capability, type CapabilityContext } from './visitor-capabilities';
import { exploreResultSchema } from './explore-model';
import { resolveEvidence } from './visitor-evidence-store';
import { getBackendMode } from './firebase/config';
import { taskDocuments } from './task-persistence';
import { fakeBookingSchema, fakeQuoteSchema, fakeReceiptSchema, fakeSlotSchema, SyntheticVisitorAdapter } from './visitor-adapters/synthetic';

function typed(entry: Capability, output: z.ZodType) { return { ...entry, output }; }
function synthetic(context: CapabilityContext) {
  if (getBackendMode() !== 'demo') throw new Error('Synthetic adapters are available only in the local demo.');
  return new SyntheticVisitorAdapter(taskDocuments('visitorTaskAdapters'), context.session.id, new Map([...context.index.records.keys()].slice(0, 24).map((id, index) => [id, (index + 1) * 1000])), Date.now, `calendar-${context.session.publication.siteId}`);
}
export function taskExtensionCapabilities(): Capability[] {
  return [
    // Model capability: Describe composing a visitor artifact from selected published records.
    typed(capability('artifact.compose', 'Compose an editable brief, reading list or itinerary from explicitly selected published records.', z.object({ kind: z.enum(['brief', 'reading-list', 'itinerary']), title: z.string().min(1).max(160), researchHandles: z.array(z.string()).max(4).optional() }).strict(), 'artifact', async (context, input) => {
      const records = context.session.selection.members.map(member => context.index.records.get(member.recordId)).filter(record => record !== undefined);
      if ((!records.length && !input.researchHandles?.length) || records.length > 24) throw new Error('Select one to twenty-four records for an artifact.');
      const sources = (input.researchHandles ?? []).map(handleId => { const source = exploreResultSchema.parse(resolveEvidence(context.session, handleId, 'research')); return { handleId, title: source.query.slice(0, 160), excerpt: source.answer.slice(0, 1200), observedAt: source.fetchedAt, urls: source.sources.slice(0, 4).map(source => source.url) }; });
      const artifact = visitorArtifactSchema.parse({ sources, version: 2, id: randomUUID(), revision: 0, publication: context.session.publication, kind: input.kind, title: input.title, notes: '', saved: false,
        entries: records.map(record => ({ recordId: record.id, title: record.name, summary: record.summary.slice(0, 320), note: '' })) });
      if (context.session.artifacts.length >= 12) throw new Error('Artifact capacity reached.'); context.session.artifacts.push(artifact); context.session.activeArtifactId = artifact.id; return artifact;
    }), visitorArtifactSchema),
    // Model capability: Describe editing or saving an artifact within the visitor session.
    typed(capability('artifact.edit', 'Edit artifact title/notes or explicitly save it within this visitor session.', z.object({ id: z.string(), baseRevision: z.number().int(), title: z.string().min(1).max(160), notes: z.string().max(4000), saved: z.boolean(), objective: z.string().max(2000).optional(), readingGoal: z.string().max(2000).optional(), timeZone: z.string().max(80).optional(), entries: z.array(z.object({ recordId: z.string(), note: z.string().max(1000), time: z.string().optional(), timeZone: z.string().optional() }).strict()).max(24).optional() }).strict(), 'artifact', async (context, input) => {
      const index = context.session.artifacts.findIndex(value => visitorArtifactSchema.parse(value).id === input.id), previous = visitorArtifactSchema.parse(context.session.artifacts[index]);
      if (previous.revision !== input.baseRevision) throw new Error('Artifact changed.');
      const entries = input.entries ? input.entries.map(entry => { const original = previous.entries.find(value => value.recordId === entry.recordId); if (!original) throw new Error('Artifact entry is not authorized.'); return { ...original, ...entry }; }) : previous.entries;
      if (new Set(entries.map(entry => entry.recordId)).size !== entries.length) throw new Error('Duplicate artifact entry.');
      const details = previous.kind === 'brief' ? { objective: input.objective ?? previous.objective } : previous.kind === 'reading-list' ? { readingGoal: input.readingGoal ?? previous.readingGoal } : { timeZone: input.timeZone ?? previous.timeZone };
      const artifact = visitorArtifactSchema.parse({ ...previous, ...details, entries, title: input.title, notes: input.notes, saved: input.saved, revision: previous.revision + 1 }); context.session.artifacts[index] = artifact; context.session.activeArtifactId = artifact.id; return artifact;
    }), visitorArtifactSchema),
    // Model capability: Describe reopening a retained editable artifact.
    typed(capability('artifact.open', 'Return to a retained editable artifact.', z.object({ id: z.string() }).strict(), 'artifact', async (context, input) => { const artifact = visitorArtifactSchema.parse(context.session.artifacts.find(value => visitorArtifactSchema.parse(value).id === input.id)); context.session.activeArtifactId = artifact.id; return artifact; }), visitorArtifactSchema),
    // Model capability: Describe exporting only authorized published artifact content.
    typed(capability('artifact.export', 'Export only authorized published artifact content as Markdown.', z.object({ id: z.string() }).strict(), 'export', async (context, input) => {
      const artifact = visitorArtifactSchema.parse(context.session.artifacts.find(value => visitorArtifactSchema.parse(value).id === input.id));
      if (artifact.entries.some(entry => !context.index.records.has(entry.recordId))) throw new Error('Artifact publication changed.');
      return { filename: `${artifact.kind}.md`, markdown: artifactMarkdown(artifact) };
    }, 'read'), z.object({ filename: z.string().max(100), markdown: z.string().max(100_000) }).strict()),
    // Model capability: Describe synthetic cart quantities and fixture prices, never real inventory.
    typed(capability('demo.cart', 'DEMO ONLY: set an item quantity using fixed synthetic USD prices. No real inventory or merchant.', z.object({ recordId: z.string(), quantity: z.number().int().min(0).max(99) }).strict(), 'demo-cart', async (context, input) => {
      const state = await synthetic(context).cart(input.recordId, input.quantity); const result = { demoOnly: true as const, cartRevision: state.cartRevision, lines: state.lines };
      context.session.business.cart = result; delete context.session.business.quote; return result;
    }), z.object({ demoOnly: z.literal(true), cartRevision: z.number().int(), lines: z.array(z.object({ recordId: z.string(), quantity: z.number().int(), unitMinor: z.number().int() }).strict()).max(24) }).strict()),
    // Model capability: Describe a fixture-only cart estimate, never a real tax quote.
    typed(capability('demo.quote', 'DEMO ONLY: estimate a cart using fixture tax (8.25%) and pickup/delivery costs. This is not a real tax quote.', z.object({ destination: z.enum(['fixture-pickup', 'fixture-delivery']) }).strict(), 'demo-quote', async (context, input) => { const quote = await synthetic(context).quote(input.destination); context.session.business.quote = quote; return quote; }), fakeQuoteSchema),
    // Model capability: Describe synthetic slots, never live availability.
    typed(capability('demo.availability', 'DEMO ONLY: retrieve synthetic time-zone-labelled slots. Not live availability.', z.object({}).strict(), 'demo-slots', async context => { const slots = await synthetic(context).availability(); context.session.business.slots = slots; return slots; }, 'read'), z.array(fakeSlotSchema).max(3)),
    // Model capability: Describe preparing a synthetic booking draft.
    typed(capability('demo.booking', 'DEMO ONLY: prepare an expiring booking draft for an offered synthetic slot.', z.object({ slotId: z.string() }).strict(), 'demo-booking', async (context, input) => { const booking = await synthetic(context).prepareBooking(input.slotId); context.session.business.booking = booking; return booking; }), fakeBookingSchema),
    // Model capability: Describe explicit confirmation of a reviewed synthetic draft.
    typed(capability('demo.confirm', 'DEMO ONLY: confirm the exact reviewed synthetic draft. Requires an explicit confirmation of its current ID and hash.', z.object({ kind: z.enum(['order', 'booking']), confirmationId: z.string().uuid(), payloadHash: z.string().length(64), operationId: z.string().uuid() }).strict(), 'demo-receipt', async (context, input) => {
      const receipt = await synthetic(context).confirm(input.kind, input.confirmationId, input.payloadHash, input.operationId); context.session.business.receipt = receipt; return receipt;
    }, 'externalCommit'), fakeReceiptSchema),
    // Model capability: Describe reconciling a synthetic outcome without another write.
    typed(capability('demo.status', 'DEMO ONLY: reconcile a synthetic outcome by its original operation ID without another write.', z.object({ operationId: z.string().uuid() }).strict(), 'demo-status', async (context, input) => ({ receipt: await synthetic(context).status(input.operationId) }), 'read'), z.object({ receipt: fakeReceiptSchema.nullable() }).strict()),
  ].map(entry => entry.descriptor.id.startsWith('demo.') ? { ...entry, descriptor: { ...entry.descriptor, demoOnly: true, prepare: ['demo.quote', 'demo.booking'].includes(entry.descriptor.id), status: entry.descriptor.id === 'demo.status', cancellation: entry.descriptor.effect === 'externalCommit' ? 'reconcile' : 'abort' } } : entry);
}
