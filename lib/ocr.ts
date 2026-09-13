import { spawn } from 'node:child_process';
import { AppError } from './errors';
import { z } from 'zod';

export type OcrProvider = { extract(bytes: Uint8Array, mime: string, signal?: AbortSignal): Promise<string> };

type HttpOcrProviderOptions = { endpoint: string; token?: string; fetcher?: typeof fetch; timeoutMs?: number };

function ocrEndpoint(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError('The configured OCR endpoint is invalid.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new AppError('The configured OCR endpoint must be an HTTP(S) URL without credentials.');
  if (url.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) throw new AppError('Remote OCR workers require HTTPS. HTTP is allowed only for an explicitly configured loopback worker.');
  return url;
}

async function boundedResponseText(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > maxBytes) throw new AppError('The OCR provider returned an oversized response.');
  if (!response.body) {
    const text = await response.text(); if (Buffer.byteLength(text) > maxBytes) throw new AppError('The OCR provider returned an oversized response.'); return text;
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      total += next.value.byteLength; if (total > maxBytes) throw new AppError('The OCR provider returned an oversized response.'); chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * Production-facing adapter for a managed OCR worker. The worker endpoint and
 * optional bearer token are supplied by server configuration; no provider is
 * contacted unless this adapter is explicitly configured. The image is sent as
 * bounded JSON and formula/source data never becomes executable input.
 */
export function createHttpOcrProvider(options: HttpOcrProviderOptions): OcrProvider {
  const endpoint = ocrEndpoint(options.endpoint).toString(); const fetcher = options.fetcher ?? fetch; const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 30_000, 1_000), 60_000);
  return { async extract(bytes, mime, signal) {
    if (!/^image\/(?:png|jpeg|webp|tiff)$/.test(mime)) throw new AppError('OCR currently accepts PNG, JPEG, WebP or TIFF images.');
    if (bytes.byteLength > 10 * 1024 * 1024) throw new AppError('OCR input exceeds the image size limit.');
    if (signal?.aborted) throw new AppError('OCR was cancelled.');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    try {
      let response: Response;
      try {
        response = await fetcher(endpoint, { method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
          body: JSON.stringify({ mime, imageBase64: Buffer.from(bytes).toString('base64') }) });
      } catch { throw new AppError(controller.signal.aborted ? 'OCR timed out or was cancelled.' : 'The OCR provider could not be reached.'); }
      if (!response.ok) throw new AppError('The OCR provider could not read this image.');
      let responseText: string;
      try { responseText = await boundedResponseText(response, 250_000); } catch (error) { if (error instanceof AppError) throw error; throw new AppError('The OCR provider returned an invalid response.'); }
      let payload: unknown;
      try { payload = JSON.parse(responseText); } catch { throw new AppError('The OCR provider returned an invalid response.'); }
      const parsed = z.object({ text: z.string().trim().min(1).max(60_000), complete: z.literal(true) }).strict().safeParse(payload);
      if (!parsed.success) throw new AppError('The OCR worker returned incomplete, empty, oversized or invalid text. Nothing was interpreted.');
      return parsed.data.text;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  } };
}

/** Select a configured managed worker, otherwise retain the deterministic local fallback. */
export function configuredOcrProvider(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): OcrProvider {
  const endpoint = env.VOICE_OCR_ENDPOINT?.trim();
  return endpoint && env.VOICE_AI_MODE !== 'demo' ? createHttpOcrProvider({ endpoint, token: env.VOICE_OCR_TOKEN?.trim() || undefined, fetcher }) : localTesseractProvider;
}

/**
 * Optional local OCR adapter. Tesseract is deliberately invoked only through a
 * fixed executable name; callers can inject a provider in tests or a managed
 * worker in production. This local adapter never sends an image over a network.
 */
export const localTesseractProvider: OcrProvider = {
  extract(bytes, mime, signal) {
    if (!/^image\/(?:png|jpeg|webp|tiff)$/.test(mime)) throw new AppError('OCR currently accepts PNG, JPEG, WebP or TIFF images.');
    if (signal?.aborted) return Promise.reject(new AppError('OCR was cancelled.'));
    return new Promise((resolve, reject) => {
      const child = spawn('tesseract', ['stdin', 'stdout', '--dpi', '300'], { stdio: ['pipe', 'pipe', 'pipe'] });
      const output: Buffer[] = []; let hadErrorOutput = false; let size = 0; let settled = false;
      const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); if (error) reject(error); else {
        const text = Buffer.concat(output).toString('utf8').trim(); if (!text) reject(new AppError('OCR did not find readable text in this image.')); else if (text.length > 60_000) reject(new AppError('OCR exceeded 60,000 characters. Nothing was truncated or interpreted.')); else resolve(text);
      } };
      const abort = () => { child.kill('SIGKILL'); finish(new AppError('OCR was cancelled.')); };
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new AppError('OCR timed out after 30 seconds.')); }, 30_000);
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', chunk => { size += chunk.length; if (size > 250_000) { child.kill('SIGKILL'); finish(new AppError('OCR output exceeded the source limit.')); } else output.push(chunk); });
      child.stderr.on('data', () => { hadErrorOutput = true; });
      child.on('error', error => finish((error as NodeJS.ErrnoException).code === 'ENOENT' ? new AppError('OCR is unavailable on this server. Install Tesseract or configure an OCR provider.') : new AppError('OCR could not start.')));
      child.on('close', code => code === 0 ? finish() : finish(new AppError(hadErrorOutput ? 'OCR could not read this image.' : 'OCR exited before producing text.')));
      child.stdin.on('error', () => undefined); child.stdin.end(Buffer.from(bytes));
    });
  },
};

export async function extractOcrText(bytes: Uint8Array, mime: string, provider: OcrProvider = configuredOcrProvider(), signal?: AbortSignal) {
  const text = await provider.extract(bytes, mime, signal);
  if (!text.trim() || text.length > 60_000) throw new AppError('OCR returned an empty or oversized source.');
  return text.trim();
}
