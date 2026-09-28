import { z } from 'zod';
import { AppError } from './errors';
import { GLOBAL_VISITOR_LIMITS, type VisitorAvailability, type VisitorSettingsInput } from './visitor-model';

const counter = z.number().int().nonnegative();
const counts = z.object({ chat: counter, voice: counter });
export const ledgerSchema = z.object({
  day: z.iso.date(), totals: counts,
  sites: z.record(z.string(), counts),
  requests: z.record(z.string(), z.literal(true)),
  search: z.object({ total: counter, sites: z.record(z.string(), counter) }).optional(),
  dictation: z.object({ total: counter, sites: z.record(z.string(), counter) }).optional(),
});
export type VisitorLedger = z.infer<typeof ledgerSchema>;
export class VisitorAttemptError extends AppError {
  constructor(message: string, public availability: VisitorAvailability, status: number) { super(message, status); }
}
export class VisitorLimitError extends VisitorAttemptError {
  constructor(message: string, state: VisitorAvailability) { super(message, state, 429); }
}
export function currentLedger(value: unknown, now = Date.now()): VisitorLedger {
  const day = new Date(now).toISOString().slice(0, 10);
  // A malformed stored ledger must never reset usage.
  if (value !== undefined) {
    const parsed = ledgerSchema.safeParse(value);
    if (!parsed.success || parsed.data.day > day) throw new AppError('Visitor usage is temporarily unavailable.', 503);
    if (parsed.data.day === day) return parsed.data;
  }
  return { day, totals: { chat: 0, voice: 0 }, sites: {}, requests: {} };
}
export function availability(ledger: VisitorLedger, siteId: string, settings: VisitorSettingsInput, live: boolean): VisitorAvailability {
  const used = ledger.sites[siteId] ?? { chat: 0, voice: 0 };
  return { enabled: settings.enabled, mode: settings.mode, live,
    chatRemaining: settings.enabled ? Math.max(0, Math.min(settings.chatDailyLimit - used.chat, GLOBAL_VISITOR_LIMITS.chat - ledger.totals.chat)) : 0,
    voiceRemaining: settings.enabled && settings.mode !== 'chat' ? Math.max(0, Math.min(settings.voiceDailyLimit - used.voice, GLOBAL_VISITOR_LIMITS.voice - ledger.totals.voice)) : 0,
    resetsAt: new Date(Date.parse(`${ledger.day}T00:00:00Z`) + 86_400_000).toISOString(),
  };
}
export function reserveReply(ledger: VisitorLedger, siteId: string, requestId: string, kind: 'chat' | 'voice', settings: VisitorSettingsInput, live: boolean) {
  if (!settings.enabled) throw new AppError('This site has not enabled visitor conversations.', 403);
  const state = availability(ledger, siteId, settings, live);
  if (kind === 'voice' && settings.mode === 'chat') throw new AppError('Voice is not enabled on this site.', 403);
  // Text is an independently capped fallback even when the preferred voice mode
  // still has turns (for example, microphone denial or an unsupported browser).
  if (ledger.requests[requestId]) throw new AppError('This request was already received. Send a new message to continue.', 409);
  if ((kind === 'chat' ? state.chatRemaining : state.voiceRemaining) < 1) {
    throw new VisitorLimitError(kind === 'voice' ? 'Voice has reached its daily limit. You can continue in chat.' : 'Chat has reached its daily limit. Please return after the daily reset.', state);
  }
  const used = ledger.sites[siteId] ?? { chat: 0, voice: 0 };
  ledger.sites[siteId] = { ...used, [kind]: used[kind] + 1 };
  ledger.totals[kind]++;
  ledger.requests[requestId] = true;
  return availability(ledger, siteId, settings, live);
}

/** Dictation fills the composer; only a later Send reserves a chat turn. */
export function reserveDictation(ledger: VisitorLedger, siteId: string, requestId: string, settings: VisitorSettingsInput, live: boolean) {
  if (!settings.enabled) throw new AppError('This site has not enabled visitor conversations.', 403);
  if (!live) throw new AppError('Recorded dictation is unavailable in the demo preview. Type your message instead.', 503);
  const state = availability(ledger, siteId, settings, live);
  if (ledger.requests[requestId]) throw new AppError('This recording was already received. Start a new recording to continue.', 409);
  if (!state.chatRemaining) throw new VisitorLimitError('Chat has reached its daily limit. Please return after the daily reset.', state);
  const used = ledger.dictation?.sites[siteId] ?? 0;
  if (used >= settings.chatDailyLimit || (ledger.dictation?.total ?? 0) >= GLOBAL_VISITOR_LIMITS.chat) {
    throw new VisitorLimitError('Dictation has reached its daily limit. You can still type your message.', state);
  }
  ledger.dictation ??= { total: 0, sites: {} };
  ledger.dictation.total++;
  ledger.dictation.sites[siteId] = used + 1;
  ledger.requests[requestId] = true;
  return state;
}
