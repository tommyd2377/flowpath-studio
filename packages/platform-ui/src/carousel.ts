import { z } from 'zod';

const id = z.string().min(1).max(200);
export const carouselCardSchema = z.object({
  id, kind: z.enum(['information', 'record', 'photo', 'video', 'comparison', 'research', 'artifact', 'answer']),
  title: z.string().max(200), referenceIds: z.array(id).max(48),
}).strict();
/** A receipt for the AI surface only. Published references remain the host's authority. */
export const carouselContextSchema = z.object({
  version: z.literal(1), open: z.boolean(), revision: z.number().int().nonnegative(),
  cards: z.array(carouselCardSchema).max(48), activeId: id.nullable(), previousId: id.nullable(),
  lastNarratedId: id.nullable(), expanded: z.boolean(),
  reading: z.object({ scrollTop: z.number().int().min(0).max(10000000), blockId: id.nullable() }).strict(),
  media: z.object({ id, status: z.enum(['paused', 'playing', 'ended', 'unavailable']), seconds: z.number().min(0).max(86400) }).strict().nullable(),
  recentCards: z.array(carouselCardSchema).max(12).optional(),
  page: z.object({ start: z.number().int().min(1), total: z.number().int().nonnegative() }).strict().optional(),
  answer: z.string().max(8000).optional(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.cards.map(card => card.id)).size !== value.cards.length || value.activeId && !value.cards.some(card => card.id === value.activeId)) ctx.addIssue({ code: 'custom', message: 'Invalid carousel identity.' });
});
export type CarouselContext = z.infer<typeof carouselContextSchema>;
export type CarouselCard = z.infer<typeof carouselCardSchema>;
export type CarouselPosition = { key: string; activeId: string | null; previousId: string | null; expanded: boolean; revision: number; positions: Record<string, string> };
export const initialCarouselPosition = (): CarouselPosition => ({ key: '', activeId: null, previousId: null, expanded: false, revision: 0, positions: {} });
export function reconcileCarousel(state: CarouselPosition, key: string, ids: string[], preferred?: string | null): CarouselPosition {
  const candidate = preferred ?? (key === state.key ? state.activeId : state.positions[key]);
  const activeId = candidate && ids.includes(candidate) ? candidate : ids[0] ?? null;
  if (state.key === key && state.activeId === activeId) return state;
  const positions = { ...state.positions, ...(state.activeId ? { [state.key]: state.activeId } : {}) };
  return { ...state, key, activeId, previousId: state.activeId ?? state.previousId, expanded: false, revision: state.revision + 1, positions: Object.fromEntries(Object.entries(positions).slice(-20)) };
}
export function moveCarousel(state: CarouselPosition, ids: string[], target: string): CarouselPosition {
  if (!ids.includes(target) || state.activeId === target) return state;
  return { ...state, previousId: state.activeId, activeId: target, expanded: false, revision: state.revision + 1, positions: { ...state.positions, [state.key]: target } };
}
/** Identical finalized navigation words in chat and voice use this command contract. */
export function carouselCommand(text: string): { action: 'next' | 'previous' | 'expand' | 'collapse' | 'dismiss' | 'open' | 'back' | 'start_over' | 'home'; ordinal?: number } | null {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (/^(?:(?:show|go to)(?: me)? (?:the )?)?next(?: (?:one|card|photo|item|video))?$/.test(normalized)) return { action: 'next' };
  if (/^(?:(?:show|go to)(?: me)? (?:the )?)?(?:previous|prior)(?: (?:one|card|photo|item|video))?$/.test(normalized)) return { action: 'previous' };
  if (/^(?:expand|make (?:it|this) (?:bigger|larger)|open this(?: card| one)?)$/.test(normalized)) return { action: 'expand' };
  if (/^(?:collapse|make (?:it|this) smaller)$/.test(normalized)) return { action: 'collapse' };
  if (/^(?:go )?back$/.test(normalized)) return { action: 'back' };
  if (/^(?:start over|start again)$/.test(normalized)) return { action: 'start_over' };
  if (/^(?:website home|home)$/.test(normalized)) return { action: 'home' };
  if (/^(?:back to (?:the )?website|close (?:the )?assistant|return to (?:the )?website|leave (?:the )?assistant)$/.test(normalized)) return { action: 'dismiss' };
  const ordinal = normalized.match(/^open (?:the )?(first|second|third|fourth|fifth|sixth|\d+)(?: one| card| result| item)?$/)?.[1];
  if (ordinal) return { action: 'open', ordinal: /^\d+$/.test(ordinal) ? Number(ordinal) : ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'].indexOf(ordinal) + 1 };
  return null;
}
