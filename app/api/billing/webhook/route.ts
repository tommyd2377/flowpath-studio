import { getPaidApi, paidEnabled, paidFixtures } from '@/lib/paid-runtime';
import { paidResponse } from '@/lib/paid-http';
import { isAllowedRequest } from '@/lib/request-origin';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => !isAllowedRequest(request, false, process.env.FLOWPATH_PUBLIC_ORIGIN, process.env.FLOWPATH_TRUSTED_PROXY_HOST)
  ? paidResponse({ error: 'This webhook host is not allowed.' }, 403) : paidEnabled && !paidFixtures ? getPaidApi().stripe?.webhook(request)
  ?? paidResponse({ error: 'Sandbox webhook is not configured.' }, 503) : paidResponse({ error: 'Unavailable.' }, 404);
