import { z } from 'zod';
import { siteDesignSchema } from './site-design.js';

/** A limit on planning, never permission to omit sections from the website. */
export const WEBSITE_COMPOSITION_MAX_SECTIONS = 64;
export const WEBSITE_COMPOSITION_MAX_BINDING = 100;
const reference = z.string().min(1).max(160);
const revision = z.string().min(1).max(100).nullable();
const label = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[<>\u0000-\u001f]/.test(value), 'Use a plain destination label.');

export const websiteCompositionSnapshotSchema = z.object({
  contentBinding: z.string().min(2).max(WEBSITE_COMPOSITION_MAX_BINDING),
  knowledgeRevisionId: revision,
  catalogPublicationId: revision,
  mediaRevisionId: revision,
}).strict();

/** References only: the host retains content, CSS, actions and publication authority. */
export const websiteCompositionPlanSchema = z.object({
  version: z.literal(1),
  snapshot: websiteCompositionSnapshotSchema,
  style: siteDesignSchema,
  sectionOrder: z.array(reference).max(WEBSITE_COMPOSITION_MAX_SECTIONS),
  navigation: z.array(z.object({ sectionId: reference, label: label(32) }).strict()).max(WEBSITE_COMPOSITION_MAX_SECTIONS),
  primaryAction: z.object({ actionId: reference, label: label(48) }).strict().nullable(),
  heroAssetId: reference.nullable(),
  // Hosts keep these notes in publisher review and remove them from public projections.
  reviewNotes: z.array(z.string().trim().min(1).max(280)).max(4),
}).strict();

export type WebsiteCompositionPlan = z.infer<typeof websiteCompositionPlanSchema>;
export type WebsiteCompositionSnapshot = z.infer<typeof websiteCompositionSnapshotSchema>;

export type WebsiteCompositionAction = {
  actionId: string;
  kind: 'section' | 'contact' | 'assistant';
  sectionId?: string;
  labels: string[];
};
