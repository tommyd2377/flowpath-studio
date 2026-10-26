import { paidEnabled } from '@/lib/paid-runtime';
import { getPaidVoiceServer } from '@/lib/paid-voice-runtime';
import { paidResponse } from '@/lib/paid-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const unavailable = () => paidResponse({ error: 'Paid voice is not enabled.' }, 503);
export const GET = (request: Request) => paidEnabled ? getPaidVoiceServer().GET(request) : unavailable();
export const POST = (request: Request) => paidEnabled ? getPaidVoiceServer().POST(request) : unavailable();
export const DELETE = (request: Request) => paidEnabled ? getPaidVoiceServer().DELETE(request) : unavailable();
