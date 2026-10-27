import { createVoiceServer } from '../../../lib/voice-server';
import { accountServer } from '../../../lib/account-runtime';
import { getProductionVoiceServer } from '../../../lib/production-voice-runtime';
import { productionVoicePolicy } from '../../../lib/production-voice-store';
import { withPublicVoiceVisitor } from '../../../lib/public-voice-identity';
import { localAppOrigin } from '../../../lib/local-app-runtime';
import { paidEnabled } from '../../../lib/paid-runtime';
import { withWaveformKnowledge, resolveDemoVisitor } from '../../../lib/knowledge-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Preserve the concurrency and failed-cleanup guard across local development reloads.
const state = globalThis as typeof globalThis & { flowpathVoiceServer?: ReturnType<typeof createVoiceServer> };
const resolveWaveform = withWaveformKnowledge;
const resolveAdmin = accountServer.resolveAdmin;
const fullLocal = !!localAppOrigin();
const server = process.env.NODE_ENV === 'production' || fullLocal ? getProductionVoiceServer(resolveWaveform, resolveAdmin, resolveDemoVisitor)
  : state.flowpathVoiceServer ??= createVoiceServer({ resolveWaveform, resolveAdmin });

const unpaid = (request: Request) => paidEnabled && new URL(request.url).searchParams.has('waveformId');
const paidRequired = () => Response.json({ error: 'Choose a payer through the paid waveform page.', enabled: false, message: 'Choose a payer through the paid waveform page.' }, { status: 402 });
const adminRequest = async (request: Request) => (await resolveAdmin(request))?.testing === true;
export const GET = async (request: Request) => unpaid(request) && !await adminRequest(request) ? paidRequired() : withPublicVoiceVisitor(request, server.GET, {
  enabled: (process.env.NODE_ENV === 'production' || fullLocal) && !!productionVoicePolicy(process.env)?.publicDemoSeconds,
  local: fullLocal,
  publicOrigin: process.env.FLOWPATH_PUBLIC_ORIGIN,
  trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST,
});
export const POST = async (request: Request) => unpaid(request) && !await adminRequest(request) ? paidRequired() : server.POST(request);
export const DELETE = server.DELETE;

export const PATCH = server.PATCH;
