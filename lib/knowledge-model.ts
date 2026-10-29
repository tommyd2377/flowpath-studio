export const KNOWLEDGE_FILE_BYTES = 10 * 1024 * 1024;
export const KNOWLEDGE_DOCUMENTS = 20;
export type KnowledgeDocument = {
  id: string; filename: string; bytes: number; status: 'uploading' | 'preparing' | 'review-required' | 'reviewing' | 'manual-review' | 'blocked' | 'ready' | 'failed' | 'removing';
  selected: boolean; createdAt: number; message: string;
};
export type KnowledgeView = { waveformId: string; revision: number; documents: KnowledgeDocument[]; available: boolean; requiresAdultConsent?: boolean;
  storage?: { estimatedMonthlyMicroUsd: number; budgetMicroUsd: number; uploadCapacityAvailable: boolean } };
export class KnowledgeError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
/** A confirmed authorization refusal cannot have created a provider resource. */
export class KnowledgeProviderRefusal extends KnowledgeError {
  constructor() { super('The document service refused access. No automatic retry was made.', 503); }
}
export const knowledgeId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export function knowledgeFilename(value: string) {
  if (!value || value.length > 160 || /[\\/\u0000-\u001f\u007f]/.test(value) || !/\.(pdf|docx|txt)$/i.test(value)) {
    throw new KnowledgeError('Choose a PDF, DOCX or TXT file with a filename up to 160 characters.');
  }
  return value;
}
