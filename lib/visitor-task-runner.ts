import { VISITOR_KNOWLEDGE_POLICY } from './visitor-knowledge-context';

export type VisitorTaskTool = { type: string; name: string; description: string; parameters: object };
export type VisitorTaskUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };
export type ToolResult = { data: unknown; silent?: boolean; directText?: string };
export type VisitorTaskOptions = {
  model: string; channel: 'chat' | 'voice';
  apiKey: string; instructions: string | (() => string); context: unknown; signal: AbortSignal;
  tools: readonly VisitorTaskTool[]; execute: (name: string, args: string, signal: AbortSignal) => Promise<ToolResult>;
  fetch?: typeof fetch; onUsage?: (usage: VisitorTaskUsage) => void; maxToolRounds?: number;
};
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** One bounded agent job. No automatic retries, parallel tools or hidden continuation. */
export async function runVisitorTask(options: VisitorTaskOptions): Promise<{ text: string; silent?: boolean }> {
  const request = options.fetch ?? fetch;
  const input: unknown[] = [{ role: 'user', content: JSON.stringify(options.context) }];
  const maxTools = options.maxToolRounds ?? 4;
  if (!Number.isInteger(maxTools) || maxTools < 0 || maxTools > 4) throw new Error('Invalid backend tool limit.');
  for (let round = 0; round <= maxTools; round++) {
    options.signal.throwIfAborted();
    const response = await request('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
      redirect: 'error', signal: options.signal,
      body: JSON.stringify({ model: options.model, store: false, reasoning: { effort: 'low' },
        instructions: `${VISITOR_KNOWLEDGE_POLICY}\n${typeof options.instructions === 'function' ? options.instructions() : options.instructions}\n${options.channel === 'voice' ? 'Transcripts may be incomplete or overlapping; use the latest user request and current application state. Return a concise, grounded answer (at most 75 words) for spoken delivery.' : 'Use the latest typed request, conversation and current application state. Return a concise, grounded answer for the website visitor.'} Never claim unconfirmed actions.`,
        include: ['reasoning.encrypted_content'],
        input, tools: round < maxTools ? options.tools.map(tool => ({ ...tool, strict: false })) : [],
        tool_choice: round < maxTools ? 'auto' : 'none', parallel_tool_calls: false, max_output_tokens: round === 0 ? 1200 : 500,
      }),
    });
    if (!response.ok) throw new Error(response.status === 429 ? 'The conversation backend is busy. Try again shortly.'
      : response.status >= 500 ? 'The conversation backend is temporarily unavailable.' : 'The conversation backend rejected the request.');
    const raw = await response.text();
    if (raw.length > 256_000) throw new Error('The conversation backend returned too much data.');
    const result = record(JSON.parse(raw));
    const usage = record(result.usage), measured: VisitorTaskUsage = {};
    for (const [source, target] of [['input_tokens', 'inputTokens'], ['output_tokens', 'outputTokens'], ['total_tokens', 'totalTokens']] as const) {
      const value = usage[source];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000) measured[target] = value;
    }
    if (Object.keys(measured).length) options.onUsage?.(measured);
    options.signal.throwIfAborted();
    if (result.status !== 'completed' || !Array.isArray(result.output)) throw new Error('The conversation backend did not finish.');
    const output = result.output.map(record);
    const calls = output.filter(item => item.type === 'function_call');
    if (!calls.length) {
      const text = output.filter(item => item.type === 'message').flatMap(item => Array.isArray(item.content) ? item.content.map(record) : [])
        .filter(part => part.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('');
      if (!text.trim()) throw new Error('The conversation backend returned no answer.');
      return { text: text.slice(0, 2000) };
    }
    if (calls.length !== 1 || round === maxTools) throw new Error('The conversation backend exceeded its tool limit.');
    const call = calls[0];
    if (typeof call.name !== 'string' || !options.tools.some(tool => tool.name === call.name)
      || typeof call.call_id !== 'string' || call.call_id.length > 200 || typeof call.arguments !== 'string' || call.arguments.length > 32_000) throw new Error('Invalid backend tool.');
    const tool = await options.execute(call.name, call.arguments, options.signal);
    options.signal.throwIfAborted();
    if (tool.silent) return { text: '', silent: true };
    if (tool.directText?.trim()) return { text: tool.directText.slice(0, 2000) };
    input.push(...output, { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(tool.data) });
  }
  throw new Error('The conversation backend exceeded its limit.');
}
