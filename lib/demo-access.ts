import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { VoiceDatabase } from './production-voice-store';
import { isAllowedRequest } from './request-origin';
import { readBody } from './account-server';

const ACCESS_COOKIE = '__Host-flowpath_demo_access';
const ATTEMPT_COOKIE = '__Host-flowpath_demo_attempt';
const GRANT_MS = 24 * 60 * 60 * 1000;
export const demoAccessHash = (value: string) => createHash('sha256').update(value).digest('hex');
// Server-only verification digest. The shared value never enters the client bundle.
const CODE_DIGEST = '63fd0648bc9994c3f86cbe9aa0179525d5f2fd2d6c576234404cf1e27811cbed';
function token(request: Request, name: string) {
  const matching = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  const value = matching.length === 1 ? matching[0].slice(name.length + 1) : '';
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export const demoGrantId = (request: Request) => { const value = token(request, ACCESS_COOKIE); return value ? demoAccessHash(value) : undefined; };
export const validDemoGrant = (row: Record<string, unknown> | null, now: number) => row?.state === 'active'
  && typeof row.expiresAt === 'number' && Number.isSafeInteger(row.expiresAt) && row.expiresAt > now;
const cookie = (name: string, value: string, seconds: number) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
const json = (value: object, status = 200, headers?: HeadersInit) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });

/** Temporary shared-code access; never grants account membership, ownership or extra voice time. */
export function createDemoAccess(database: VoiceDatabase, options: { enabled(): boolean; publicOrigin?: string; trustedProxyHost?: string;
  now?: () => number; codeDigest?: string }) {
  const now = options.now ?? Date.now;
  const allowedHost = (request: Request) => isAllowedRequest(request, request.method !== 'GET', options.publicOrigin, options.trustedProxyHost);
  async function allowed(request: Request) {
    if (!options.enabled()) return true;
    const id = demoGrantId(request);
    return !!id && database.transaction(async tx => validDemoGrant(await tx.get(`voiceDemoAccess/${id}`), now()));
  }
  return {
    allowed,
    async GET(request: Request) {
      if (!allowedHost(request)) return json({ error: 'Only requests from this application are allowed.' }, 403);
      if (!options.enabled()) return json({ enabled: false });
      const accepted = await allowed(request);
      const challenge = token(request, ATTEMPT_COOKIE) ?? randomBytes(32).toString('hex');
      return json({ enabled: true, allowed: accepted }, 200, { 'Set-Cookie': cookie(ATTEMPT_COOKIE, challenge, 1800) });
    },
    async POST(request: Request) {
      if (!allowedHost(request)) return json({ error: 'Only same-origin requests are allowed.' }, 403);
      if (!options.enabled()) return json({ error: 'Demo access is unavailable.' }, 503);
      const challenge = token(request, ATTEMPT_COOKIE);
      if (!challenge) return json({ error: 'Refresh this page before entering the demo code.' }, 400);
      let body: Record<string, unknown>;
      try { body = await readBody(request, 256) as Record<string, unknown>; } catch { return json({ error: 'Enter a valid demo code.' }, 400); }
      if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 || typeof body.code !== 'string' || body.code.length > 80) return json({ error: 'Enter a valid demo code.' }, 400);
      const actual = Buffer.from(demoAccessHash(body.code), 'hex'), expected = Buffer.from(options.codeDigest ?? CODE_DIGEST, 'hex');
      const valid = actual.length === expected.length && timingSafeEqual(actual, expected);
      const grant = randomBytes(32).toString('hex');
      const result = await database.transaction(async tx => {
        const path = `voiceDemoAttempts/${demoAccessHash(challenge)}`;
        const [own, global] = await Promise.all([tx.get(path), tx.get('voiceDemoAttempts/global')]);
        const used = (row: Record<string, unknown> | null, windowMs: number) => {
          if (!row || typeof row.since === 'number' && now() - row.since >= windowMs) return 0;
          if (!Number.isSafeInteger(row.count) || Number(row.count) < 0 || !Number.isSafeInteger(row.since)) throw new Error('Invalid demo throttle');
          return Number(row.count);
        };
        const a = used(own, 600_000), b = used(global, 60_000);
        if (a >= 6 || b >= 60) return 429;
        tx.set(path, { since: a ? own!.since : now(), count: a + 1 });
        tx.set('voiceDemoAttempts/global', { since: b ? global!.since : now(), count: b + 1 });
        if (valid) tx.set(`voiceDemoAccess/${demoAccessHash(grant)}`, { state: 'active', expiresAt: now() + GRANT_MS });
        return valid ? 200 : 403;
      });
      if (result === 429) return json({ error: 'Too many code attempts. Please wait before trying again.' }, 429, { 'Retry-After': '600' });
      return result === 200 ? json({ allowed: true }, 200, { 'Set-Cookie': cookie(ACCESS_COOKIE, grant, GRANT_MS / 1000) }) : json({ error: 'That demo code is incorrect.' }, 403);
    },
  };
}
