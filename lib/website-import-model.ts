import { z } from 'zod';
import { nativeWebsiteContent, contentSchema, type SiteContent } from './site-model';

export const WEBSITE_LIMITS = { images: 60, imageBatch: 20, pages: 24, discovered: 100, discoveryFetches: 12, sitemaps: 4, characters: 60_000, durationMs: 45_000 } as const;
export const websiteDesignSchema = contentSchema.pick({ name: true, headline: true, description: true, accent: true, style: true, contact: true, hours: true }).partial({ contact: true, hours: true });
export type WebsiteDesign = z.infer<typeof websiteDesignSchema>;
export const websitePageReportSchema = z.object({ url: z.string().max(2048), title: z.string().max(160),
  status: z.enum(['ready', 'imported', 'failed', 'skipped', 'duplicate']), message: z.string().max(500), characters: z.number().int().min(0) }).strict();
export type WebsitePageReport = z.infer<typeof websitePageReportSchema>;
export const websiteProposalSchema = z.object({ design: websiteDesignSchema, pages: z.array(websitePageReportSchema).max(100), incomplete: z.boolean().optional(),
  captures: z.array(z.object({ url: z.string().max(2048), title: z.string().max(160), text: z.string().max(60000), rawText: z.string().max(60000).optional() }).strict()).max(24).optional(),
  capturedAt: z.string().datetime(), notes: z.array(z.string().max(1000)).max(20) }).strict();
export type WebsiteProposal = z.infer<typeof websiteProposalSchema>;
export const websiteImageSchema = z.object({ url: z.string().max(2048), pageUrl: z.string().max(2048), alt: z.string().max(1000), variants: z.array(z.string().max(2048)).max(8).optional() }).strict();
export type WebsiteImage = z.infer<typeof websiteImageSchema>;
export type WebsiteDiscovery = { url: string; pages: WebsitePageReport[]; images?: WebsiteImage[]; notes: string[] };

/** Reviewed design changes only identity/presentation, never capabilities or publication IDs. */
export function applyWebsiteDesign(content: SiteContent, design: WebsiteDesign): SiteContent {
  return contentSchema.parse({ ...nativeWebsiteContent(content), ...websiteDesignSchema.parse(design),
    accent: content.style?.template ? content.accent : design.accent,
    style: content.style?.template ? content.style : design.style ? { ...content.style, ...design.style, ...(content.style?.entry ? { entry: content.style.entry } : {}) } : content.style,
    opening: { visibility: 'intro-only', highlights: [], featuredEntityIds: [], capabilityIds: [], tone: 'warm', ...content.opening, copyMode: 'personalized' } });
}
