import { getPaidApi, paidEnabled } from '@/lib/paid-runtime';
import { paidResponse } from '@/lib/paid-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => paidEnabled ? getPaidApi().billingGET(request) : paidResponse({ enabled: false });
