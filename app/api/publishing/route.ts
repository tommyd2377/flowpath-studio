import { getPaidApi, paidEnabled } from '@/lib/paid-runtime';
import { paidResponse } from '@/lib/paid-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => paidEnabled ? getPaidApi().publishingGET(request) : paidResponse({ enabled: false });
export const POST = (request: Request) => paidEnabled ? getPaidApi().publishingPOST(request) : paidResponse({ error: 'Publishing is not enabled.' }, 503);
