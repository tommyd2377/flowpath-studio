import { localPluginAccess, ownerPluginPlayback, curatedPluginPlayback } from '../../../lib/plugin-access-runtime';
import { accountServer } from '../../../lib/account-runtime';
import { curatedDemo } from '../../../lib/curated-demo-runtime';
import { curatedVisitorDisplay, curatedVisitorVoice } from '../../../lib/curated-demo';
import { FRANKLIN_DEMO_ID } from '../../../lib/public-voice-identity';
import { isAllowedRequest } from '../../../lib/request-origin';
import { localAppOrigin } from '../../../lib/local-app-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const response = await accountServer.waveformGET(request);
  if (response.ok && localPluginAccess() && request.headers.get('X-FlowPath-View') === 'playback') {
    const body = await response.json();
    const waveform = body.waveform;
    if (!waveform) return Response.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
    try {
      const view = await ownerPluginPlayback(request, waveform.id, waveform, true);
      return Response.json({ waveform: { id: waveform.id, name: waveform.name, accentColor: waveform.accentColor, profilePhoto: waveform.profilePhoto,
        textPanel: view.waveform.textPanel, visualDisplay: view.waveform.visualDisplay }, lockedPlugins: view.locked, pluginExpiresAt: view.expiresAt },
      { headers: { 'Cache-Control': 'private, no-store' } });
    } catch { return new Response(null, { status: 503 }); }
  }
  if (![401, 404].includes(response.status)) return response;
  const params = new URL(request.url).searchParams;
  if (params.toString() !== `id=${FRANKLIN_DEMO_ID}` || !isAllowedRequest(request, false,
    localAppOrigin() ? undefined : process.env.FLOWPATH_PUBLIC_ORIGIN, process.env.FLOWPATH_TRUSTED_PROXY_HOST)) return response;
  try {
    const row = await curatedDemo.published();
    if (!row) return response;
    const view = await curatedPluginPlayback(request, row.ownerUid, row.waveform.id, curatedVisitorVoice(row.waveform));
    return Response.json({ publicDemo: true, waveform: { ...curatedVisitorDisplay(row.waveform), textPanel: view.waveform.textPanel },
      ...(view.revision === undefined ? {} : { lockedPlugins: view.locked, pluginExpiresAt: view.expiresAt }) },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'This demonstration is unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export const PUT = (request: Request) => accountServer.waveformPUT(request);
export const POST = (request: Request) => accountServer.waveformPUT(request, true);
