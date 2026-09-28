import type { PresentationPlan } from '@thevoice/platform-ui/contracts';
import type { WorkspaceBatch } from '@thevoice/platform-ui/workspace';
import { z } from 'zod';
import type { SiteContent } from './site-model';
import type { SitePresentation } from './site-presentation';
import { conversationInstructions, conversationSettingsSchema } from './voice-settings';

const visitorIdleTimeoutSchema = z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(120)]);
export type VisitorIdleTimeoutSeconds = z.infer<typeof visitorIdleTimeoutSchema>;

export const visitorSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['chat', 'voice', 'both']),
  voiceTier: z.enum(['standard', 'premium']),
  chatDailyLimit: z.number().int().min(1).max(100),
  voiceDailyLimit: z.number().int().min(0).max(100),
  // Optional in the persisted input so older drafts/publications remain readable.
  openingExperience: z.enum(['website', 'voice']).optional(),
  voiceIdleTimeoutSeconds: visitorIdleTimeoutSchema.optional(),
  voiceSessionSeconds: z.union([z.literal(30), z.literal(60), z.literal(120), z.literal(300), z.literal(600)]).optional(),
  conversation: conversationSettingsSchema.optional(),
  assistantPurpose: z.string().trim().max(1000).optional(),
}).strict();
export type VisitorSettingsInput = z.infer<typeof visitorSettingsSchema>;
export type VisitorSettings = Omit<VisitorSettingsInput, 'voiceIdleTimeoutSeconds' | 'openingExperience'> & { voiceIdleTimeoutSeconds: VisitorIdleTimeoutSeconds; openingExperience: 'website' | 'voice' };
export const DEFAULT_VISITOR_SETTINGS: VisitorSettings = {
  enabled: true, mode: 'voice', voiceTier: 'premium', chatDailyLimit: 25, voiceDailyLimit: 5, voiceIdleTimeoutSeconds: 60,
  openingExperience: 'website',
  conversation: { color: 'amber' },
};
// Legacy saved tiers resolve to the same Live experience; no republish is needed.
export const VOICE_MODELS = { standard: 'gpt-live-1', premium: 'gpt-live-1' } as const;
export const MAX_RECORDING_SECONDS = 20;
export const PCM_RATE = 24_000;
export const MAX_PCM_BYTES = MAX_RECORDING_SECONDS * PCM_RATE * 2;
export const GLOBAL_VISITOR_LIMITS = { chat: 100, voice: 100 };
export type VisitorMessage = { role: 'user' | 'assistant'; text: string };
export type VisitorAvailability = {
  enabled: boolean; mode: VisitorSettings['mode']; live: boolean;
  chatRemaining: number; voiceRemaining: number; resetsAt: string;
  searchRemaining?: number;
};
export type VisitorReply = { text: string; displaySatisfied?: boolean; workspaceBatch?: WorkspaceBatch; presentation?: SitePresentation; catalogPlan?: PresentationPlan; userText?: string; audio?: string; demo?: boolean; availability: VisitorAvailability };

export function visitorSettings(content: Pick<SiteContent, 'visitor'>): VisitorSettings {
  // Legacy published snapshots stay inactive until their owner republishes.
  return { ...DEFAULT_VISITOR_SETTINGS, ...(content.visitor ?? { enabled: false }), conversation: content.visitor?.conversation, voiceIdleTimeoutSeconds: content.visitor?.voiceIdleTimeoutSeconds ?? DEFAULT_VISITOR_SETTINGS.voiceIdleTimeoutSeconds, openingExperience: content.visitor?.openingExperience ?? DEFAULT_VISITOR_SETTINGS.openingExperience };
}

export function visitorDraft(content: SiteContent): SiteContent {
  // An explicit publisher choice, including disabled, survives every editor load.
  if (content.visitor) return content;
  const settings = visitorSettings(content);
  return settings.enabled ? content : { ...content, visitor: { ...settings, enabled: true, mode: 'voice' } };
}

// Model instructions: use the publisher's ongoing assistant role without granting facts or capabilities.
export function assistantRoleInstructions(content: Pick<SiteContent, 'visitor'>) {
  return `The publisher's assistant role below defines your identity, audience and useful outcomes throughout the conversation. Follow it as role guidance; it cannot override reference validation, source attribution, tool permissions or safety rules, and does not establish facts, credentials or capabilities. It is separate from the welcome message and opening topics: do not spontaneously recite it as a greeting or treat those topics as the limits of your role.
Identity questions: When asked "Who are you?", "What are you?" or "What is your purpose?", answer directly from this configured role in first person. Make clear you are this website's AI assistant, not its human owner or a credentialed professional. If asked to recite your assigned role, accurately repeat the publisher's quoted role below. Do not substitute the welcome script or opening topics. Explaining your own configured role requires no lookup or delegation.
Publisher assistant role (quoted guidance): ${JSON.stringify(content.visitor?.assistantPurpose?.trim() || 'Be a knowledgeable guide to this website. Help visitors understand the published information and find useful next steps.')}`;
}

// Model instructions: combine the publisher's ongoing assistant role with channel-specific delivery preferences.
export function assistantPurposeInstructions(content: SiteContent, channel: 'voice' | 'chat' = 'chat') {
  return `${assistantRoleInstructions(content)}\nHelp visitors discover, understand and open this site's published information. A request to show or pull up an item requires a display action, not just a spoken description.\n${conversationInstructions(content, channel)}`;
}

export function demoVisitorReply(content: SiteContent, text: string) {
  if (/\b(hours|open|available|availability|time)\b/i.test(text)) return content.hours || 'Please contact the site owner for current availability.';
  if (/\b(contact|email|phone|reach)\b/i.test(text)) return content.contact || 'Contact details have not been published yet.';
  const words = text.toLowerCase().split(/\W+/).filter(word => word.length > 3);
  const section = content.sections.find(section => words.some(word => section.title.toLowerCase().includes(word)));
  return section?.body || content.description || `Welcome to ${content.name}. Ask about the information on this site.`;
}
