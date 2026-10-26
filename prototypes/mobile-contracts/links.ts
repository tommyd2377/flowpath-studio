import { validWaveformId } from '../../lib/paid-model';

export type PublicWaveformLink = {
  kind: 'public-waveform'; waveformId: string; path: string; webFallbackUrl: string;
};

function publicOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https:\/\/[^/?#]+\/?$/.test(value) || /[\s\\%]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/'
      && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}

/** The origin comes from approved server configuration. This does not configure or verify app associations. */
export function canonicalPublicWaveformUrl(waveformId: unknown, approvedOrigin: unknown): string | null {
  const origin = publicOrigin(approvedOrigin);
  return origin && validWaveformId(waveformId) ? `${origin}/p/${waveformId.toLowerCase()}` : null;
}

/** Pure route selection: the web URL remains usable without an installed native app. No identity is granted. */
export function resolvePublicWaveformLink(value: unknown, approvedOrigin: unknown): PublicWaveformLink | null {
  const origin = publicOrigin(approvedOrigin);
  if (!origin || typeof value !== 'string' || value.length > 2048 || /[\s\\%]/.test(value)) return null;
  // Check raw syntax before WHATWG URL parsing can normalize traversal, slashes or whitespace.
  const match = /^https:\/\/[^/?#]+(\/p\/([0-9a-f-]{36}))$/i.exec(value);
  if (!match || !match[1].startsWith('/p/') || !validWaveformId(match[2])) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.port
      || url.search || url.hash || url.pathname !== match[1]) return null;
    const waveformId = match[2].toLowerCase(), path = `/p/${waveformId}`;
    return { kind: 'public-waveform', waveformId, path, webFallbackUrl: `${origin}${path}` };
  } catch { return null; }
}
