import { ZodError } from 'zod';
import { AppError } from './errors';

export function assertLocal(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get('host') || url.host;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) throw new AppError('This prototype is available on localhost only.', 403);
  const origin = request.headers.get('origin');
  if (origin && origin !== `${url.protocol}//${host}`) throw new AppError('Cross-origin requests are not allowed.', 403);
}

export async function readJson(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('Expected JSON.', 415);
  const text = await readLimitedBody(request, 64 * 1024);
  try { return JSON.parse(new TextDecoder().decode(text)); } catch { throw new AppError('Invalid JSON.'); }
}

export async function readLimitedBody(request: Request, maximum: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('A request body is required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) { await reader.cancel(); throw new AppError('File or request is too large.', 413); }
    chunks.push(value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function respond(operation: () => Promise<unknown>) {
  try { return Response.json(await operation(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) {
    const status = error instanceof AppError ? error.status : error instanceof ZodError ? 400 : 500;
    const message = error instanceof AppError ? error.message : error instanceof ZodError ? (error.issues[0]?.message || 'Check the supplied values.') : 'Could not save your workspace. Please try again.';
    return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
