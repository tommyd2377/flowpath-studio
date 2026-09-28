import './check-node.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';

// Run manually on the development Mac. No API request, microphone, provider,
// credential environment variable or application configuration is accessed.
const [origin, slug] = process.argv.slice(2);
const usage = 'Usage: node scripts/pair-phone-recording.mjs https://YOUR-LAN-IP:3220 published-slug';
try {
  if (process.env.NODE_ENV === 'production' || !origin || !slug || process.argv.length !== 4) throw new Error(usage);
  const url = new URL(origin), parts = url.hostname.split('.').map(Number);
  const privateAddress = parts.length === 4 && parts.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
    && (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 127);
  if (url.protocol !== 'https:' || url.origin !== origin || !(privateAddress || ['localhost', '[::1]'].includes(url.hostname)) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 50) throw new Error(usage);
  const directory = join(process.cwd(), '.visitor-recordings');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const id = randomUUID(), token = randomBytes(32).toString('base64url'), createdAt = Date.now(), expiresAt = createdAt + 10 * 60_000;
  const invitation = { version: 1, id, recordingId: randomUUID(), origin, slug, tokenHash: createHash('sha256').update(token).digest('hex'), createdAt, expiresAt };
  const path = join(directory, `phone-pairing-${id}`), link = `${origin}/s/${slug}#flowpath-recording=${id}.${token}`;
  await writeFile(`${path}.json`, JSON.stringify(invitation), { flag: 'wx', mode: 0o600 });
  await writeFile(`${path}.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="referrer" content="no-referrer"><title>Pair phone recording</title><style>body{max-width:650px;margin:3rem auto;padding:1rem;font:17px/1.6 system-ui}textarea{width:100%;box-sizing:border-box;height:8rem}a{overflow-wrap:anywhere}</style><h1>Pair this phone test</h1><p>Copy this private link to your iPhone and open it before ${new Date(expiresAt).toLocaleTimeString()}. It works once, only for <strong>${slug}</strong> on <strong>${origin}</strong>.</p><textarea readonly aria-label="Private phone pairing link">${link}</textarea><p>On the phone, open <strong>Local test recorder</strong> and tap <strong>Start paired recording</strong>. This permits up to 30 minutes of transcripts, model inputs, actions and screen state in this Mac's local timeline. It does not start voice. No raw audio or hidden reasoning is recorded.</p><p>Keep this card private. Stop recording on the phone when finished. Delete this local card afterward. Stopping the development server also revokes active phone grants.</p></html>`, { flag: 'wx', mode: 0o600 });
  // Intentionally print only the card path, never the invitation or session grant.
  process.stdout.write(`Private pairing card saved: ${path}.html\nOpen it locally and copy its link to your phone. No recording has started.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : usage}\n`); process.exitCode = 1;
}
