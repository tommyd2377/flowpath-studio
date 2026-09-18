import { z } from 'zod';
import { greetingPointSchema, WELCOME_MESSAGE_MAX_LENGTH } from './site-greeting';
import { visitorSettingsSchema } from './visitor-model';
import { exploreSettingsSchema } from './explore-model';
import { siteDesignSchema } from '@thevoice/platform-ui/site-design';
import { conversationSummary } from './voice-settings';

export const sectionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(2500),
}).strict();

const openingSchema = z.object({
  copyMode: z.enum(['automatic', 'personalized']).optional(),
  // Optional for backward compatibility with snapshots created before the
  // explicit opening policy existed. New sites write this field explicitly.
  visibility: z.enum(['intro-only', 'publisher-selected']).optional(),
  highlights: z.array(z.string().trim().min(1).max(180)).max(3),
  featuredEntityIds: z.array(z.string().min(1).max(80)).max(6),
  initialSections: z.array(z.string().min(1).max(80)).max(6).optional(),
  initialAlbumIds: z.array(z.string().min(1).max(80)).max(6).optional(),
  initialAssetIds: z.array(z.string().min(1).max(80)).max(12).optional(),
  capabilityIds: z.array(z.string().min(1).max(80)).max(3),
  tone: z.enum(['warm', 'direct', 'calm']),
}).strict();

export const contentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  tagline: z.string().trim().max(180).optional(),
  headline: z.string().trim().min(1).max(140),
  description: z.string().trim().max(1500),
  hours: z.string().trim().max(180),
  contact: z.string().trim().max(180),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logoAssetId: z.string().uuid().nullable(),
  welcomeMessage: z.string().trim().max(WELCOME_MESSAGE_MAX_LENGTH).optional(),
  greetingPoints: z.array(greetingPointSchema.nullable()).length(3).optional(),
  style: siteDesignSchema.optional(),
  visitorSpeaksFirst: z.boolean().optional(),
  visitor: visitorSettingsSchema.optional(),
  explore: exploreSettingsSchema.optional(),
  knowledgeRevisionId: z.string().uuid().optional(),
  catalogPublicationId: z.string().uuid().optional(),
  mediaRevisionId: z.string().uuid().optional(),
  opening: openingSchema.optional(),
  sections: z.array(sectionSchema).max(12).refine(sections => new Set(sections.map(section => section.id)).size === sections.length, 'Each content section must have a unique ID.'),
}).strict();

/** Retire obsolete source-renderer references when reading or editing older snapshots. */
export function nativeWebsiteContent<T>(content: T): T {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content;
  const native = { ...content } as T & { websiteLayoutRevisionId?: unknown; websiteReadingRevisionId?: unknown };
  delete native.websiteLayoutRevisionId; delete native.websiteReadingRevisionId;
  return native;
}

export type SiteContent = z.infer<typeof contentSchema>;
export type SiteFile = { id: string; name: string; mime: string; size: number; uploadedAt: string; kind: 'image' | 'text' | 'pdf' | 'video';
  video?: { duration: number; width: number; height: number };
  image?: { width: number; height: number; hash: string; caption?: string; credit?: string } };
export type Change = { label: string; before: string; after: string };
export type ChatMessage = {
  id: string; role: 'user' | 'assistant'; text: string; createdAt: string;
  source?: 'demo' | 'openai';
  proposal?: { content: SiteContent; baseContent: string; changes: Change[]; status: 'pending' | 'applied' | 'discarded' };
};
export type Site = {
  id: string; slug: string; ownerId: string; template: 'voice-v1'; revision: number;
  draft: SiteContent; published: SiteContent | null; publishedAt: string | null;
  history: SiteContent[]; files: SiteFile[]; messages: ChatMessage[];
};
export type SiteSummary = Pick<Site, 'id' | 'slug' | 'revision' | 'publishedAt'> & { name: string; accent: string; dirty: boolean };

export function hasChanges(site: Site) {
  return JSON.stringify(site.draft) !== JSON.stringify(site.published);
}

export function summarize(site: Site): SiteSummary {
  return { id: site.id, slug: site.slug, revision: site.revision, publishedAt: site.publishedAt,
    name: site.draft.name, accent: site.draft.accent, dirty: hasChanges(site) };
}

export function describeChanges(before: SiteContent, after: SiteContent): Change[] {
  const labels: Record<Exclude<keyof SiteContent, 'sections'>, string> = { name: 'Site name', tagline: 'Tagline', headline: 'Headline', description: 'Introduction',
    hours: 'Opening hours', contact: 'Contact', accent: 'Brand color', logoAssetId: 'Logo',
    welcomeMessage: 'Welcome message', greetingPoints: 'Spoken greeting points', style: 'Visitor style', visitorSpeaksFirst: 'Conversation opening', visitor: 'Visitor conversations', explore: 'Search and explore', knowledgeRevisionId: 'Knowledge revision', catalogPublicationId: 'Collection publication', mediaRevisionId: 'Photos and albums', opening: 'Opening experience' };
  const display = (content: SiteContent, key: keyof typeof labels) => key === 'visitor'
    ? `${content.visitor?.enabled ? content.visitor.mode : 'Off'} · GPT Live 1 · ${content.visitor?.chatDailyLimit ?? 25} chat messages / ${content.visitor?.voiceDailyLimit ?? 5} voice tasks per day · ${content.visitor?.voiceIdleTimeoutSeconds ?? 60}s idle close · ${content.visitor?.voiceSessionSeconds ?? 120}s session maximum · Purpose: ${content.visitor?.assistantPurpose || 'Help visitors explore published information'} · ${conversationSummary(content)}`
    : key === 'explore' ? content.explore?.enabled ? `On · ${content.explore.dailyLimit} searches/day · ${content.explore.images ? 'images on' : 'images off'} · ${content.explore.maps ? 'maps on' : 'maps off'} · ${content.explore.annotations ? 'web additions on' : 'web additions off'} · ${content.explore.allowedDomains.join(', ') || 'wider web'}` : 'Off'
    : key === 'welcomeMessage' ? content.welcomeMessage?.trim() || 'Default greeting'
    : key === 'visitorSpeaksFirst' ? content.visitorSpeaksFirst ? 'Visitor speaks first' : 'Assistant welcomes the visitor' : String(content[key] ?? 'None');
  const changes = (Object.keys(labels) as (keyof typeof labels)[]).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(key => ({ label: labels[key], before: display(before, key), after: display(after, key) }));
  const sectionText = (section: SiteContent['sections'][number]) => `${section.title}\n${section.body}`;
  before.sections.forEach((section, index) => {
    const next = after.sections.find(item => item.id === section.id);
    if (!next) changes.push({ label: `Remove section ${index + 1}`, before: sectionText(section), after: 'Removed' });
    else if (section.title !== next.title || section.body !== next.body) {
      changes.push({ label: `Edit section ${index + 1}`, before: sectionText(section), after: sectionText(next) });
    }
  });
  after.sections.forEach((section, index) => {
    if (!before.sections.some(item => item.id === section.id)) {
      changes.push({ label: `Add section ${index + 1}`, before: 'Not present', after: sectionText(section) });
    }
  });
  const previousOrder = before.sections.filter(section => after.sections.some(item => item.id === section.id)).map(section => section.id);
  const nextOrder = after.sections.filter(section => before.sections.some(item => item.id === section.id)).map(section => section.id);
  if (JSON.stringify(previousOrder) !== JSON.stringify(nextOrder)) {
    const sectionOrder = (content: SiteContent) => content.sections.map((section, index) => `${index + 1}. ${sectionText(section)}`).join('\n\n');
    changes.push({ label: 'Section order', before: sectionOrder(before), after: sectionOrder(after) });
  }
  return changes;
}

export function sampleContent(kind: 'general' | 'photographer' | 'florist', name?: string): SiteContent {
  if (kind === 'general') return { name: name || 'Your site', headline: 'Find what you’re looking for.', description: 'Explore our information, compare options, and choose what matters to you.', hours: '', contact: '', accent: '#c8ac85', logoAssetId: null, sections: [] };
  return kind === 'photographer' ? {
    name: name || 'Sophie Chen', headline: 'The moments that feel like you.',
    description: 'Wedding and portrait photography with a quiet eye for the honest, unexpected moments. Based in Brooklyn, available wherever your story takes you.',
    hours: 'Consultations Tuesday–Friday, 10am–5pm', contact: 'hello@sophie.example', accent: '#c8ac85', logoAssetId: null,
    sections: [
      { id: 'weddings', title: 'Wedding stories', body: 'A thoughtful, documentary approach to your day. Coverage follows the moments naturally, from getting ready to the last dance.' },
      { id: 'portraits', title: 'Portrait sessions', body: 'An unhurried session in a place that feels like home. For individuals, couples, and families, with space to be yourself.' },
      { id: 'approach', title: 'My approach', body: 'We start with a conversation. Tell me what matters to you, and we will shape a session around that. Natural light, gentle direction, and nothing forced.' },
    ],
  } : {
    name: name || 'Stem & Story', headline: 'Flowers for the everyday and extraordinary.',
    description: 'A neighborhood floral studio making seasonal arrangements, thoughtful gifts, and flowers for gatherings. Every stem has a place. Every arrangement tells a story.',
    hours: 'Tuesday–Sunday, 9am–6pm', contact: 'hello@stemandstory.example', accent: '#a9bf99', logoAssetId: null,
    sections: [
      { id: 'seasonal', title: 'Seasonal arrangements', body: 'Fresh flowers chosen with the season. Tell us your favorite colors or the feeling you have in mind, and we will make something just for you.' },
      { id: 'gatherings', title: 'Weddings & gatherings', body: 'Flowers that feel part of the occasion. From intimate tables to a room in bloom, we begin with your story and work from there.' },
      { id: 'studio', title: 'Visit the studio', body: 'Come by to browse the stems, pick up an arrangement, or talk about an idea. Our small Brooklyn studio is a place to slow down.' },
    ],
  };
}
