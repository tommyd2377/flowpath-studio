import { handleProductionVoiceExpiry } from '../../../lib/voice-deadline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleProductionVoiceExpiry(request, async id => {
    // Identity and the bounded session ID are validated before any store/key access.
    const { expireProductionVoiceReservation } = await import('../../../lib/production-voice-runtime');
    return expireProductionVoiceReservation(id);
  });
}
