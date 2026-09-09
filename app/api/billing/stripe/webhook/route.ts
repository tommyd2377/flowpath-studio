import { AppError } from '@/lib/errors';
import { readLimitedBody, respond } from '@/lib/http';
import { configuredStripeBilling } from '@/lib/launch-billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return respond(async () => {
    const service = configuredStripeBilling();
    if (!service) throw new AppError('Stripe test webhooks are not configured.', 503);
    const bytes = await readLimitedBody(request, 256_000);
    let rawBody: string;
    try { rawBody = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new AppError('The webhook body must be valid UTF-8.', 400); }
    // Stripe's signature authenticates the exact bytes. Browser session/origin
    // headers cannot authenticate this provider-to-server endpoint.
    return service.reconcileWebhook({ rawBody, signature: request.headers.get('stripe-signature') ?? '' });
  });
}
