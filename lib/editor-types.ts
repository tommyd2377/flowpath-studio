export const AI_DAILY_LIMIT = 10;
export const AI_GLOBAL_DAILY_LIMIT = 100;
export type EditorStatus = { mode: 'demo' | 'openai' | 'unavailable'; message: string; dailyLimit: number };
