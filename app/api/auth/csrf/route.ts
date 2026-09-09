import { respond } from '@/lib/http';
import { assertSameOrigin, createCsrfToken } from '@/lib/firebase/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return respond(async () => {
    assertSameOrigin(request);
    return { csrfToken: await createCsrfToken() };
  });
}
