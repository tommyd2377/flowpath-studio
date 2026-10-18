import { createVoiceServer } from '../../../lib/voice-server';
import { accountServer } from '../../../lib/account-runtime';
import { getProductionVoiceServer } from '../../../lib/production-voice-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Preserve the concurrency and failed-cleanup guard across local development reloads.
const state = globalThis as typeof globalThis & { flowpathVoiceServer?: ReturnType<typeof createVoiceServer> };
const resolveWaveform = (request: Request, id: string) => accountServer.resolveVoiceWaveform(request, id);
const server = process.env.NODE_ENV === 'production' ? getProductionVoiceServer(resolveWaveform)
  : state.flowpathVoiceServer ??= createVoiceServer({ resolveWaveform });

export const GET = server.GET;
export const POST = server.POST;
export const DELETE = server.DELETE;
