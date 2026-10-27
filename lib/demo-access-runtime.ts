import { applicationDatabase } from './application-database';
import { createDemoAccess } from './demo-access';
import { hostedTesterRuntime } from './tester-voice-config';
export const demoAccess = createDemoAccess(applicationDatabase(), { enabled: hostedTesterRuntime,
  publicOrigin: process.env.FLOWPATH_PUBLIC_ORIGIN, trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST });
