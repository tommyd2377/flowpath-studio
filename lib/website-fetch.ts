import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP, BlockList } from 'node:net';
import { AppError } from './errors';

const MAX_BYTES = 2 * 1024 * 1024;
const blocked = new BlockList();
blocked.addSubnet('192.88.99.0', 24, 'ipv4');
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) blocked.addSubnet(address, prefix, 'ipv4');
// Only global unicast IPv6; additionally exclude special-use documentation,
// benchmarking, transition and mapped ranges (no embedded private IPv4).
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) blocked.addSubnet(address, prefix, 'ipv6');
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !blocked.check(address, 'ipv6');
}
export function assertPublicWebsiteUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError('Enter a valid HTTPS website URL.'); }
  const host = url.hostname.toLowerCase();
  if (value.length > 2048 || url.protocol !== 'https:' || url.username || url.password || url.port || !host.includes('.') || host.endsWith('.')
    || /(?:^|\.)(?:localhost|local|internal|home|test|invalid|nip\.io|sslip\.io|localtest\.me|lvh\.me)$/.test(host) || isIP(host) || host.startsWith('[')) {
    throw new AppError('Website imports require a public HTTPS URL without credentials.');
  }
  url.hash = '';
  return url;
}
type Address = { address: string; family: number };
type WebsiteResponse = { status: number; contentType: string; remoteAddress: string; bytes: Uint8Array };
export type WebsiteTransport = {
  resolve: (hostname: string) => Promise<Address[]>;
  connect: (url: URL, address: Address, signal: AbortSignal) => Promise<WebsiteResponse>;
};
function sameAddress(left: string, right: string) {
  const list = new BlockList();
  try { list.addAddress(left, isIP(left) === 6 ? 'ipv6' : 'ipv4'); return list.check(right, isIP(right) === 6 ? 'ipv6' : 'ipv4'); }
  catch { return false; }
}
/** No proxy, cookie jar, user headers, redirects, retry, or second DNS lookup. */
const transport: WebsiteTransport = {
  resolve: hostname => lookup(hostname, { all: true, verbatim: true }),
  connect: (url, address, signal) => new Promise((resolve, reject) => {
    const req = request({ protocol: 'https:', hostname: address.address, family: address.family, servername: url.hostname,
      port: 443, method: 'GET', path: `${url.pathname}${url.search}`, agent: false, signal,
      headers: { Host: url.host, Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity' },
    }, response => {
      const remoteAddress = response.socket.remoteAddress ?? '';
      const contentType = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      const status = response.statusCode ?? 0;
      if (!sameAddress(remoteAddress, address.address) || !isPublicAddress(remoteAddress) || status < 200 || status >= 300
        || !['text/html', 'application/xhtml+xml'].includes(contentType) || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity'
        || Number(response.headers['content-length'] ?? 0) > MAX_BYTES) {
        response.destroy(); reject(new AppError('Website destination, status, content type or size is not supported. Redirects are not followed.')); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { response.destroy(new AppError('The website page is larger than the 2 MB import limit.')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status, contentType, remoteAddress, bytes: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  }),
};
export async function fetchWebsiteHtml(value: string, io: WebsiteTransport = transport) {
  const url = assertPublicWebsiteUrl(value);
  const signal = AbortSignal.timeout(15_000);
  let onAbort: () => void = () => {};
  const timeout = new Promise<never>((_, reject) => { onAbort = () => reject(new AppError('The website exceeded the 15 second import limit.')); signal.addEventListener('abort', onAbort, { once: true }); });
  try {
    const addresses = await Promise.race([io.resolve(url.hostname), timeout]);
    if (!addresses.length || addresses.length > 32 || addresses.some(item => !isPublicAddress(item.address) || isIP(item.address) !== item.family)) throw new AppError('The website resolves to a non-public or unsupported destination.');
    const response = await Promise.race([io.connect(url, addresses[0], signal), timeout]);
    if (!sameAddress(response.remoteAddress, addresses[0].address) || !isPublicAddress(response.remoteAddress)) throw new AppError('The connected website address did not match its validated DNS destination.');
    if (response.status < 200 || response.status >= 300) throw new AppError(`The website returned HTTP ${response.status}. Redirects are not followed.`);
    if (!['text/html', 'application/xhtml+xml'].includes(response.contentType)) throw new AppError('Website imports accept HTML pages only.');
    if (response.bytes.length > MAX_BYTES) throw new AppError('The website page is larger than the 2 MB import limit.');
    return { html: new TextDecoder('utf-8', { fatal: true }).decode(response.bytes), url: url.toString() };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('The website could not be fetched safely within the import limit.');
  } finally { signal.removeEventListener('abort', onAbort); }
}
