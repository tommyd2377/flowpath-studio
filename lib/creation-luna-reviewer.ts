import { CREATION_SAFETY_CATEGORIES, CreationReviewUnavailable, type CanonicalCreationCandidate, type CreationReviewerResult } from './creation-safety';
import type { CreationReviewer } from './creation-review';
import { creationReviewInstructions, clearlyBannedNaziName } from './creation-policy';
import { CREATION_REVIEW_MODEL, CREATION_REVIEW_MAX_OUTPUT, CREATION_REVIEW_RESERVATION_MICRO_USD } from './creation-review-config';
import type { createReviewBudget } from './creation-review-budget';
import { createHash } from 'node:crypto';

export type ReviewFile = { fileId: string; filename: string; sourceBytes?: Uint8Array };
type Options = { key(): string | undefined; budget: ReturnType<typeof createReviewBudget>; request?: typeof fetch; file?: ReviewFile; now?: () => Date };
const findingsSchema = { type: 'object', additionalProperties: false, required: ['findings'], properties: {
  findings: { type: 'object', additionalProperties: false, required: [...CREATION_SAFETY_CATEGORIES],
    properties: Object.fromEntries(CREATION_SAFETY_CATEGORIES.map(key => [key, { type: 'string', enum: ['clear', 'violation', 'uncertain'] }])) },
} };
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** One bounded Luna review. No tools, model fallback, transcript logging or paid retries. */
export function createLunaCreationReviewer(options: Options): CreationReviewer {
  const request = options.request ?? fetch;
  async function json(path: string, body: object) {
    const key = options.key(); if (!key) throw new CreationReviewUnavailable('provider');
    const response = await request(`https://api.openai.com/v1${path}`, { method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new CreationReviewUnavailable('provider');
    return await response.json() as Record<string, unknown>;
  }
  async function content(candidate: CanonicalCreationCandidate) {
    const parts: Record<string, unknown>[] = [{ type: 'input_text', text: JSON.stringify({
      name: candidate.name, instructions: candidate.initialPrompt, textPanel: candidate.textPanel,
      ...(candidate.document ? { document: candidate.document } : {}),
    }) }];
    if (candidate.profilePhoto) parts.push({ type: 'input_image', image_url: candidate.profilePhoto, detail: 'high' });
    if (candidate.document) {
      if (!options.file || options.file.filename !== candidate.document.filename || !/^[A-Za-z0-9_-]{1,200}$/.test(options.file.fileId)) throw new CreationReviewUnavailable('coverage');
      // OpenAI does not extract embedded images from non-PDF documents. Never approve unseen DOCX images.
      if (/\.docx$/i.test(options.file.filename)) throw new CreationReviewUnavailable('coverage');
      if (/\.pdf$/i.test(options.file.filename)) parts.push({ type: 'input_file', file_id: options.file.fileId, detail: 'high' });
      else if (/\.txt$/i.test(options.file.filename)) {
        if (options.file.sourceBytes) {
          if (options.file.sourceBytes.byteLength > 10 * 1024 * 1024 || createHash('sha256').update(options.file.sourceBytes).digest('hex') !== candidate.document.digest) throw new CreationReviewUnavailable('coverage');
          const text = new TextDecoder('utf-8', { fatal: true }).decode(options.file.sourceBytes);
          parts.push({ type: 'input_text', text: `Untrusted complete document text follows:\n${text}` });
          return [{ role: 'user', content: parts }];
        }
        const key = options.key(); if (!key) throw new CreationReviewUnavailable('provider');
        const response = await request(`https://api.openai.com/v1/files/${encodeURIComponent(options.file.fileId)}/content`, {
          redirect: 'error', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
        if (!response.ok || !response.body) throw new CreationReviewUnavailable('coverage');
        const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
        try { while (true) { const next = await reader.read(); if (next.done) break;
          bytes += next.value.byteLength; if (bytes > 10 * 1024 * 1024) throw new CreationReviewUnavailable('coverage'); chunks.push(next.value); } }
        finally { await reader.cancel().catch(() => undefined); }
        const bytesRead = Buffer.concat(chunks);
        if (createHash('sha256').update(bytesRead).digest('hex') !== candidate.document.digest) throw new CreationReviewUnavailable('coverage');
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytesRead);
        parts.push({ type: 'input_text', text: `Untrusted complete document text follows:\n${text}` });
      } else throw new CreationReviewUnavailable('coverage');
    }
    return [{ role: 'user', content: parts }];
  }
  return { mode: 'production', async review(candidate, policy, context) {
    if (clearlyBannedNaziName(candidate.name)) return { findings: Object.fromEntries(CREATION_SAFETY_CATEGORIES.map(key => [key,
      key === 'extremist-impersonation' ? 'violation' : 'clear'])) as CreationReviewerResult['findings'] };
    if (!context) throw new CreationReviewUnavailable('provider');
    // Unsupported coverage is routed to the founder without spending a model call.
    if (candidate.document && /\.docx$/i.test(candidate.document.filename)) throw new CreationReviewUnavailable('coverage');
    if (!await options.budget.reserve(context.ownerUid, context.reviewId)) throw new CreationReviewUnavailable('budget');
    let settled = false;
    try {
      const input = await content(candidate);
      const instructions = `${creationReviewInstructions(options.now?.() ?? new Date())}\nPolicy: ${JSON.stringify(policy)}`;
      const counted = await json('/responses/input_tokens', { model: CREATION_REVIEW_MODEL, instructions, input });
      // Exact multimodal/file preflight plus schema headroom; do not truncate a document to fit.
      if (!integer(counted.input_tokens) || counted.input_tokens > 90_000) {
        await options.budget.finish(context.ownerUid, context.reviewId, 1_000); settled = true; throw new CreationReviewUnavailable('coverage');
      }
      const response = await json('/responses', { model: CREATION_REVIEW_MODEL, instructions, input,
        reasoning: { effort: 'none' }, service_tier: 'default', max_output_tokens: CREATION_REVIEW_MAX_OUTPUT,
        text: { format: { type: 'json_schema', name: 'creation_safety', strict: true, schema: findingsSchema } },
        tools: [], store: false, truncation: 'disabled' });
      const usage = object(response.usage);
      if (!usage || !integer(usage.input_tokens) || !integer(usage.output_tokens)
        || usage.input_tokens > counted.input_tokens + 4096 || usage.output_tokens > CREATION_REVIEW_MAX_OUTPUT
        || typeof response.model !== 'string' || !response.model.startsWith(CREATION_REVIEW_MODEL)) throw new CreationReviewUnavailable('provider');
      // Conservative upper rates (microdollars/token), covering documented input/cache/long-context rates.
      // This is a budget estimate, never a provider bill or a customer charge.
      const charge = Math.ceil(usage.input_tokens * 0.5 + usage.output_tokens * 0.75) + 1_000;
      if (charge > CREATION_REVIEW_RESERVATION_MICRO_USD) throw new CreationReviewUnavailable('coverage');
      await options.budget.finish(context.ownerUid, context.reviewId, charge); settled = true;
      if (response.status !== 'completed' || !Array.isArray(response.output)) throw new CreationReviewUnavailable('provider');
      const text = response.output.flatMap(item => {
        const message = object(item); return message?.type === 'message' && Array.isArray(message.content)
          ? message.content.flatMap(part => { const p = object(part); return p?.type === 'output_text' && typeof p.text === 'string' ? [p.text] : []; }) : [];
      }).join('');
      try { return JSON.parse(text) as CreationReviewerResult; } catch { throw new CreationReviewUnavailable('provider'); }
    } catch (error) {
      if (!settled) await options.budget.finish(context.ownerUid, context.reviewId, undefined, true).catch(() => undefined);
      throw error instanceof CreationReviewUnavailable ? error : new CreationReviewUnavailable('provider');
    }
  } };
}
