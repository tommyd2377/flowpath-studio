import { getPaidApi, paidEnabled } from '@/lib/paid-runtime';
import { paidResponse } from '@/lib/paid-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => paidEnabled ? getPaidApi().publishedGET(request) : paidResponse({ error: 'This waveform is unavailable.' }, 404);
