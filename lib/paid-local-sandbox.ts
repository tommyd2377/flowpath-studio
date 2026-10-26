import { localAppOrigin } from './local-app-runtime';

/** Explicit loopback-only Stripe wiring; never enables paid voice or purchases. */
export function localStripeSandboxOrigin(env: Record<string, string | undefined>): string | undefined {
  if (env.NODE_ENV !== 'development' || env.FLOWPATH_ACCOUNT_MODE !== 'local' && !localAppOrigin(env)
    || env.FLOWPATH_STRIPE_LOCAL_SANDBOX !== '1' || env.FLOWPATH_PAID_FIXTURES === '1'
    || !env.FLOWPATH_ACCOUNT_FIXTURE_DIRECTORY) return;
  try {
    const url = new URL(env.FLOWPATH_STRIPE_LOCAL_ORIGIN ?? '');
    if (localAppOrigin(env) && url.origin !== localAppOrigin(env)) return;
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) return url.origin;
  } catch { /* Invalid configuration leaves local Stripe disconnected. */ }
}
