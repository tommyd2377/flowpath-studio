import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { configuredFirebaseProjectId } from './firebase-accounts';
import { configuredProxyHost, configuredPublicOrigin, isAllowedPublicHost } from './request-origin';
import { VOICE_SESSION_SECONDS } from './voice-config';

type DeadlineConfig = { endpoint: string; queuePath: string; serviceAccount: string; trustedProxyHost?: string };
type Identity = { aud?: string; email?: string; email_verified?: boolean };
type Task = {
  task: {
    name: string; scheduleTime: string; dispatchDeadline: string;
    httpRequest: {
      url: string; httpMethod: 'POST'; headers: Record<string, string>; body: string;
      oidcToken: { audience: string; serviceAccountEmail: string };
    };
  };
};
type Dependencies = {
  createTask: (url: string, task: Task) => Promise<void>;
  verifyIdentity: (token: string, audience: string) => Promise<Identity | undefined>;
  now?: () => number;
};
const validId = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const json = (status: number) => Response.json({ ok: status === 200 }, {
  status, headers: { 'Cache-Control': 'no-store' },
});

export function voiceDeadlineConfig(env: Record<string, string | undefined>): DeadlineConfig | null {
  const origin = configuredPublicOrigin(env.FLOWPATH_PUBLIC_ORIGIN);
  const project = configuredFirebaseProjectId(env);
  const location = env.FLOWPATH_VOICE_TASKS_LOCATION ?? '';
  const queue = env.FLOWPATH_VOICE_TASKS_QUEUE ?? '';
  const serviceAccount = env.FLOWPATH_VOICE_TASKS_SERVICE_ACCOUNT ?? '';
  const trustedProxyHost = configuredProxyHost(env.FLOWPATH_TRUSTED_PROXY_HOST);
  if (!origin || !project || !/^[a-z]+-[a-z0-9]+\d$/.test(location)
    || env.FLOWPATH_TRUSTED_PROXY_HOST !== undefined && !trustedProxyHost
    || !/^[A-Za-z0-9_-]{1,100}$/.test(queue)
    || !/^[a-zA-Z0-9._-]+$/.test(serviceAccount.split('@')[0])
    || serviceAccount.split('@')[1] !== `${project}.iam.gserviceaccount.com`
    || serviceAccount.split('@').length !== 2) return null;
  return {
    endpoint: `${origin}/api/voice-expiry`, queuePath: `projects/${project}/locations/${location}/queues/${queue}`, serviceAccount,
    trustedProxyHost,
  };
}

async function sessionBody(request: Request): Promise<string> {
  const length = request.headers.get('content-length');
  if (!request.body || request.headers.get('content-type')?.split(';')[0] !== 'application/json'
    || length && (!/^\d+$/.test(length) || Number(length) > 128)) throw new Error('Invalid task');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 5_000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 128) throw new Error('Invalid task');
      chunks.push(value);
    }
    if (timedOut || request.signal.aborted) throw new Error('Invalid task');
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || Object.keys(body).length !== 1 || !validId(body.sessionId)) throw new Error('Invalid task');
    return body.sessionId;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** The queue survives process restarts. It only retries closure, never paid creation. */
export function createVoiceDeadline(config: DeadlineConfig | null, dependencies: Dependencies) {
  const now = dependencies.now ?? Date.now;
  return {
    async schedule(id: string, expiresAt: number) {
      if (!config || !validId(id) || !Number.isSafeInteger(expiresAt)
        || expiresAt <= now() || expiresAt > now() + VOICE_SESSION_SECONDS * 1000) throw new Error('Voice deadline is unavailable');
      await dependencies.createTask(`https://cloudtasks.googleapis.com/v2/${config.queuePath}/tasks`, {
        task: {
          name: `${config.queuePath}/tasks/voice-${id.toLowerCase()}`,
          scheduleTime: new Date(expiresAt).toISOString(), dispatchDeadline: '30s',
          httpRequest: {
            url: config.endpoint, httpMethod: 'POST', headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify({ sessionId: id })).toString('base64'),
            oidcToken: { serviceAccountEmail: config.serviceAccount, audience: config.endpoint },
          },
        },
      });
    },
    async handle(request: Request, expire: (id: string) => Promise<boolean>) {
      if (!config) return json(503);
      if (request.method !== 'POST') return json(405);
      // Forwarded hosts are accepted only from the explicitly configured hosting proxy.
      const url = new URL(request.url);
      const target = new URL(config.endpoint);
      if (!isAllowedPublicHost(request, target.origin, config.trustedProxyHost)
        || url.pathname !== target.pathname || url.search) return json(403);
      const authorization = request.headers.get('authorization') ?? '';
      const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization)?.[1];
      if (!token || token.length > 8192) return json(401);
      try {
        const identity = await dependencies.verifyIdentity(token, config.endpoint);
        if (identity?.aud !== config.endpoint || identity.email !== config.serviceAccount || identity.email_verified !== true) return json(401);
      } catch { return json(401); }
      let id: string;
      try { id = await sessionBody(request); } catch { return json(400); }
      try { return json(await expire(id) ? 200 : 503); } catch { return json(503); }
    },
  };
}

let taskAuth: GoogleAuth | undefined;
let verifier: OAuth2Client | undefined;
function productionDeadline() {
  const config = process.env.NODE_ENV === 'production' ? voiceDeadlineConfig(process.env) : null;
  return createVoiceDeadline(config, {
    async createTask(url, task) {
      taskAuth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
      // ADC stays inside Google's client. No token or credential is copied or logged.
      await taskAuth.request({ url, method: 'POST', data: task, timeout: 10_000, retry: false });
    },
    async verifyIdentity(token, audience) {
      verifier ??= new OAuth2Client();
      return (await verifier.verifyIdToken({ idToken: token, audience })).getPayload();
    },
  });
}
export const productionVoiceDeadlineConfigured = () => process.env.NODE_ENV === 'production' && !!voiceDeadlineConfig(process.env);
export const scheduleProductionVoiceDeadline = (id: string, expiresAt: number) => productionDeadline().schedule(id, expiresAt);
export const handleProductionVoiceExpiry = (request: Request, expire: (id: string) => Promise<boolean>) => productionDeadline().handle(request, expire);
