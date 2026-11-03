import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { accountServer } from './account-runtime';
import { requestWaveformId } from './account-server';
import { applicationDatabase } from './application-database';
import { localAppOrigin } from './local-app-runtime';
import { accountSessionId, activeAccountSession, ACCOUNT_SESSION_COLLECTION } from './production-account-session';
import { createPluginAccess, PluginAccessError, readPluginPolicy, projectPluginPrompt, type ProtectedPlugin } from './plugin-access';
import { createPluginAccessServer, pluginAccessToken } from './plugin-access-server';
import { updateRunningPluginVoice } from './plugin-voice-update';
import { creationContentDigest } from './creation-safety';
import type { WaveformPrompt } from './voice-config';
import { isAllowedRequest } from './request-origin';
import { FRANKLIN_DEMO_ID, publicVoiceOwner } from './public-voice-identity';
import { curatedVisitorVoice } from './curated-demo';

const publicOrigin = () => localAppOrigin() ? undefined : process.env.FLOWPATH_PUBLIC_ORIGIN;
export const localPluginAccess = () => !!localAppOrigin() || process.env.NODE_ENV === 'development' && process.env.FLOWPATH_ACCOUNT_MODE === 'local';
const hash = (id: string) => createHash('sha256').update(id).digest('hex');

export async function pluginAudienceProjection<T extends Pick<WaveformPrompt, 'textPanel' | 'visualDisplay'>>(ownerUid: string, waveformId: string, waveform: T) {
  if (!localPluginAccess()) return { waveform, revision: undefined, locked: [] as ProtectedPlugin[] };
  const { protectedPlugins: ids, revision } = await applicationDatabase().transaction(tx => readPluginPolicy(tx, ownerUid, waveformId));
  return { waveform: { ...waveform, ...(ids.includes('text') ? { textPanel: null } : {}), ...(ids.includes('visual') ? { visualDisplay: null } : {}) },
    revision,
    locked: ids.filter(id => id === 'text' && waveform.textPanel || id === 'visual' && waveform.visualDisplay) };
}

async function ownerAccess(request: Request, id: string, management = false) {
  const identity = await accountServer.resolveIdentity(request);
  const resolved = await accountServer.resolveVoiceWaveform(request, id, management ? 'cleanup' : 'voice');
  if (!identity || !resolved || identity.owner.uid !== resolved.ownerUid) throw new PluginAccessError('This waveform is unavailable.', 404);
  const scope = { ownerUid: resolved.ownerUid, waveformId: id, accountUid: identity.owner.uid, sessionId: identity.accountSessionId ?? accountSessionId(identity.cookie) };
  const database = applicationDatabase();
  const access = createPluginAccess(database, {
    authorize: async (tx, actor) => {
      if (actor !== scope || !await identity.isCurrent() || identity.mode === 'firebase'
        && !activeAccountSession(await tx.get(`${ACCOUNT_SESSION_COLLECTION}/${scope.sessionId}`), scope.ownerUid)) throw new PluginAccessError('Sign in again.');
    },
    assertPolicyMutable: async tx => {
      const global = await tx.get('voiceAdmission/global');
      for (const id of Object.keys((global?.active ?? {}) as object)) {
        const call = await tx.get(`voiceConversations/${id}`) ?? await tx.get(`paidTestSegments/${hash(id)}`);
        if (!call || call.waveformId === scope.waveformId) throw new PluginAccessError('End the active conversation before changing plugin protection.', 409);
      }
    },
  });
  return { scope, access, resolved, callOwnerUid: scope.ownerUid, callSessionId: scope.sessionId, digest: creationContentDigest(resolved.waveform), token: pluginAccessToken(request, id, !!publicOrigin()) };
}

async function curatedAccess(request: Request, id: string) {
  const visitor = id === FRANKLIN_DEMO_ID ? publicVoiceOwner(request, id) : null;
  if (!visitor) throw new PluginAccessError('Start the demonstration before unlocking its plugin.', 409);
  const { curatedDemo } = await import('./curated-demo-runtime');
  const { demoAccess } = await import('./demo-access-runtime');
  const row = await curatedDemo.published();
  if (!row || !await demoAccess.allowed(request)) throw new PluginAccessError('Unlock the demonstration first.');
  const identity = await accountServer.resolveIdentity(request);
  const accountId = identity && (identity.accountSessionId ?? accountSessionId(identity.cookie));
  const scope = { ownerUid: row.ownerUid, waveformId: id, accountUid: identity?.owner.uid,
    sessionId: JSON.stringify([visitor.demoVisitorId ?? visitor.accountSessionId, accountId]) };
  const voiceOwner = { ...visitor, contentDigest: row.contentDigest, demoSource: { ownerUid: row.ownerUid } };
  const access = createPluginAccess(applicationDatabase(), {
    authorize: async (tx, actor, management) => {
      if (management || actor !== scope || identity && (!await identity.isCurrent() || identity.mode === 'firebase'
        && !activeAccountSession(await tx.get(`${ACCOUNT_SESSION_COLLECTION}/${accountId}`), identity.owner.uid))) throw new PluginAccessError('Plugin access is unavailable.');
      await curatedDemo.requireVoice(tx, voiceOwner);
    },
    assertPolicyMutable: async () => { throw new PluginAccessError('Sign in as the waveform owner.'); },
  });
  const resolved = { waveform: curatedVisitorVoice(row.waveform), isCurrent: async () => !!await curatedDemo.published() };
  return { scope, access, resolved, callOwnerUid: visitor.ownerUid, callSessionId: visitor.accountSessionId, digest: row.contentDigest,
    token: pluginAccessToken(request, id, !!publicOrigin()) };
}

export async function curatedPluginPlayback<T extends WaveformPrompt>(request: Request, ownerUid: string, id: string, source: T) {
  const masked = await pluginAudienceProjection(ownerUid, id, source);
  if (!localPluginAccess() || !masked.locked.length || !publicVoiceOwner(request, id)) return { ...masked, expiresAt: undefined as number | undefined };
  try {
    const { access, scope, token } = await curatedAccess(request, id);
    if (scope.ownerUid !== ownerUid) return { ...masked, expiresAt: undefined };
    const state = await access.playback(scope, token);
    return { waveform: { ...source, textPanel: state.allowed.includes('text') ? source.textPanel : null },
      revision: state.revision, locked: state.locked.filter(plugin => plugin === 'text' && source.textPanel), expiresAt: state.expiresAt };
  } catch { return { ...masked, expiresAt: undefined }; }
}

export async function ownerPluginPlayback(request: Request, id: string, waveform?: WaveformPrompt, displayOnly = false) {
  const { access, scope, token, resolved } = await ownerAccess(request, id, displayOnly);
  const source = displayOnly ? resolved.waveform : waveform ?? resolved.waveform;
  const digest = creationContentDigest(source);
  if (digest !== creationContentDigest(resolved.waveform)) throw new PluginAccessError('The waveform changed. Try again.', 409);
  let state = await access.playback(scope, token);
  if (displayOnly && state.expiresAt !== undefined) {
    try {
      const approved = await accountServer.resolveVoiceWaveform(request, id, 'voice');
      if (!approved || creationContentDigest(approved.waveform) !== digest || !await approved.isCurrent()) state = await access.playback(scope);
    } catch { state = await access.playback(scope); }
  }
  const locked = state.locked.filter(plugin => plugin === 'knowledge' || plugin === 'text' && source.textPanel || plugin === 'visual' && source.visualDisplay?.images.length);
  return { ...state, locked, waveform: projectPluginPrompt(source, state.allowed) };
}

export async function withKnowledgeAccess<T>(request: Request, id: string, work: () => Promise<T>) {
  if (!localPluginAccess()) return work();
  const { access, scope, token, resolved } = await ownerAccess(request, id, true);
  const before = await access.playback(scope, token);
  if (before.revision === 'off') return access.read(scope, ['knowledge'], token, work, request.signal);
  const approved = await accountServer.resolveVoiceWaveform(request, resolved.waveform.id, 'voice');
  if (!approved) throw new PluginAccessError('This waveform is unavailable.');
  return access.read(scope, ['knowledge'], token, async () => {
    const result = await work();
    if (!await approved.isCurrent()) throw new PluginAccessError('Waveform approval changed.');
    return result;
  }, request.signal);
}

export async function pluginAccessRequest(request: Request) {
  if (!localPluginAccess()) return new Response(null, { status: 404 });
  if (!isAllowedRequest(request, request.method !== 'GET', publicOrigin(), process.env.FLOWPATH_TRUSTED_PROXY_HOST)) return new Response(null, { status: 403 });
  try {
    const id = requestWaveformId(request);
    if (!id) throw new PluginAccessError('Choose a waveform.', 400);
    const query = new URL(request.url).searchParams;
    const playback = request.method === 'GET' && query.has('playback');
    const curated = query.get('audience') === 'curated';
    if (curated && !playback && request.method !== 'POST') throw new PluginAccessError('Sign in as the waveform owner.');
    if (curated && playback) {
      const { curatedDemo } = await import('./curated-demo-runtime');
      const row = id === FRANKLIN_DEMO_ID ? await curatedDemo.published() : null;
      if (!row) throw new PluginAccessError('This waveform is unavailable.', 404);
      const view = await curatedPluginPlayback(request, row.ownerUid, id, curatedVisitorVoice(row.waveform));
      return Response.json({ locked: view.locked, expiresAt: view.expiresAt, textPanel: view.waveform.textPanel, visualDisplay: null },
        { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const context = curated ? await curatedAccess(request, id) : await ownerAccess(request, id, request.method !== 'POST');
    const { scope, access, resolved, callOwnerUid, callSessionId } = context;
    const installed: ProtectedPlugin[] = curated ? [] : ['knowledge'];
    if (resolved.waveform.textPanel) installed.push('text');
    if (!curated && resolved.waveform.visualDisplay?.images.length) installed.push('visual');
    if (playback) {
      const view = await ownerPluginPlayback(request, id, undefined, true);
      return Response.json({ locked: view.locked.filter(plugin => installed.includes(plugin)), expiresAt: view.expiresAt,
        textPanel: view.waveform.textPanel, visualDisplay: view.waveform.visualDisplay }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const server = createPluginAccessServer({
      access, publicOrigin: publicOrigin(), trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST,
      resolve: async () => ({ identity: scope, installed }),
      activate: async (_request, _scope, token, _ids, sessionId) => {
        if (!sessionId) return;
        const database = applicationDatabase();
        const path = `voiceConversations/${sessionId}`;
        const state = await access.playback(scope, token);
        const key = process.env.OPENAI_API_KEY;
        if (!localAppOrigin() || process.env.FLOWPATH_LIVE_ENABLED !== '1' || !key || !state.expiresAt) throw new PluginAccessError('The running conversation could not be updated.', 409);
        const authorize = async () => {
          const current = curated ? await curatedAccess(request, id) : await ownerAccess(request, id);
          const currentState = await access.playback(scope, token);
          const call = await database.transaction(tx => tx.get(path));
          if (!call || call.ownerUid !== callOwnerUid || call.waveformId !== id || call.accountSessionId !== callSessionId
            || call.canceled || call.state !== 'active' || typeof call.providerId !== 'string'
            || Math.min(Number(call.expiresAt), Number(call.pluginExpiresAt ?? Infinity)) <= Date.now()
            || call.pluginRevision !== currentState.revision || call.contentDigest !== current.digest) {
            throw new PluginAccessError('The conversation changed. Try again.', 409);
          }
          const { knowledgeStore } = await import('./knowledge-runtime');
          const knowledge = !curated && currentState.allowed.includes('knowledge') && await knowledgeStore.enabled({ uid: scope.ownerUid, waveformId: id, isCurrent: current.resolved.isCurrent });
          return { providerId: call.providerId, revision: currentState.revision, waveform: projectPluginPrompt({ ...current.resolved.waveform, knowledge }, currentState.allowed) };
        };
        await authorize();
        await database.transaction(async tx => {
          const row = await tx.get(path);
          if (row?.state !== 'active' || row.canceled || row.accountSessionId !== callSessionId) throw new PluginAccessError('The conversation ended.', 409);
          if (row.pluginUpdating) throw new PluginAccessError('A plugin is already being unlocked in this conversation.', 409);
          // A failed update can still have delivered context. Keep the earlier expiry in force.
          tx.set(path, { ...row, pluginUpdating: true, pluginExpiresAt: Math.min(Number(row.pluginExpiresAt ?? Infinity), state.expiresAt!) });
        });
        try {
          await updateRunningPluginVoice({ authorize, signal: request.signal, socketFactory: providerId => new WebSocket(
            `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(providerId)}/attach`,
            { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 5000, maxPayload: 262144 }) });
        } catch (error) {
          // The provider may have applied the change before the acknowledgment was lost.
          const { getProductionVoiceServer } = await import('./production-voice-runtime');
          await getProductionVoiceServer().cancelReservation(sessionId, callOwnerUid, id);
          throw error;
        } finally {
          await database.transaction(async tx => {
            const row = await tx.get(path);
            if (row?.pluginUpdating) tx.set(path, { ...row, pluginUpdating: false });
          });
        }
      },
    });
    if (request.method === 'PUT') return server.PUT(request);
    if (request.method === 'POST') return server.POST(request);
    return server.GET(request);
  } catch (error) {
    return Response.json({ error: error instanceof PluginAccessError ? error.message : 'Plugin access is temporarily unavailable.' },
      { status: error instanceof PluginAccessError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
