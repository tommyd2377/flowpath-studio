import { creationApi } from '@/lib/creation-api-runtime';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return creationApi.adminFileGET(request, (await context.params).id);
}
