import { respond } from '@/lib/http';
import { assertCsrfToken, assertSameOrigin, clearWorkspaceSession } from '@/lib/firebase/session';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  return respond(async () => {
    assertSameOrigin(request);
    await assertCsrfToken(request);
    await clearWorkspaceSession();
    return { ok: true };
  });
}
