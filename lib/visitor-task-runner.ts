import { reserveVisitorQaRequest } from './visitor-qa-budget';
import { readVisitorResponse } from './visitor-response-stream';
import { VISITOR_KNOWLEDGE_POLICY } from './visitor-knowledge-context';
import type { VisitorResponseRequest } from './visitor-response-connection';
import { safeTestRecorder, type TestRecorder } from './visitor-test-events';
import { modelConnectionFailure, VisitorTaskConnectionError } from './visitor-task-error';
import { ANSWER_COMPOSITION_GUIDANCE } from './visitor-answer-composition';

export type VisitorTaskTool = { type: string; name: string; description: string; parameters: object };
export type VisitorTaskUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };
export type ToolResult = { data: unknown; silent?: boolean; directText?: string; /** Set only after the requested visual result is acknowledged. */ displaySatisfied?: boolean };
export type VisitorTaskOptions = {
  model: string; channel: 'chat' | 'voice';
  responseWordLimit?: number;
  apiKey: string; instructions: string | (() => string | Promise<string>); context: unknown; signal: AbortSignal;
  tools: readonly VisitorTaskTool[]; execute: (name: string, args: string, signal: AbortSignal) => Promise<ToolResult>;
  fetch?: typeof fetch; beforeModel?: () => Promise<void>; onUsage?: (usage: VisitorTaskUsage) => void | Promise<void>; maxToolRounds?: number;
  responseRequest?: VisitorResponseRequest;
  reasoningEffort?: 'none' | 'low';
  onAnswer?: (text: string, round: number) => void;
  record?: TestRecorder;
  qaSlug?: string;
  activeImage?: () => Promise<{ label: string; image_url: string } | undefined>;
  onModelTiming?: (stage: 'model' | 'model_output', status: 'started' | 'succeeded' | 'failed' | 'observed', durationMs: number) => void;
};
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** One bounded agent job. No automatic retries, parallel tools or hidden continuation. */
export async function runVisitorTask(options: VisitorTaskOptions): Promise<{ text: string; silent?: boolean; displaySatisfied?: boolean; answerPlacement?: 'supporting' }> {
  const observe = safeTestRecorder(options.record);
  try {
  const request = options.fetch ?? fetch;
  const currentContext = () => typeof options.context === 'function' ? options.context() : options.context;
  const input: unknown[] = [{ role: 'user', content: JSON.stringify(currentContext()) }];
  let displaySatisfied: true | undefined;
  const canPresentAnswer = options.tools.some(tool => tool.name === 'present_answer');
  const maxTools = options.maxToolRounds ?? 4;
  const wordLimit = options.responseWordLimit ?? (options.channel === 'voice' ? 75 : 200);
  if (!Number.isInteger(wordLimit) || wordLimit < 20 || wordLimit > 300) throw new Error('Invalid response length preference.');
  if (!Number.isInteger(maxTools) || maxTools < 0 || maxTools > 4) throw new Error('Invalid backend tool limit.');
  for (let round = 0; round <= maxTools; round++) {
    options.signal.throwIfAborted();
    await options.beforeModel?.();
    options.signal.throwIfAborted();
    const instructions = typeof options.instructions === 'function' ? await options.instructions() : options.instructions;
    const image = await options.activeImage?.();
    input[0] = { role: 'user', content: image ? [{ type: 'input_text', text: JSON.stringify(currentContext()) }, { type: 'input_text', text: image.label }, { type: 'input_image', image_url: image.image_url, detail: 'low' }] : JSON.stringify(currentContext()) };
    options.signal.throwIfAborted();
    const started = performance.now();
    options.onModelTiming?.('model', 'started', 0);
    const body = { model: options.model, store: false, reasoning: { effort: options.reasoningEffort ?? 'low' },
      // Model instructions: wrap each task round with shared evidence rules and channel-specific answer limits.
      instructions: `${VISITOR_KNOWLEDGE_POLICY}\n${instructions}\n${canPresentAnswer ? `${ANSWER_COMPOSITION_GUIDANCE}\nDisplay for this request: ${displaySatisfied ? 'confirmed' : 'not yet confirmed'}. Tool steps remaining: ${maxTools - round}.\n` : ''}${options.channel === 'voice' ? 'Transcripts may be incomplete or overlapping; use the latest user request and current application state. Return a grounded answer for spoken delivery.' : 'Use the latest typed request, conversation and current application state. Return a grounded answer for the website visitor.'} Aim for at most ${wordLimit} words, preserving necessary qualifications and explicit visitor requests for detail. Never claim unconfirmed actions.`,
      include: ['reasoning.encrypted_content'],
      input, tools: round < maxTools ? options.tools.map(tool => ({ ...tool, strict: false })) : [],
      // Tool follow-ups need room for both processing tokens and the qualified
      // answer. Shrinking to 500 cut off valid replies after a confirmed view.
      tool_choice: round < maxTools ? 'auto' : 'none', parallel_tool_calls: false, max_output_tokens: 1200,
    };
    observe({ type: 'model.request', data: { channel: options.channel, round, body } });
    let result: Record<string, unknown>, firstOutput = false, provisional = '';
    const answerItems = new Set<string>();
    const event = (event: Record<string, unknown>) => {
      options.signal.throwIfAborted();
      if (!firstOutput && ['response.output_text.delta', 'response.function_call_arguments.delta'].includes(String(event.type))) {
        firstOutput = true; options.onModelTiming?.('model_output', 'observed', performance.now() - started);
      }
      const item = record(event.item);
      if (event.type === 'response.output_item.added' && item.type === 'message' && item.role === 'assistant' && (item.phase === 'final_answer' || round === maxTools) && typeof item.id === 'string') answerItems.add(item.id);
      if (options.channel === 'chat' && event.type === 'response.output_text.delta' && typeof event.item_id === 'string' && answerItems.has(event.item_id) && typeof event.delta === 'string') {
        provisional = (provisional + event.delta).slice(0, 2000);
        if (!/^\s*[\[{]/.test(provisional)) options.onAnswer?.(provisional, round);
      }
    };
    const qaBudget = await reserveVisitorQaRequest(body, { slug: options.qaSlug, record: observe });
    options.signal.throwIfAborted();
    try {
      if (options.responseRequest) result = await options.responseRequest(body, options.signal, undefined, event);
      else {
        const response = await request('https://api.openai.com/v1/responses', {
          method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
          redirect: 'error', signal: options.signal, body: JSON.stringify({ ...body, stream: true }),
        });
        if (!response.ok) throw Object.assign(new Error(response.status === 429 ? 'The conversation backend is busy. Try again shortly.'
          : response.status >= 500 ? 'The conversation backend is temporarily unavailable.' : 'The conversation backend rejected the request.'), { status: response.status });
        result = await readVisitorResponse(response, options.signal, event);
      }
    } catch (error) {
      options.signal.throwIfAborted();
      options.onModelTiming?.('model', 'failed', performance.now() - started);
      if (modelConnectionFailure(error)) throw new VisitorTaskConnectionError(error);
      throw error;
    }
    await qaBudget?.settle(result);
    observe({ type: 'model.response', data: { channel: options.channel, round, durationMs: performance.now() - started, result } });
    options.onModelTiming?.('model', result.status === 'completed' ? 'succeeded' : 'failed', performance.now() - started);
    const usage = record(result.usage), measured: VisitorTaskUsage = {};
    for (const [source, target] of [['input_tokens', 'inputTokens'], ['output_tokens', 'outputTokens'], ['total_tokens', 'totalTokens']] as const) {
      const value = usage[source];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000) measured[target] = value;
    }
    if (Object.keys(measured).length) await options.onUsage?.(measured);
    options.signal.throwIfAborted();
    if (provisional) options.onAnswer?.('', round);
    if (result.status !== 'completed' || !Array.isArray(result.output)) throw new Error('The conversation backend did not finish.');
    const output = result.output.map(record);
    const calls = output.filter(item => item.type === 'function_call');
    if (!calls.length) {
      const text = output.filter(item => item.type === 'message').flatMap(item => Array.isArray(item.content) ? item.content.map(record) : [])
        .filter(part => part.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('');
      if (!text.trim()) throw new Error('The conversation backend returned no answer.');
      // Ordinary final text may contain a calculation or other essential answer,
      // even after a tool displayed records. Keep it visible without a new panel.
      return { text: text.slice(0, 2000), displaySatisfied, ...(displaySatisfied ? { answerPlacement: 'supporting' as const } : {}) };
    }
    if (calls.length !== 1 || round === maxTools) throw new Error('The conversation backend exceeded its tool limit.');
    const call = calls[0];
    if (typeof call.name !== 'string' || !options.tools.some(tool => tool.name === call.name)
      || typeof call.call_id !== 'string' || call.call_id.length > 200 || typeof call.arguments !== 'string' || call.arguments.length > 32_000) throw new Error('Invalid backend tool.');
    observe({ type: 'tool.request', data: { round, callId: call.call_id, name: call.name, arguments: call.arguments } });
    const toolStarted = performance.now();
    const tool = await options.execute(call.name, call.arguments, options.signal);
    observe({ type: 'tool.result', data: { round, callId: call.call_id, name: call.name, result: tool, durationMs: performance.now() - toolStarted } });
    options.signal.throwIfAborted();
    if (tool.displaySatisfied === true) displaySatisfied = true;
    if (tool.silent) return { text: '', silent: true, displaySatisfied };
    if (tool.directText?.trim()) return { text: tool.directText.slice(0, 2000), displaySatisfied };
    input.push(...output, { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(tool.data) });
  }
  throw new Error('The conversation backend exceeded its limit.');
  } catch (error) { observe({ type: options.signal.aborted ? 'task.cancelled' : 'task.failed', data: { error, reason: options.signal.reason } }); throw error; }
}
