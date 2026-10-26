import { createHash, randomBytes } from 'node:crypto';
import { isAllowedRequest } from './request-origin';

export const PUBLIC_VOICE_SECONDS = 180;
export const PUBLIC_WAVEFORM_ID = '00000000-0000-4000-8000-000000000000';
export const PUBLIC_VOICE_COOKIE = '__Host-flowpath_demo';
export type PublicVoiceOwner = {
  kind: 'visitor'; ownerUid: string; waveformId: string; accountSessionId: string;
};
const validToken = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const cookieName = (value: string) => value.slice(0, value.includes('=') ? value.indexOf('=') : value.length).trim();
function publicDemoId(request: Request): string | null | undefined {
  const value = request.headers.get('X-FlowPath-Demo');
  if (value === null) return undefined;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase() : null;
}

/** A page-scoped browser identifier for public limits; it grants no account access. */
export function publicVoiceOwner(request: Request): PublicVoiceOwner | null {
  const demoId = publicDemoId(request);
  if (demoId === null) return null;
  const cookies = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim());
  const matching = cookies.filter(value => cookieName(value) === PUBLIC_VOICE_COOKIE);
  if (matching.length !== 1) return null;
  const token = matching[0].slice(matching[0].indexOf('=') + 1);
  if (!validToken(token)) return null;
  // Missing page IDs retain the old identity so already-open clients can close safely.
  const accountSessionId = createHash('sha256').update(demoId ? `${token}:${demoId}` : token).digest('hex');
  return { kind: 'visitor', ownerUid: `visitor:${accountSessionId}`, waveformId: PUBLIC_WAVEFORM_ID, accountSessionId };
}

export function isPublicVoiceOwner(value: unknown): value is PublicVoiceOwner {
  if (!value || typeof value !== 'object') return false;
  const owner = value as Record<string, unknown>;
  return owner.kind === 'visitor' && validToken(owner.accountSessionId)
    && owner.ownerUid === `visitor:${owner.accountSessionId}` && owner.waveformId === PUBLIC_WAVEFORM_ID;
}

/** Mint only on an allowed public readiness GET, never during paid creation. */
export async function withPublicVoiceVisitor(request: Request, handler: (request: Request) => Promise<Response>, options: {
  enabled: boolean; local?: boolean; publicOrigin?: string; trustedProxyHost?: string;
}): Promise<Response> {
  const url = new URL(request.url);
  if (!options.enabled || !options.publicOrigin && !options.local || request.method !== 'GET' || url.pathname !== '/api/session' || url.search
    || !isAllowedRequest(request, false, options.publicOrigin, options.trustedProxyHost)
    || publicDemoId(request) === null || publicVoiceOwner(request)) {
    return handler(request);
  }
  const token = randomBytes(32).toString('hex');
  const cookies = (request.headers.get('cookie') ?? '').split(';')
    .map(value => value.trim()).filter(value => value && cookieName(value) !== PUBLIC_VOICE_COOKIE);
  cookies.push(`${PUBLIC_VOICE_COOKIE}=${token}`);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('cookie', cookies.join('; '));
  const response = await handler(new Request(request, { headers: requestHeaders }));
  const headers = new Headers(response.headers);
  headers.append('set-cookie', `${PUBLIC_VOICE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
