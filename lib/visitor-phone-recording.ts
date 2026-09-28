import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { createTestRecordingStore } from './visitor-test-recording-store';
import { LOCAL_TEST_HEADER, PHONE_RECORDING_HEADER, RECORDING_HEADER, safeTestRecorder, type TestRecorder } from './visitor-test-events';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(50);
export const phoneRecordingLimits = { invitationMs: 10 * 60_000, durationMs: 30 * 60_000, active: 4 };
export function phoneRecordingOrigin(value: string) {
  try {
    const url = new URL(value), parts = url.hostname.split('.').map(Number);
    const privateAddress = parts.length === 4 && parts.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
      && (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 127);
    return url.protocol === 'https:' && url.origin === value && (privateAddress || url.hostname === 'localhost' || url.hostname === '[::1]');
  } catch { return false; }
}
const invitationSchema = z.object({ version: z.literal(1), id: z.string().uuid(), recordingId: z.string().uuid(), origin: z.string().refine(phoneRecordingOrigin), slug,
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative() }).strict();
type Store = ReturnType<typeof createTestRecordingStore>;
type Grant = { id: string; origin: string; slug: string; tokenHash: string; expiresAt: number; timer: ReturnType<typeof setTimeout> };
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const matches = (token: string, expected: string) => tokenPattern.test(token) && timingSafeEqual(Buffer.from(digest(token), 'hex'), Buffer.from(expected, 'hex'));

/** A capability only authorizes capture. It never authorizes a visitor task,
 * changes the app's network boundary, or grants recording read/list access. */
export function phoneRecordingRequest(request: Request, mode = process.env.NODE_ENV) {
  if (mode !== 'development') return false;
  const url = new URL(request.url), origin = request.headers.get('origin');
  return !!origin && phoneRecordingOrigin(origin) && url.origin === origin
    && (request.headers.get('host') ?? url.host) === url.host
    && request.headers.get(LOCAL_TEST_HEADER) === '1'
    && (!request.headers.has('sec-fetch-site') || request.headers.get('sec-fetch-site') === 'same-origin');
}

export function createPhoneRecordingPairings(directory: string, store: Store, options: { now?: () => number; newToken?: () => string } = {}) {
  const now = options.now ?? Date.now, newToken = options.newToken ?? (() => randomBytes(32).toString('base64url'));
  const grants = new Map<string, Grant>();
  let accepting: Promise<unknown> = Promise.resolve();
  function revoke(id: string) { const grant = grants.get(id); if (grant) clearTimeout(grant.timer); grants.delete(id); }
  function authorize(request: Request, id: string, publisher: string, mode = process.env.NODE_ENV) {
    if (!phoneRecordingRequest(request, mode)) return undefined;
    const grant = grants.get(id);
    if (!grant || now() >= grant.expiresAt || !store.active(id)) { if (grant) { revoke(id); void store.stop(id, 'Phone capture expired or stopped'); } return undefined; }
    if (request.headers.get(RECORDING_HEADER) !== id || new URL(request.url).origin !== grant.origin || publisher !== grant.slug
      || !matches(request.headers.get(PHONE_RECORDING_HEADER) ?? '', grant.tokenHash)) return undefined;
    return grant;
  }
  return {
    accept(request: Request, invitationId: string, publisher: string, metadata: object | (() => Promise<object>), mode = process.env.NODE_ENV) {
      const run = async () => {
        if (!phoneRecordingRequest(request, mode) || !z.string().uuid().safeParse(invitationId).success || !slug.safeParse(publisher).success) throw new Error('Phone recording pairing is unavailable.');
        for (const grant of grants.values()) if (now() >= grant.expiresAt || !store.active(grant.id)) revoke(grant.id);
        if (grants.size >= phoneRecordingLimits.active) throw new Error('Phone recording pairing is unavailable.');
        const file = join(directory, `phone-pairing-${invitationId}.json`);
        if ((await stat(file)).size > 2048) throw new Error('Invalid pairing invitation.');
        const invitation = invitationSchema.parse(JSON.parse(await readFile(file, 'utf8')));
        if (invitation.id !== invitationId || invitation.origin !== new URL(request.url).origin || invitation.slug !== publisher
          || invitation.createdAt > now() || invitation.expiresAt <= now() || invitation.expiresAt - invitation.createdAt > phoneRecordingLimits.invitationMs
          || !matches(request.headers.get(PHONE_RECORDING_HEADER) ?? '', invitation.tokenHash)) throw new Error('Phone recording pairing is unavailable.');
        // Atomic consumption prevents reuse, including after a process restart.
        const consumed = `${file}.used`;
        await rename(file, consumed);
        try {
          const details = typeof metadata === 'function' ? await metadata() : metadata;
          const started = await store.start(`Phone test · ${publisher}`, { ...details, phone: true, origin: invitation.origin, publisher }, invitation.recordingId);
          if (started.id !== invitation.recordingId) { await store.stop(started.id, 'Recorder upgrade requires restart'); throw new Error('Restart the local recorder before pairing.'); }
          const token = newToken(), expiresAt = now() + phoneRecordingLimits.durationMs;
          if (!tokenPattern.test(token)) { await store.stop(started.id, 'Pairing failed'); throw new Error('Invalid session grant.'); }
          const timer = setTimeout(() => { revoke(started.id); void store.stop(started.id, 'Phone capture expired'); }, phoneRecordingLimits.durationMs); timer.unref?.();
          grants.set(started.id, { id: started.id, origin: invitation.origin, slug: publisher, tokenHash: digest(token), expiresAt, timer });
          return { ...started, slug: publisher, token, expiresAt };
        } finally { await unlink(consumed).catch(() => undefined); }
      };
      const result = accepting.then(run, run); accepting = result.catch(() => undefined); return result;
    },
    authorize, revoke,
    observer(request: Request, id: string, publisher: string, traceId?: string): TestRecorder | undefined {
      if (!authorize(request, id, publisher)) return undefined;
      const observer = store.observer(id, traceId);
      return safeTestRecorder(event => { if (authorize(request, id, publisher)) observer(event); }, () => authorize(request, id, publisher) ? id : undefined);
    },
  };
}

const globals = globalThis as typeof globalThis & { visitorPhoneRecordingPairings?: ReturnType<typeof createPhoneRecordingPairings> };
export function phoneRecordingPairings(store: Store) {
  return globals.visitorPhoneRecordingPairings ??= createPhoneRecordingPairings(join(process.cwd(), '.visitor-recordings'), store);
}
