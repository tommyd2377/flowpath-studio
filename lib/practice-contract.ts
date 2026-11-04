import type { KnowledgePassage } from './plugin-contract';

export type PracticeId = 'quiz' | 'lessons' | 'flashcards' | 'interview';
export type PracticeInput = { action: string; title: string; prompt: string; detail: string; score: number; sourceId: string };
export type PracticeContext = { sources: readonly KnowledgePassage[] };
export type PracticeView = { title: string; prompt: string; detail: string; progress: string; source?: KnowledgePassage };
export type PracticeResult = { ok: true; message?: string } | { ok: false; error: string };
export type PracticeController = { state(): PracticeView; apply(input: PracticeInput, context: PracticeContext): PracticeResult };
export type PracticeDefinition = {
  id: PracticeId;
  name: string;
  description: string;
  instructions: string;
  create(): PracticeController;
};

export const PRACTICE_IDS = ['quiz', 'lessons', 'flashcards', 'interview'] as const;

export function parsePracticePlugins(value: unknown): PracticeId[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > PRACTICE_IDS.length
    || new Set(value).size !== value.length || value.some(id => !PRACTICE_IDS.includes(id))) return null;
  return PRACTICE_IDS.filter(id => value.includes(id));
}
