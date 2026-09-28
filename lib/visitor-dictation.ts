import 'server-only';
import { z } from 'zod';
import { AppError } from './errors';
import { readLimitedBody } from './http';
import { PCM_RATE, MAX_PCM_BYTES, type VisitorAvailability } from './visitor-model';
import { visitorAccess } from './visitor-store';
import { VisitorAttemptError, VisitorLimitError } from './visitor-quota';
import { assertNoStripeTestPaidAi } from './billing-ai-guard';
import { recordPlatformEvent } from './platform-events';
import { measuredUsage, type ProviderUsage } from './provider-usage';
import { reserveVisitorQaDictation } from './visitor-qa-budget';
import type { TestRecorder } from './visitor-test-events';

export const visitorDictationSchema = z.object({ requestId: z.string().uuid(), audio: z.string().min(1).max(Math.ceil(MAX_PCM_BYTES / 3) * 4) }).strict();
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function dictationPcm(audio: string) {
  if (audio.length > Math.ceil(MAX_PCM_BYTES / 3) * 4 || audio.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) throw new AppError('The recording format is invalid. Record again or type your message.');
  const pcm = Buffer.from(audio, 'base64');
  if (pcm.length < 9600 || pcm.length > MAX_PCM_BYTES || pcm.length % 2 || pcm.toString('base64') !== audio) throw new AppError('Record between 0.2 and 20 seconds of audio.');
  return pcm;
}

function wav(pcm: Buffer) {
  const data = Buffer.alloc(44 + pcm.length);
  data.write('RIFF', 0); data.writeUInt32LE(36 + pcm.length, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(PCM_RATE, 24); data.writeUInt32LE(PCM_RATE * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(pcm.length, 40); pcm.copy(data, 44);
  return data;
}

function transcriptionUsage(value: unknown): ProviderUsage | undefined {
  const usage = object(value);
  if (usage.type === 'duration' && typeof usage.seconds === 'number' && Number.isFinite(usage.seconds) && usage.seconds >= 0 && usage.seconds <= 3600) return { voiceSeconds: usage.seconds, finalized: true };
  return measuredUsage(value);
}

type ProviderOptions = { slug?: string; record?: TestRecorder; apiKey?: string; fetch?: typeof fetch; reserve?: typeof reserveVisitorQaDictation };
export async function transcribeVisitorDictation(pcm: Buffer, signal: AbortSignal, options: ProviderOptions = {}) {
  if (pcm.length < 9600 || pcm.length > MAX_PCM_BYTES || pcm.length % 2) throw new AppError('Record between 0.2 and 20 seconds of audio.');
  if (signal.aborted) throw new AppError('Dictation cancelled.', 499);
  const key = options.apiKey ?? process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new AppError('Dictation is temporarily unavailable. Type your message instead.', 503);
  const reservation = await (options.reserve ?? reserveVisitorQaDictation)(pcm.length, { slug: options.slug, record: options.record });
  if (signal.aborted) throw new AppError('Dictation cancelled.', 499);
  const timeout = AbortSignal.timeout(20_000), combined = AbortSignal.any([signal, timeout]);
  const startedAt = performance.now();
  const form = new FormData();
  form.set('model', 'gpt-transcribe'); form.set('response_format', 'json');
  form.set('file', new Blob([new Uint8Array(wav(pcm))], { type: 'audio/wav' }), 'dictation.wav');
  options.record?.({ type: 'dictation.provider.started', data: { model: 'gpt-transcribe', pcmBytes: pcm.length, audioDurationMs: Math.round(pcm.length / (PCM_RATE * 2) * 1000) } });
  try {
    const response = await (options.fetch ?? fetch)('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: combined, redirect: 'error',
    });
    if (!response.ok) throw new AppError('Dictation could not finish. Try again or type your message.', 502);
    const payload = object(JSON.parse(new TextDecoder().decode(await readLimitedBody(response, 64_000))));
    await reservation?.settle(payload);
    if (combined.aborted) throw combined.reason;
    if (typeof payload.text !== 'string' || payload.text.length > 2000) throw new AppError('Dictation returned an invalid transcript. Try a shorter recording or type your message.', 502);
    const text = payload.text.trim();
    if (!text) throw new AppError('No speech was recognized. Try again or type your message.', 422);
    const usage = transcriptionUsage(payload.usage);
    options.record?.({ type: 'dictation.provider.completed', data: { characters: text.length, durationMs: Math.round(performance.now() - startedAt), ...(usage ? { usage } : {}) } });
    return { text, usage };
  } catch (error) {
    options.record?.({ type: 'dictation.provider.failed', data: { durationMs: Math.round(performance.now() - startedAt), cancelled: signal.aborted, timedOut: timeout.aborted } });
    if (signal.aborted) throw new AppError('Dictation cancelled.', 499);
    if (timeout.aborted) throw new AppError('Dictation took too long. Try again or type your message.', 504);
    throw error instanceof AppError ? error : new AppError('Dictation is temporarily unavailable. Type your message instead.', 502);
  }
}

function assertAvailable(state: VisitorAvailability) {
  if (!state.enabled) throw new AppError('This site has not enabled visitor conversations.', 403);
  if (!state.live) throw new AppError('Recorded dictation is unavailable in the demo preview. Type your message instead.', 503);
  if (!state.chatRemaining) throw new VisitorLimitError('Chat has reached its daily limit. Please return after the daily reset.', state);
}

type DictationDependencies = { access?: typeof visitorAccess; billingGuard?: typeof assertNoStripeTestPaidAi; transcribe?: typeof transcribeVisitorDictation; observe?: typeof recordPlatformEvent };
export async function visitorDictation(slug: string, input: z.infer<typeof visitorDictationSchema>, signal: AbortSignal, record?: TestRecorder, dependencies: DictationDependencies = {}) {
  const pcm = dictationPcm(input.audio), access = dependencies.access ?? visitorAccess, billingGuard = dependencies.billingGuard ?? assertNoStripeTestPaidAi;
  const observe = dependencies.observe ?? recordPlatformEvent;
  record?.({ type: 'dictation.received', data: { pcmBytes: pcm.length, audioDurationMs: Math.round(pcm.length / (PCM_RATE * 2) * 1000) } });
  if (signal.aborted) throw new AppError('Dictation cancelled.', 499);
  const preview = await access(slug);
  assertAvailable(preview.availability);
  await billingGuard(preview.siteId);
  if (signal.aborted) throw new AppError('Dictation cancelled.', 499);
  const reserved = await access(slug, { requestId: input.requestId, kind: 'dictation' });
  const matches = (current: Awaited<ReturnType<typeof visitorAccess>>) => {
    if (current.siteId !== preview.siteId || JSON.stringify(current.content) !== JSON.stringify(preview.content)) throw new AppError('The publication changed. Reload before recording again.', 409);
    assertAvailable(current.availability);
  };
  const observed = { surface: 'public' as const, requestId: input.requestId, kind: 'voice' as const, operationId: 'dictation' };
  try {
    matches(reserved);
    if (signal.aborted) throw new AppError('Dictation cancelled.', 499);
    const reply = await (dependencies.transcribe ?? transcribeVisitorDictation)(pcm, signal, { slug, record });
    await observe(preview.siteId, { ...observed, type: 'provider_usage', status: reply.usage ? 'confirmed' : 'unknown', count: 1, ...(reply.usage ? { usage: reply.usage } : {}) }).catch(() => undefined);
    if (signal.aborted) throw new AppError('Dictation cancelled.', 499);
    const current = await access(slug);
    matches(current);
    await billingGuard(preview.siteId);
    if (signal.aborted) throw new AppError('Dictation cancelled.', 499);
    return { text: reply.text, availability: current.availability };
  } catch (error) {
    throw new VisitorAttemptError(error instanceof AppError ? error.message : 'Dictation could not finish. Type your message instead.', reserved.availability,
      error instanceof AppError ? error.status : signal.aborted ? 499 : 502);
  }
}
