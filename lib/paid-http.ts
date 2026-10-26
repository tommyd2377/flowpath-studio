import { createHash, randomBytes } from 'node:crypto';
export const PAID_VISITOR_COOKIE = 'flowpath_paid_visitor';
export function paidVisitor(request: Request) {
  const matches = (request.headers.get('cookie') ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${PAID_VISITOR_COOKIE}=`));
  const token = matches.length === 1 ? matches[0].slice(PAID_VISITOR_COOKIE.length + 1) : '';
  return /^[a-f0-9]{64}$/.test(token) ? `anonymous:${createHash('sha256').update(token).digest('hex')}` : null;
}
export function issuePaidVisitor(secure: boolean) {
  const token = randomBytes(32).toString('hex');
  return { visitorId: `anonymous:${createHash('sha256').update(token).digest('hex')}`,
    cookie: `${PAID_VISITOR_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}` };
}
export async function boundedText(request: Request, limit: number) {
  if (!request.body || Number(request.headers.get('content-length') ?? 0) > limit) throw new Error('Invalid body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 5_000);
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > limit) throw new Error('Body too large'); chunks.push(value); }
    if (timedOut || request.signal.aborted) throw new Error('Request ended');
    return Buffer.concat(chunks).toString('utf8');
  } finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); }
}
export async function paidJson(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new Error('JSON required');
  const result = JSON.parse(await boundedText(request, 8192));
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid JSON');
  return result as Record<string, unknown>;
}
export const paidResponse = (body: object, status = 200, headers?: HeadersInit) => Response.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', ...headers },
});
