import { createVoiceServer } from '../../../lib/voice-server';
import { accountServer } from '../../../lib/account-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Preserve the concurrency and failed-cleanup guard across local development reloads.
const state = globalThis as typeof globalThis & { flowpathVoiceServer?: ReturnType<typeof createVoiceServer> };
const server = state.flowpathVoiceServer ??= createVoiceServer({
  resolveWaveform: (request, id) => accountServer.resolveVoiceWaveform(request, id),
});

export const GET = server.GET;
export const POST = server.POST;
export const DELETE = server.DELETE;
