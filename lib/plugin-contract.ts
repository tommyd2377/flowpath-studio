/** Reviewed, built-in capabilities. No remote code loading or financial authority. */
export const PLUGINS = [
  { id: 'text', version: 2, name: 'Text Box', tools: ['update_text_box'], executor: 'browser', display: 'text' },
  { id: 'knowledge', version: 1, name: 'Knowledge', tools: ['search_waveform_knowledge'], executor: 'server', display: null },
  { id: 'visual', version: 1, name: 'Visual Display', tools: ['update_visual_display'], executor: 'browser', display: 'visual' },
] as const;

export type KnowledgePassage = { id: string; documentId: string; filename: string; quote: string };
export type KnowledgeResult = { revision: number; passages: KnowledgePassage[] };
export type PluginContext = { delegationId: string; isCurrent(): boolean; signal: AbortSignal };
export type PluginExecutor = (args: unknown, context: PluginContext) => Record<string, unknown> | Promise<Record<string, unknown>>;

export function validKnowledgeResult(value: unknown): value is KnowledgeResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as KnowledgeResult;
  return Object.keys(row).length === 2 && Object.keys(row).every(key => ['revision', 'passages'].includes(key))
    && Number.isSafeInteger(row.revision) && row.revision >= 0 && Array.isArray(row.passages) && row.passages.length <= 4
    && row.passages.every(p => p && Object.keys(p).length === 4 && Object.keys(p).every(key => ['id', 'documentId', 'filename', 'quote'].includes(key))
      && typeof p.id === 'string' && /^source_[1-4]$/.test(p.id)
      && typeof p.documentId === 'string' && /^[a-f0-9-]{36}$/.test(p.documentId)
      && typeof p.filename === 'string' && p.filename.length > 0 && p.filename.length <= 160
      && typeof p.quote === 'string' && p.quote.length > 0 && p.quote.length <= 850)
    && new Set(row.passages.map(p => p.id)).size === row.passages.length;
}
