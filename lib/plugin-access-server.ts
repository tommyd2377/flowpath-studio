import { createHash } from 'node:crypto';
import { readBody } from './account-server';
import { isAllowedRequest } from './request-origin';
import { PLUGINS } from './plugin-contract';
import { PluginAccessError, type createPluginAccess, type PluginAccessScope, type ProtectedPlugin } from './plugin-access';

type Access = ReturnType<typeof createPluginAccess>;
type Scope = { identity: PluginAccessScope; installed: ProtectedPlugin[] };
type Options = {
  access: Access;
  /** Must derive all identity/ownership/audience fields server-side, preserving private Knowledge rules. */
  resolve(request: Request, management: boolean): Promise<Scope | null>;
  /** Required server-owned update path; must authorize the exact voice session and await its update acknowledgment. */
  activate(request: Request, scope: Scope, token: string, plugins: ProtectedPlugin[], sessionId?: string): Promise<void>;
  publicOrigin?: string; trustedProxyHost?: string;
};
const json = (body: object, status = 200, headers?: HeadersInit) => Response.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', ...headers },
});
function cookieName(waveformId: string, secure: boolean) {
  const suffix = createHash('sha256').update(waveformId).digest('hex').slice(0, 24);
  return `${secure ? '__Host-flowpath_plugin' : 'flowpath_local_plugin'}_${suffix}`;
}
export function pluginAccessToken(request: Request, waveformId: string, secure: boolean) {
  const name = cookieName(waveformId, secure);
  const matches = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  const token = matches.length === 1 ? matches[0].slice(name.length + 1) : '';
  return /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}

export function clearPluginGrantCookies(request: Request, response: Response) {
  if (!response.ok) return response;
  const names = new Set((request.headers.get('cookie') ?? '').split(';')
    .map(part => part.trim().split('=', 1)[0])
    .filter(name => /^(?:__Host-flowpath_plugin|flowpath_local_plugin)_[a-f0-9]{24}$/.test(name)));
  if (!names.size) return response;
  const headers = new Headers(response.headers);
  for (const name of [...names].slice(0, 32)) {
    headers.append('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${name.startsWith('__Host-') ? '; Secure' : ''}`);
  }
  return new Response(response.body, { status: response.status, headers });
}

/** Injectable, offline-testable HTTP boundary. No app route or real storage is activated by importing this module. */
export function createPluginAccessServer(options: Options) {
  const secure = !!options.publicOrigin;
  const handle = (management: boolean, work: (request: Request, scope: Scope) => Promise<Response>) => async (request: Request) => {
    try {
      if (!isAllowedRequest(request, request.method !== 'GET', options.publicOrigin, options.trustedProxyHost)) {
        throw new PluginAccessError('Only requests from this application are allowed.');
      }
      const scope = await options.resolve(request, management);
      if (!scope) throw new PluginAccessError('This waveform is unavailable.');
      return await work(request, scope);
    } catch (error) {
      return error instanceof PluginAccessError ? json({ error: error.message }, error.status,
        error.status === 429 ? { 'Retry-After': '60' } : undefined) : json({ error: 'Plugin access is temporarily unavailable.' }, 503);
    }
  };
  return {
    GET: handle(true, async (_request, scope) => json(await options.access.settings(scope.identity))),
    PUT: handle(true, async (request, scope) => {
      let body: Record<string, unknown>;
      try { body = await readBody(request, 1024); } catch { throw new PluginAccessError('Use valid access settings.', 400); }
      if (Object.keys(body).some(key => !['revision', 'protectedPlugins', 'code'].includes(key)) || typeof body.revision !== 'string'
        || !Array.isArray(body.protectedPlugins) || body.protectedPlugins.some(id => !scope.installed.includes(id))
        || body.code !== undefined && typeof body.code !== 'string') throw new PluginAccessError('Choose applied plugins.', 400);
      return json(await options.access.configure(scope.identity, { revision: body.revision,
        protectedPlugins: body.protectedPlugins as ProtectedPlugin[], ...(body.code === undefined ? {} : { code: body.code as string }) }));
    }),
    POST: handle(false, async (request, scope) => {
      let body: Record<string, unknown>;
      try { body = await readBody(request, 1024); } catch { throw new PluginAccessError('Enter a valid access code.', 400); }
      if (Object.keys(body).some(key => !['code', 'plugins', 'sessionId'].includes(key)) || typeof body.code !== 'string'
        || !Array.isArray(body.plugins) || !body.plugins.length || body.plugins.some(id => !scope.installed.includes(id)
          || !PLUGINS.some(plugin => plugin.id === id))
        || body.sessionId !== undefined && (typeof body.sessionId !== 'string'
          || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.sessionId))) {
        throw new PluginAccessError('Choose a valid plugin and conversation.', 400);
      }
      const ids = body.plugins as ProtectedPlugin[];
      const { token, expiresAt } = await options.access.unlock(scope.identity, body.code, ids, pluginAccessToken(request, scope.identity.waveformId, secure));
      await options.activate(request, scope, token, ids, body.sessionId as string | undefined);
      await options.access.check(scope.identity, ids, token);
      return json({ allowedPlugins: ids, expiresAt }, 200, { 'Set-Cookie': `${cookieName(scope.identity.waveformId, secure)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800${secure ? '; Secure' : ''}` });
    }),
  };
}
