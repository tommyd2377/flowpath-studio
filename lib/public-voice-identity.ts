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

/** A browser identifier for public usage limits; it grants no account access. */
export function publicVoiceOwner(request: Request): PublicVoiceOwner | null {
  const cookies = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim());
  const matching = cookies.filter(value => cookieName(value) === PUBLIC_VOICE_COOKIE);
  if (matching.length !== 1) return null;
  const token = matching[0].slice(matching[0].indexOf('=') + 1);
  if (!validToken(token)) return null;
  const accountSessionId = createHash('sha256').update(token).digest('hex');
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
  enabled: boolean; publicOrigin?: string; trustedProxyHost?: string;
}): Promise<Response> {
  const url = new URL(request.url);
  if (!options.enabled || !options.publicOrigin || request.method !== 'GET' || url.pathname !== '/api/session' || url.search
    || !isAllowedRequest(request, false, options.publicOrigin, options.trustedProxyHost) || publicVoiceOwner(request)) {
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
