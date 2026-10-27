import { accountServer } from '../../../lib/account-runtime';
import { curatedDemo } from '../../../lib/curated-demo-runtime';
import { FRANKLIN_DEMO_ID } from '../../../lib/public-voice-identity';
import { isAllowedRequest } from '../../../lib/request-origin';
import { localAppOrigin } from '../../../lib/local-app-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const response = await accountServer.waveformGET(request);
  if (![401, 404].includes(response.status)) return response;
  const params = new URL(request.url).searchParams;
  if (params.toString() !== `id=${FRANKLIN_DEMO_ID}` || !isAllowedRequest(request, false,
    localAppOrigin() ? undefined : process.env.FLOWPATH_PUBLIC_ORIGIN, process.env.FLOWPATH_TRUSTED_PROXY_HOST)) return response;
  try {
    const row = await curatedDemo.published();
    if (!row) return response;
    const { id, name, accentColor, profilePhoto, textPanel } = row.waveform;
    return Response.json({ publicDemo: true, waveform: { id, name, accentColor, profilePhoto, ...(textPanel ? { textPanel } : {}) } },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'This demonstration is unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export const PUT = accountServer.waveformPUT;
