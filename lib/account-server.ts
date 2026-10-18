import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_VOICE, isVoiceName } from './voice-options';
import { normalizeProfilePhoto, validProfilePhoto } from './profile-photo';
import { configuredPublicOrigin, isAllowedRequest } from './request-origin';
import { AccountSessionInactiveError, accountSessionId, type DurableAccountSessions } from './production-account-session';
import { InvitationRequiredError } from './invitations';
import {
  WAVEFORM_DEFAULT_COLOR, WAVEFORM_NAME_LIMIT, WAVEFORM_PROMPT_LIMIT,
  type AccountMode, type AccountUser, type FirebasePublicConfig, type Waveform, type WaveformInput,
} from './account-model';

export const ACCOUNT_COOKIE = 'flowpath_account';
export const ACCOUNT_COOKIE_SECONDS = 5 * 24 * 60 * 60;

export type FirebaseAccountAdapter = {
  signIn(idToken: string, inviteCode?: string): Promise<{ user: AccountUser; cookie: string }>;
  authenticate(cookie: string): Promise<AccountUser | null>;
  sessions?: DurableAccountSessions;
  readWaveform(uid: string): Promise<Waveform | null>;
  saveWaveform(uid: string, input: WaveformInput, accountSessionId?: string): Promise<Waveform>;
};

type Options = {
  mode?: AccountMode | (() => AccountMode);
  firebase?: FirebaseAccountAdapter;
  firebaseConfig?: () => FirebasePublicConfig | undefined;
  firebaseAutoConfig?: () => boolean;
  beforeAccountChange?: (owner: AccountUser) => Promise<boolean>;
  localDirectory?: string;
  development?: () => boolean;
  publicOrigin?: () => string | undefined;
  trustedProxyHost?: () => string | undefined;
  now?: () => number;
};

const localAccounts: Record<string, AccountUser> = {
  'owner-a': { uid: 'local-owner-a', displayName: 'Test owner A' },
  'owner-b': { uid: 'local-owner-b', displayName: 'Test owner B' },
};
const json = (body: object, status = 200, headers?: HeadersInit) => Response.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', ...headers },
});
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object'
  && !Array.isArray(value) ? value as Record<string, unknown> : null;

async function readBody(request: Request, maxBytes = 20_000) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json' || !request.body) throw new Error('Invalid body');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error('Invalid body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 5_000);
  const abort = () => { void reader.cancel().catch(() => undefined); };
  request.signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Invalid body');
      chunks.push(value);
    }
    if (timedOut) throw new Error('Invalid body');
    request.signal.throwIfAborted();
    const result = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!result) throw new Error('Invalid body');
    return result;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => undefined);
  }
}

function waveformInput(value: Record<string, unknown>): WaveformInput | null {
  if (Object.keys(value).some(key => !['name', 'initialPrompt', 'voice', 'accentColor', 'profilePhoto'].includes(key))
    || typeof value.name !== 'string' || typeof value.initialPrompt !== 'string') return null;
  const voice = value.voice === undefined ? DEFAULT_VOICE : value.voice;
  if (!isVoiceName(voice)) return null;
  const accentColor = value.accentColor === undefined ? WAVEFORM_DEFAULT_COLOR : value.accentColor;
  const profilePhoto = value.profilePhoto === undefined ? null : value.profilePhoto;
  if (typeof accentColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(accentColor)
    || profilePhoto !== null && !validProfilePhoto(profilePhoto)) return null;
  const name = value.name.trim();
  const initialPrompt = value.initialPrompt.trim();
  if (!name || name.length > WAVEFORM_NAME_LIMIT || /[\u0000-\u001f\u007f]/.test(name)
    || !initialPrompt || initialPrompt.length > WAVEFORM_PROMPT_LIMIT
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(initialPrompt)) return null;
  return { name, initialPrompt, voice, accentColor: accentColor.toLowerCase(), profilePhoto };
}

export function waveformRecord(value: unknown): Waveform | null {
  const row = object(value);
  if (!row || typeof row.id !== 'string' || !/^[0-9a-f-]{36}$/.test(row.id)
    || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) return null;
  const input = waveformInput({
    name: row.name, initialPrompt: row.initialPrompt, voice: row.voice,
    accentColor: row.accentColor, profilePhoto: row.profilePhoto,
  });
  return input ? { id: row.id, ...input, updatedAt: row.updatedAt } : null;
}

/** Dedicated synthetic fixtures only. Never reads Studio's private data directory. */
export function createLocalWaveformStore(directory: string, now: () => number = Date.now) {
  let pending = Promise.resolve();
  const pathFor = (uid: string) => join(directory, `${createHash('sha256').update(uid).digest('hex')}.json`);

  async function read(uid: string) {
    try {
      const parsed = waveformRecord(JSON.parse(await readFile(pathFor(uid), 'utf8')));
      if (!parsed) throw new Error('Invalid saved waveform');
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  return {
    async readWaveform(uid: string) { await pending; return read(uid); },
    async saveWaveform(uid: string, input: WaveformInput) {
      const save = pending.then(async () => {
        const existing = await read(uid);
        const waveform: Waveform = {
          id: existing?.id ?? randomUUID(), ...input, updatedAt: new Date(now()).toISOString(),
        };
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const target = pathFor(uid);
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(waveform), { flag: 'wx', mode: 0o600 });
          await rename(temporary, target);
        } finally { await rm(temporary, { force: true }); }
        return waveform;
      });
      pending = save.then(() => undefined, () => undefined);
      return save;
    },
  };
}

function cookieValue(request: Request) {
  const matches = (request.headers.get('cookie') ?? '').split(';')
    .map(part => part.trim()).filter(part => part.startsWith(`${ACCOUNT_COOKIE}=`));
  if (matches.length !== 1) return null;
  try {
    const value = decodeURIComponent(matches[0].slice(ACCOUNT_COOKIE.length + 1));
    return value && value.length <= 16_384 ? value : null;
  } catch { return null; }
}

function cookieHeader(value: string, secure: boolean, maxAge = ACCOUNT_COOKIE_SECONDS) {
  return `${ACCOUNT_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

/** Fixture identities stay local; explicit Firebase activation uses durable sessions. */
export function createAccountServer(options: Options = {}) {
  const now = options.now ?? Date.now;
  const development = options.development ?? (() => process.env.NODE_ENV === 'development');
  const localStore = createLocalWaveformStore(options.localDirectory ?? join(process.cwd(), '.local-waveforms'), now);
  const sessions = new Map<string, { user: AccountUser; expiresAt: number; mode: AccountMode; changing?: boolean }>();
  const publicOrigin = () => !development() ? configuredPublicOrigin(options.publicOrigin?.()) : undefined;
  const allowed = (request: Request, mutation: boolean) => isAllowedRequest(request, mutation, publicOrigin(),
    !development() ? options.trustedProxyHost?.() : undefined);
  function mode(): AccountMode {
    const configured = typeof options.mode === 'function' ? options.mode() : options.mode ?? 'unavailable';
    if (!development() && (configured !== 'firebase' || !publicOrigin() || !options.firebase?.sessions)) return 'unavailable';
    return configured === 'firebase' && !options.firebase ? 'unavailable' : configured;
  }
  async function resolveIdentity(request: Request) {
    if (!allowed(request, false)) return null;
    const cookie = cookieValue(request);
    if (!cookie) return null;
    const currentMode = mode();
    if (currentMode === 'unavailable') return null;
    if (currentMode === 'firebase' && options.firebase?.sessions) {
      const id = accountSessionId(cookie);
      try {
        const owner = await options.firebase.authenticate(cookie);
        if (!owner) return null;
        const isCurrent = async () => {
          if (mode() !== currentMode) return false;
          try { return await options.firebase!.sessions!.active(id, owner.uid); }
          catch { return false; }
        };
        if (!await isCurrent()) return null;
        return { owner, mode: currentMode, cookie, accountSessionId: id, session: undefined, isCurrent };
      } catch { return null; }
    }
    const session = sessions.get(cookie);
    if (!session || session.mode !== currentMode || session.changing) return null;
    if (session.expiresAt <= now()) { sessions.delete(cookie); return null; }
    const isCurrent = () => sessions.get(cookie) === session && !session.changing
      && session.expiresAt > now() && mode() === currentMode;
    if (currentMode === 'firebase') {
      try {
        const verified = await options.firebase!.authenticate(cookie);
        if (!verified || verified.uid !== session.user.uid || !isCurrent()) return null;
      } catch { return null; }
    }
    return { owner: session.user, mode: currentMode, cookie, session, accountSessionId: undefined, isCurrent };
  }
  async function resolveOwner(request: Request): Promise<AccountUser | null> {
    const identity = await resolveIdentity(request);
    return identity && await identity.isCurrent() ? identity.owner : null;
  }
  function store() { return mode() === 'firebase' ? options.firebase! : localStore; }
  async function resolveVoiceWaveform(request: Request, id?: string) {
    const identity = await resolveIdentity(request);
    if (!identity) return null;
    const waveform = await (identity.mode === 'firebase' ? options.firebase! : localStore).readWaveform(identity.owner.uid);
    return waveform && await identity.isCurrent() && (id === undefined || waveform.id === id)
      ? { ownerUid: identity.owner.uid, waveform, accountSessionId: identity.accountSessionId, isCurrent: identity.isCurrent } : null;
  }
  async function resolveWaveform(request: Request, id?: string): Promise<Waveform | null> {
    return (await resolveVoiceWaveform(request, id))?.waveform ?? null;
  }
  const forbidden = () => json({ error: 'Only requests from this application are allowed.' }, 403);
  const unavailable = () => json({ error: 'Accounts are not enabled.' }, 503);
  const unauthorized = () => json({ error: 'Sign in to access your waveform.' }, 401);
  async function canChangeAccount(request: Request) {
    const cookie = cookieValue(request);
    if (cookie && mode() === 'firebase' && options.firebase?.sessions) {
      try {
        const owner = await options.firebase.authenticate(cookie);
        if (!owner) return true;
        const id = accountSessionId(cookie);
        const change = await options.firebase.sessions.beginChange(id, owner.uid);
        if (change === 'inactive') return true;
        if (change === 'busy') return false;
        let confirmed = false;
        try { confirmed = !options.beforeAccountChange || await options.beforeAccountChange(owner); }
        catch { /* The current identity survives unconfirmed conversation cleanup. */ }
        const completed = await options.firebase.sessions.finishChange(id, owner.uid, change.changeId, confirmed);
        return confirmed && completed;
      } catch { return false; }
    }
    if (cookie && sessions.get(cookie)?.changing) return false;
    const identity = await resolveIdentity(request);
    if (!identity) return !cookie || !sessions.get(cookie)?.changing;
    if (!await identity.isCurrent() || !identity.session) return false;
    // Pause admission before awaiting teardown. A delayed voice request must
    // not reserve a conversation between confirmed cleanup and cookie removal.
    identity.session.changing = true;
    let confirmed = false;
    try { confirmed = !options.beforeAccountChange || await options.beforeAccountChange(identity.owner); }
    catch { /* Preserve the current account when cleanup cannot be confirmed. */ }
    if (!confirmed && sessions.get(identity.cookie) === identity.session) identity.session.changing = false;
    return confirmed;
  }
  const finishing = () => json({ error: 'Your previous conversation is still finishing. Please wait before changing accounts.' }, 503);

  return {
    resolveOwner, resolveWaveform, resolveVoiceWaveform,
    async accountGET(request: Request) {
      if (!allowed(request, false)) return forbidden();
      const currentMode = mode();
      const firebaseConfig = currentMode === 'firebase' ? options.firebaseConfig?.() : undefined;
      const autoFirebaseConfig = currentMode === 'firebase' && options.firebaseAutoConfig?.();
      return json({ mode: currentMode, user: await resolveOwner(request),
        ...(firebaseConfig ? { firebaseConfig } : {}), ...(autoFirebaseConfig ? { autoFirebaseConfig: true } : {}) });
    },
    async accountPOST(request: Request) {
      if (!allowed(request, true)) return forbidden();
      if (mode() === 'unavailable') return unavailable();
      let body: Record<string, unknown>;
      try { body = await readBody(request); } catch { return json({ error: 'Invalid sign-in request.' }, 400); }
      let user: AccountUser, cookie: string;
      if (mode() === 'local') {
        if (Object.keys(body).length !== 1 || typeof body.localAccount !== 'string'
          || !Object.hasOwn(localAccounts, body.localAccount)) return json({ error: 'Choose a local test account.' }, 400);
        user = localAccounts[body.localAccount];
        cookie = randomBytes(32).toString('base64url');
      } else {
        if (Object.keys(body).some(key => key !== 'idToken' && key !== 'inviteCode')
          || typeof body.idToken !== 'string' || !/^[A-Za-z0-9._-]{1,16384}$/.test(body.idToken)
          || body.inviteCode !== undefined && (typeof body.inviteCode !== 'string' || body.inviteCode.length > 64)) {
          return json({ error: 'Invalid sign-in request.' }, 400);
        }
        try { ({ user, cookie } = await options.firebase!.signIn(body.idToken, body.inviteCode as string | undefined)); }
        catch (error) { return error instanceof InvitationRequiredError
          ? json({ error: error.message, code: 'invitation-required' }, 403)
          : json({ error: 'Sign-in could not be verified. Please try again.' }, 401); }
      }
      if (!await canChangeAccount(request)) return finishing();
      if (mode() === 'firebase' && options.firebase?.sessions) {
        try { await options.firebase.sessions.create(cookie, user, now() + ACCOUNT_COOKIE_SECONDS * 1_000); }
        catch { return json({ error: 'Sign-in could not be completed. Please try again.' }, 503); }
      } else {
        for (const [token, session] of sessions) if (session.expiresAt <= now()) sessions.delete(token);
        if (sessions.size >= 256) sessions.delete(sessions.keys().next().value!);
        const previous = cookieValue(request);
        if (previous) sessions.delete(previous);
        sessions.set(cookie, { user, expiresAt: now() + ACCOUNT_COOKIE_SECONDS * 1_000, mode: mode() });
      }
      return json({ mode: mode(), user }, 200, { 'Set-Cookie': cookieHeader(cookie, !development()) });
    },
    async accountDELETE(request: Request) {
      if (!allowed(request, true)) return forbidden();
      if (!await canChangeAccount(request)) return finishing();
      const cookie = cookieValue(request);
      if (cookie) sessions.delete(cookie);
      return json({ mode: mode(), user: null }, 200, { 'Set-Cookie': cookieHeader('', !development(), 0) });
    },
    async waveformGET(request: Request) {
      if (!allowed(request, false)) return forbidden();
      if (mode() === 'unavailable') return unavailable();
      const identity = await resolveIdentity(request);
      if (!identity) return unauthorized();
      try {
        const query = new URL(request.url).searchParams;
        if ([...query.keys()].some(key => key !== 'id') || query.getAll('id').length > 1) return json({ error: 'Invalid waveform request.' }, 400);
        const id = query.get('id');
        const waveform = await store().readWaveform(identity.owner.uid);
        if (!await identity.isCurrent()) return unauthorized();
        if (id !== null && (!id || !waveform || waveform.id !== id)) return json({ error: 'This waveform is unavailable.' }, 404);
        return json({ waveform });
      } catch { return json({ error: 'Your waveform could not be loaded. Please try again.' }, 503); }
    },
    async waveformPUT(request: Request) {
      if (!allowed(request, true)) return forbidden();
      if (mode() === 'unavailable') return unavailable();
      const identity = await resolveIdentity(request);
      if (!identity) return unauthorized();
      let input: WaveformInput | null;
      try { input = waveformInput(await readBody(request, 200 * 1024)); } catch { input = null; }
      if (!input) return json({ error: `Use a name up to ${WAVEFORM_NAME_LIMIT} characters, instructions up to ${WAVEFORM_PROMPT_LIMIT} characters, a six-digit hex color and a PNG, JPEG or WebP photo up to 128 KB and 512 pixels.` }, 400);
      if (!await identity.isCurrent()) return unauthorized();
      try {
        if (input.profilePhoto !== null) {
          const existing = await store().readWaveform(identity.owner.uid);
          if (!await identity.isCurrent()) return unauthorized();
          if (input.profilePhoto !== existing?.profilePhoto) {
            const normalized = await normalizeProfilePhoto(input.profilePhoto);
            if (!normalized) return json({ error: 'Choose a valid PNG, JPEG or WebP photo up to 128 KB and 512 pixels.' }, 400);
            input.profilePhoto = normalized;
          }
        }
        if (!await identity.isCurrent()) return unauthorized();
        const waveform = identity.mode === 'firebase'
          ? await options.firebase!.saveWaveform(identity.owner.uid, input, identity.accountSessionId)
          : await localStore.saveWaveform(identity.owner.uid, input);
        return json({ waveform });
      }
      catch (error) { return error instanceof AccountSessionInactiveError ? unauthorized()
        : json({ error: 'Your waveform could not be saved. Please try again.' }, 503); }
    },
  };
}
