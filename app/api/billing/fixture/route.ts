import { getPaidApi, paidFixtures } from '@/lib/paid-runtime';
import { paidResponse } from '@/lib/paid-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => paidFixtures ? getPaidApi().fixtureGET(request) : paidResponse({ error: 'Unavailable.' }, 404);
export const POST = (request: Request) => paidFixtures ? getPaidApi().fixturePOST(request) : paidResponse({ error: 'Unavailable.' }, 404);
