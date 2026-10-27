import { applicationDatabase } from './application-database';
import { createDemoAccess } from './demo-access';
import { localAppOrigin } from './local-app-runtime';
import { hostedTesterRuntime } from './tester-voice-config';
export const demoAccess = createDemoAccess(applicationDatabase(), { enabled: () => hostedTesterRuntime() || !!localAppOrigin(),
  publicOrigin: process.env.FLOWPATH_PUBLIC_ORIGIN, trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST });
