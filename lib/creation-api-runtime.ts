import { createCreationApi } from './creation-api';
import { accountServer } from './account-runtime';
import { creationReviewStore, creationSafetyEnabled } from './creation-runtime';
import { configuredPublicOrigin } from './request-origin';
export const creationApi = createCreationApi({ accounts: accountServer, enabled: creationSafetyEnabled, store: creationReviewStore,
  publicOrigin: process.env.NODE_ENV === 'production' ? configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN) : undefined,
  trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST });
