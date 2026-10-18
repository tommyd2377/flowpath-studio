/** A single, explicit browser-facing HTTPS origin. No forwarded header grants access. */
export function configuredPublicOrigin(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/'
      && !url.search && !url.hash && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.origin;
  } catch { /* Invalid configuration leaves public access disabled. */ }
}

export function isAllowedRequest(request: Request, mutation: boolean, publicOrigin?: string): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const host = request.headers.get('host');
  const origin = request.headers.get('origin');
  if (publicOrigin) {
    const configured = configuredPublicOrigin(publicOrigin);
    if (!configured || host !== new URL(configured).host) return false;
    // TLS terminates at the hosting proxy, which may give Next an internal URL.
    return mutation ? origin === configured : !origin || origin === configured;
  }
  const url = new URL(request.url);
  const loopback = ['localhost', '127.0.0.1', '[::1]'];
  if (url.protocol !== 'http:' || !loopback.includes(url.hostname) || !host) return false;
  let browserUrl: URL;
  try { browserUrl = new URL(`http://${host}`); } catch { return false; }
  if (browserUrl.host !== host || !loopback.includes(browserUrl.hostname) || browserUrl.port !== url.port) return false;
  return mutation ? origin === browserUrl.origin : !origin || origin === browserUrl.origin;
}
