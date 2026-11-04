import { pluginAudienceProjection } from './plugin-access-runtime';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createVoiceServer } from './voice-server';
import { createPaidVoiceStore } from './paid-voice-store';
import { getPaidApi, getPaidStore, paidFixtures, paidVoiceReady } from './paid-runtime';
import { productionVoicePolicy, VoiceAdmissionError } from './production-voice-store';
import { scheduleProductionVoiceDeadline } from './voice-deadline';
import { accountServer } from './account-runtime';
import { configuredPublicOrigin } from './request-origin';
import { creationContentDigest } from './creation-safety';

const shared = globalThis as typeof globalThis & { flowpathPaidVoiceServer?: ReturnType<typeof createVoiceServer> };
export function getPaidVoiceServer() {
  const store = getPaidStore();
  const created = new Map<string, number>();
  class FixtureSocket extends EventEmitter {
    readyState: 0 | 1 | 2 | 3 = WebSocket.OPEN;
    constructor(readonly id: string) { super(); queueMicrotask(() => { this.emit('open');
      setTimeout(() => this.emit('message', Buffer.from(JSON.stringify({ type: 'session.started' }))), 10).unref(); }); }
    send(data: string) {
      if (JSON.parse(data).type === 'session.close') queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({
        type: 'session.closed', session: { id: this.id }, usage: { seconds: Math.max(0, (Date.now() - (created.get(this.id) ?? Date.now())) / 1000) },
      }))));
    }
    terminate() { this.readyState = WebSocket.CLOSED; }
  }
  return shared.flowpathPaidVoiceServer ??= createVoiceServer({
    enabled: paidVoiceReady,
    requireSettlement: true,
    publicOrigin: configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN), trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST,
    ...(paidFixtures ? {
      apiKey: () => 'synthetic-provider-fixture',
      requestProvider: (async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const id = `fixture_${randomUUID()}`; created.set(id, Date.now());
        return Response.json({ session: { id }, transport: { type: 'webrtc', sdp: body.transport.sdp } }, { status: 201 });
      }) as typeof fetch,
      socketFactory: (url: string) => new FixtureSocket(url.split('/').at(-2)!),
    } : { apiKey: () => undefined }),
    connected: id => store.updateSegment(id, 'connected').then(() => undefined),
    resolveAdmin: async request => {
      const identity = await accountServer.resolveIdentity(request);
      const id = new URL(request.url).searchParams.get('waveformId');
      return identity?.owner.role === 'admin' && id && await accountServer.resolveVoiceWaveform(request, id)
        ? { uid: identity.owner.uid, accountSessionId: identity.accountSessionId, isCurrent: identity.isCurrent } : null;
    },
    resolveWaveform: async (request, id) => {
      const actor = await getPaidApi().actor(request);
      const preview = new URL(request.url).searchParams.get('preview') === 'draft';
      const publication = await store.publication(id);
      if (preview && publication?.ownerUid !== actor.uid) return null;
      if (!publication || request.method !== 'DELETE' && !publication.published && publication.ownerUid !== actor.uid) return null;
      const header = request.headers.get('X-FlowPath-Payer');
      if (header !== 'creator' && header !== 'self') throw new VoiceAdmissionError('Choose who pays before starting.', 402);
      if (preview && header !== 'self') throw new VoiceAdmissionError('Draft preview requires your own balance.', 403);
      const waveform = preview ? publication.draft ?? publication.waveform : publication.waveform;
      const projected = request.method === 'DELETE' ? { waveform, revision: undefined } : await pluginAudienceProjection(publication.ownerUid, id, waveform);
      const identity = actor.uid ? await accountServer.resolveIdentity(request) : null;
      return { ownerUid: actor.uid ? `account:${actor.uid}` : actor.visitorId, accountSessionId: actor.accountSessionId ?? actor.visitorId,
        waveform: { ...projected.waveform, practicePlugins: [] }, pluginRevision: projected.revision, paid: { actor, choice: header, ...(preview ? { preview: true } : {}), expectedContentDigest: creationContentDigest(waveform) }, isCurrent: () => identity?.isCurrent() ?? !actor.uid };
    },
    production: { store: createPaidVoiceStore(store), policy: () => paidFixtures ? { globalConcurrency: 3, globalDailySeconds: 9_000,
      ownerDailySeconds: 3_600, access: 'signed-in', allowedUids: [] } : productionVoicePolicy(process.env),
      scheduleDeadline: async (id, expiresAt) => { if (!paidFixtures) await scheduleProductionVoiceDeadline(id, expiresAt); } },
  });
}
export async function cancelPaidOwnerVoice(uid: string) {
  const segment = await getPaidStore().activeFor(uid);
  if (!segment) return true;
  const server = getPaidVoiceServer();
  // The existing account-change gate holds the old identity until upstream closure is confirmed.
  return server.cancelReservation(segment.id, segment.viewer, segment.waveformId);
}
