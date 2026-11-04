import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { VoiceDatabase, VoiceTransaction } from './production-voice-store';
import type { WaveformPrompt } from './voice-config';
import { PLUGINS } from './plugin-contract';

export type ProtectedPlugin = typeof PLUGINS[number]['id'];
/** Construct only from authenticated server identity and an authorized waveform lookup. */
export type PluginAccessScope = {
  ownerUid: string; waveformId: string;
  accountUid?: string; sessionId: string;
};
export type PluginAccessView = { revision: string; protectedPlugins: ProtectedPlugin[]; codeConfigured: boolean };
type Policy = { revision: string; plugins: ProtectedPlugin[]; salt: string | null; digest: string | null };
type Grant = { binding: string; revision: string; plugins: ProtectedPlugin[]; expiresAt: number };
type Options = {
  now?: () => number;
  /** Must verify current identity, waveform ownership/access and current content safety in this transaction. */
  authorize(tx: VoiceTransaction, scope: PluginAccessScope, management: boolean): Promise<void>;
  /** Must reject while any affected voice admission/call remains open or uncertain. Never close providers in a retried transaction. */
  assertPolicyMutable(tx: VoiceTransaction, scope: PluginAccessScope): Promise<void>;
};
export class PluginAccessError extends Error {
  constructor(message: string, readonly status = 403) { super(message); }
}
const GRANT_MS = 30 * 60_000, WINDOW_MS = 60_000;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const pluginPolicyPath = (scope: Pick<PluginAccessScope, 'ownerUid' | 'waveformId'>) => `pluginAccessPolicies/${hash([scope.ownerUid, scope.waveformId])}`;
const binding = (scope: PluginAccessScope) => hash([scope.ownerUid, scope.waveformId, scope.accountUid ?? null, scope.sessionId]);
const codeValid = (code: unknown): code is string => typeof code === 'string' && Buffer.byteLength(code, 'utf8') >= 8
  && Buffer.byteLength(code, 'utf8') <= 128 && !/[\u0000-\u001f\u007f]/.test(code);
function plugins(value: unknown): ProtectedPlugin[] {
  if (!Array.isArray(value) || value.length > PLUGINS.length || new Set(value).size !== value.length
    || value.some(id => !PLUGINS.some(plugin => plugin.id === id))) throw new PluginAccessError('Choose valid plugins.', 400);
  return PLUGINS.map(plugin => plugin.id).filter(id => value.includes(id));
}
function policy(row: Record<string, unknown> | null): Policy {
  if (!row) return { revision: 'off', plugins: [], salt: null, digest: null };
  try {
    const ids = plugins(row.plugins);
    if (Object.keys(row).length !== 5 || row.version !== 1 || typeof row.revision !== 'string'
      || !/^[a-f0-9-]{36}$/.test(row.revision)
      || ids.length && (typeof row.salt !== 'string' || !/^[a-f0-9]{32}$/.test(row.salt)
        || typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest))
      || !ids.length && (row.salt !== null || row.digest !== null)) throw new Error();
    return { revision: row.revision, plugins: ids, salt: row.salt as string | null, digest: row.digest as string | null };
  } catch { throw new PluginAccessError('Plugin access is temporarily unavailable.', 503); }
}
const view = (row: Policy): PluginAccessView => ({ revision: row.revision, protectedPlugins: [...row.plugins], codeConfigured: !!row.digest });
function derive(code: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(code, Buffer.from(salt, 'hex'), 32,
    { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
function attempts(row: Record<string, unknown> | null, now: number) {
  if (!row) return { count: 0, since: now };
  if (Object.keys(row).length !== 2 || !Number.isSafeInteger(row.since) || !Number.isSafeInteger(row.count)
    || Number(row.count) < 0 || Number(row.since) > now) throw new PluginAccessError('Plugin access is temporarily unavailable.', 503);
  return now - Number(row.since) >= WINDOW_MS ? { count: 0, since: now } : { count: Number(row.count), since: Number(row.since) };
}
function grant(row: Record<string, unknown> | null): Grant | null {
  if (!row) return null;
  try {
    if (Object.keys(row).length !== 4 || typeof row.binding !== 'string' || typeof row.revision !== 'string'
      || !Number.isSafeInteger(row.expiresAt)) return null;
    return { binding: row.binding, revision: row.revision, plugins: plugins(row.plugins), expiresAt: Number(row.expiresAt) };
  } catch { return null; }
}

/** Server-only core. Not wired into runtime until every projection, operation and voice fence is integrated. */
export function createPluginAccess(database: VoiceDatabase, options: Options) {
  const now = options.now ?? Date.now;
  async function authorize(tx: VoiceTransaction, scope: PluginAccessScope, management: boolean) {
    if (!scope.ownerUid || !scope.waveformId || !scope.sessionId || management && scope.accountUid !== scope.ownerUid) {
      throw new PluginAccessError('Sign in as this waveform’s owner.');
    }
    await options.authorize(tx, scope, management);
  }
  async function checkIn(tx: VoiceTransaction, scope: PluginAccessScope, requested: ProtectedPlugin[], token?: string) {
    await authorize(tx, scope, false);
    const row = policy(await tx.get(pluginPolicyPath(scope)));
    const protectedIds = requested.filter(id => row.plugins.includes(id));
    if (protectedIds.length) {
      const access = token && /^[a-f0-9]{64}$/.test(token) ? grant(await tx.get(`pluginAccessGrants/${hash(token)}`)) : null;
      if (!access || access.binding !== binding(scope) || access.revision !== row.revision || access.expiresAt <= now()
        || protectedIds.some(id => !access.plugins.includes(id))) throw new PluginAccessError('Enter the access code for this plugin.');
    }
    return row.revision;
  }
  const check = async (scope: PluginAccessScope, requested: ProtectedPlugin[], token?: string) => {
    const ids = plugins(requested);
    return database.transaction(tx => checkIn(tx, scope, ids, token));
  };
  return {
    check,
    async playback(scope: PluginAccessScope, token?: string) {
      return database.transaction(async tx => {
        await authorize(tx, scope, false);
        const row = policy(await tx.get(pluginPolicyPath(scope)));
        const access = token && /^[a-f0-9]{64}$/.test(token) ? grant(await tx.get(`pluginAccessGrants/${hash(token)}`)) : null;
        const valid = access && access.binding === binding(scope) && access.revision === row.revision && access.expiresAt > now() ? access : null;
        const locked = row.plugins.filter(id => !valid?.plugins.includes(id));
        return { revision: row.revision, locked, allowed: PLUGINS.map(p => p.id).filter(id => !locked.includes(id)), expiresAt: valid?.expiresAt };
      });
    },
    /** Also usable inside the existing atomic voice admission transaction. */
    checkInTransaction(tx: VoiceTransaction, scope: PluginAccessScope, requested: ProtectedPlugin[], token?: string) {
      return checkIn(tx, scope, plugins(requested), token);
    },
    async settings(scope: PluginAccessScope) {
      return database.transaction(async tx => { await authorize(tx, scope, true); return view(policy(await tx.get(pluginPolicyPath(scope)))); });
    },
    async configure(scope: PluginAccessScope, input: { revision: string; protectedPlugins: ProtectedPlugin[]; code?: string }) {
      const ids = plugins(input.protectedPlugins);
      if (typeof input.revision !== 'string' || input.code !== undefined && !codeValid(input.code)) {
        throw new PluginAccessError('Use an access code between 8 and 128 UTF-8 bytes.', 400);
      }
      const prior = await database.transaction(async tx => {
        await authorize(tx, scope, true);
        const row = policy(await tx.get(pluginPolicyPath(scope)));
        if (row.revision !== input.revision) throw new PluginAccessError('Settings changed. Reload before saving.', 409);
        if (ids.length && !row.digest && input.code === undefined) throw new PluginAccessError('Set an access code before requiring it.', 400);
        await options.assertPolicyMutable(tx, scope);
        return row;
      });
      const salt = ids.length ? input.code === undefined ? prior.salt! : randomBytes(16).toString('hex') : null;
      const digest = ids.length ? input.code === undefined ? prior.digest! : (await derive(input.code, salt!)).toString('hex') : null;
      const next: Policy = { revision: randomUUID(), plugins: ids, salt, digest };
      return database.transaction(async tx => {
        await authorize(tx, scope, true);
        const row = policy(await tx.get(pluginPolicyPath(scope)));
        if (row.revision !== prior.revision) throw new PluginAccessError('Settings changed. Reload before saving.', 409);
        await options.assertPolicyMutable(tx, scope);
        tx.set(pluginPolicyPath(scope), { version: 1, ...next });
        return view(next);
      });
    },
    async unlock(scope: PluginAccessScope, code: string, requested: ProtectedPlugin[], previousToken?: string) {
      const ids = plugins(requested);
      if (!codeValid(code) || !ids.length) throw new PluginAccessError('Enter a valid access code and choose a plugin.', 400);
      const captured = await database.transaction(async tx => {
        await authorize(tx, scope, false);
        const row = policy(await tx.get(pluginPolicyPath(scope)));
        if (!row.digest || ids.some(id => !row.plugins.includes(id))) throw new PluginAccessError('Choose a protected plugin.', 400);
        const ownPath = `pluginAccessAttempts/${binding(scope)}`;
        // A policy-wide limit prevents new sessions/accounts from bypassing the work bound.
        const globalPath = `pluginAccessAttempts/${hash([scope.ownerUid, scope.waveformId])}`;
        const [ownRow, globalRow] = await Promise.all([tx.get(ownPath), tx.get(globalPath)]);
        const own = attempts(ownRow, now()), global = attempts(globalRow, now());
        if (own.count >= 5 || global.count >= 20) return { throttled: true as const };
        // Reserve work before the expensive hash. Wrong codes and parallel attempts count too.
        tx.set(ownPath, { ...own, count: own.count + 1 });
        tx.set(globalPath, { ...global, count: global.count + 1 });
        return { throttled: false as const, row };
      });
      if (captured.throttled) throw new PluginAccessError('Too many attempts. Wait a minute and try again.', 429);
      const actual = await derive(code, captured.row.salt!);
      if (!timingSafeEqual(actual, Buffer.from(captured.row.digest!, 'hex'))) throw new PluginAccessError('That access code is incorrect.');
      const token = randomBytes(32).toString('hex');
      const expiresAt = now() + GRANT_MS;
      await database.transaction(async tx => {
        await authorize(tx, scope, false);
        const row = policy(await tx.get(pluginPolicyPath(scope)));
        if (row.revision !== captured.row.revision) throw new PluginAccessError('The access code changed. Try again.', 409);
        const prior = previousToken && /^[a-f0-9]{64}$/.test(previousToken)
          ? grant(await tx.get(`pluginAccessGrants/${hash(previousToken)}`)) : null;
        const retained = prior && prior.binding === binding(scope) && prior.revision === row.revision && prior.expiresAt > now() ? prior.plugins : [];
        tx.set(`pluginAccessGrants/${hash(token)}`, { binding: binding(scope), revision: row.revision, plugins: [...new Set([...retained, ...ids])], expiresAt });
      });
      return { token, expiresAt };
    },
    /** A revoked/expired/changed policy or identity withholds an already-running operation's result. */
    async read<T>(scope: PluginAccessScope, requested: ProtectedPlugin[], token: string | undefined, work: () => Promise<T>, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const revision = await check(scope, requested, token);
      const result = await work();
      signal?.throwIfAborted();
      if (revision !== await check(scope, requested, token)) throw new PluginAccessError('Plugin access changed. Try again.', 409);
      return result;
    },
  };
}

/** Apply only after server checks; retain the original approved waveform separately for digest/review enforcement. */
export function projectPluginPrompt(waveform: WaveformPrompt, allowed: readonly ProtectedPlugin[]): WaveformPrompt {
  return { name: waveform.name, initialPrompt: waveform.initialPrompt, ...(waveform.voice ? { voice: waveform.voice } : {}),
    textPanel: allowed.includes('text') ? waveform.textPanel : null,
    visualDisplay: allowed.includes('visual') ? waveform.visualDisplay : null,
    knowledge: allowed.includes('knowledge') && waveform.knowledge === true,
    ...(waveform.practicePlugins ? { practicePlugins: waveform.practicePlugins } : {}) };
}

export async function readPluginPolicy(tx: VoiceTransaction, ownerUid: string, waveformId: string) {
  return view(policy(await tx.get(pluginPolicyPath({ ownerUid, waveformId }))));
}

export async function requirePluginRevision(tx: VoiceTransaction, ownerUid: string, waveformId: string, revision?: string) {
  if (revision === undefined) return;
  const current = await readPluginPolicy(tx, ownerUid, waveformId);
  if (current.revision !== revision) throw new PluginAccessError('Plugin settings changed. Try again.', 409);
}
