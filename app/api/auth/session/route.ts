import { z } from 'zod';
import { readJson, respond } from '@/lib/http';
import { assertCsrfToken, assertSameOrigin, createWorkspaceSession } from '@/lib/firebase/session';

export const runtime = 'nodejs';
const inputSchema = z.object({ idToken: z.string().min(1).max(16000) }).strict();
export async function POST(request: Request) {
  return respond(async () => {
    assertSameOrigin(request);
    await assertCsrfToken(request);
    const { idToken } = inputSchema.parse(await readJson(request));
    return { user: await createWorkspaceSession(idToken) };
  });
}
