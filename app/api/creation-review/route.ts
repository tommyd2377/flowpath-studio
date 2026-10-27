import { demoAccess } from '../../../lib/demo-access-runtime';
import { creationApi } from '../../../lib/creation-api-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = creationApi.GET;
export const POST = async (request: Request) => await demoAccess.allowed(request) ? creationApi.POST(request)
  : Response.json({ error: 'Enter the demo code first.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
