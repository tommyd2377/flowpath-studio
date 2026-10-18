import { createVoiceServer } from '../../../lib/voice-server';
import { accountServer } from '../../../lib/account-runtime';
import { getProductionVoiceServer } from '../../../lib/production-voice-runtime';
import { productionVoicePolicy } from '../../../lib/production-voice-store';
import { withPublicVoiceVisitor } from '../../../lib/public-voice-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Preserve the concurrency and failed-cleanup guard across local development reloads.
const state = globalThis as typeof globalThis & { flowpathVoiceServer?: ReturnType<typeof createVoiceServer> };
const resolveWaveform = (request: Request, id: string) => accountServer.resolveVoiceWaveform(request, id);
const server = process.env.NODE_ENV === 'production' ? getProductionVoiceServer(resolveWaveform)
  : state.flowpathVoiceServer ??= createVoiceServer({ resolveWaveform });

export const GET = (request: Request) => withPublicVoiceVisitor(request, server.GET, {
  enabled: process.env.NODE_ENV === 'production' && !!productionVoicePolicy(process.env)?.publicDemoSeconds,
  publicOrigin: process.env.FLOWPATH_PUBLIC_ORIGIN,
  trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST,
});
export const POST = server.POST;
export const DELETE = server.DELETE;
