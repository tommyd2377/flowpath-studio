import { getPaidApi, paidEnabled } from '@/lib/paid-runtime';
import { paidResponse } from '@/lib/paid-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => paidEnabled ? getPaidApi().checkoutPOST(request) : paidResponse({ error: 'Purchases are not enabled.' }, 503);
