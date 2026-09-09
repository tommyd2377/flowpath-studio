import { respond } from '@/lib/http';
import { getFirebaseClientConfig, getFirebaseSetupStatus } from '@/lib/firebase/config';
import { assertSameOrigin, requireFirebaseSetup } from '@/lib/firebase/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return respond(async () => {
    assertSameOrigin(request);
    const { mode, enabled } = getFirebaseSetupStatus();
    if (mode === 'firebase') requireFirebaseSetup();
    return { mode, enabled, ...(enabled ? { config: getFirebaseClientConfig()! } : {}) };
  });
}
