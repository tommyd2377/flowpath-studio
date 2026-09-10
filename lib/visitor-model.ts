import type { PresentationPlan } from '@thevoice/platform-ui/contracts';
import { z } from 'zod';
import type { SiteContent } from './site-model';
import type { SitePresentation } from './site-presentation';

export const visitorSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['chat', 'voice', 'both']),
  voiceTier: z.enum(['standard', 'premium']),
  chatDailyLimit: z.number().int().min(1).max(100),
  voiceDailyLimit: z.number().int().min(0).max(100),
}).strict();
export type VisitorSettings = z.infer<typeof visitorSettingsSchema>;
export const DEFAULT_VISITOR_SETTINGS: VisitorSettings = {
  enabled: true, mode: 'voice', voiceTier: 'premium', chatDailyLimit: 25, voiceDailyLimit: 5,
};
export const VOICE_MODELS = { standard: 'gpt-realtime-2.1-mini', premium: 'gpt-realtime-2.1' } as const;
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
export type VisitorReply = { text: string; presentation?: SitePresentation; catalogPlan?: PresentationPlan; userText?: string; audio?: string; demo?: boolean; availability: VisitorAvailability };

export function visitorSettings(content: Pick<SiteContent, 'visitor'>): VisitorSettings {
  // Legacy published snapshots stay inactive until their owner republishes.
  return content.visitor ?? { ...DEFAULT_VISITOR_SETTINGS, enabled: false };
}

export function visitorDraft(content: SiteContent): SiteContent {
  const settings = visitorSettings(content);
  return settings.enabled ? content : { ...content, visitor: { ...settings, enabled: true, mode: 'voice' } };
}

export function demoVisitorReply(content: SiteContent, text: string) {
  if (/\b(hours|open|available|availability|time)\b/i.test(text)) return content.hours || 'Please contact the site owner for current availability.';
  if (/\b(contact|email|phone|reach)\b/i.test(text)) return content.contact || 'Contact details have not been published yet.';
  const words = text.toLowerCase().split(/\W+/).filter(word => word.length > 3);
  const section = content.sections.find(section => words.some(word => section.title.toLowerCase().includes(word)));
  return section?.body || content.description || `Welcome to ${content.name}. Ask about the information on this site.`;
}
