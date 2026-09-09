# Publisher launch offer

The launch offer is one subscription per published site, with prepaid AI credit. The repository includes a local synthetic billing experience and Stripe **test-mode** payment boundaries. No Stripe account, prices, payment methods, credentials, domain configuration or live payments were created or changed during implementation. Live commercial activation remains unconfigured.

| Item | Offer |
| --- | --- |
| Monthly subscription | $29 USD per site |
| Annual subscription | $300 USD per site, paid annually |
| Included AI usage | $10 of retail usage each subscription month, including annual plans |
| Additional usage credit | $10, $25 or $50 prepaid top-ups |
| Optional automatic replenishment | Publisher-selected amount, low-balance threshold and monthly automatic-purchase ceiling |
| Included credit | Unused credit resets at the monthly allowance boundary |
| Purchased credit | Carries forward; no monthly expiration |

The subscription covers one published site, hosting, core publishing features and the custom-domain connection entitlement. Domain registration is separate. Custom-domain routing is still an unconfigured platform capability: this change does not purchase domains, modify DNS, provision certificates or promise that an entered domain is connected. Multiple site drafts remain useful in Studio; a separate site subscription has its own allowance and purchased balance.

## Retail usage pricing

The initial retail rate is **3 times the supported provider API token cost**. This is a configurable, versioned launch policy in [billing-rates](../lib/billing-rates.ts), not a profit guarantee. It gives a two-thirds gross margin on usage before payment processing, hosting, support, refunds, taxes and other overhead. The $10 included allowance corresponds to approximately $3.33 of provider cost at that multiplier when fully consumed. Rates distinguish text, audio, cached input and supported cache-write usage. Transcription is separately metered; unknown usage or unsupported rate categories are not treated as free.

All monetary calculations use integer microdollars. Display rounding does not discard small charges. A usage reservation records its rate-card version; future pricing changes must retain historical rate versions for unsettled work. Update the policy version when changing prices rather than repricing already authorized usage. The subscription prices and allowance live in [billing-model](../lib/billing-model.ts).

## Credit and payment boundaries

Included credit is used before purchased credit. The ledger reserves an upper bound before authorizing chargeable work, then settles against known usage. Missing usage remains reserved for reconciliation. A reported overrun retains the hold, records the excess and blocks further usage rather than debiting beyond the approved reservation. Duplicated conflicting payment events and malformed persisted state fail closed. Existing visitor attempt limits remain additional controls; monetary credit does not override them. Manual browsing remains available when conversational AI is unavailable or exhausted.

Annual subscriptions refresh their $10 allowance each month rather than granting all twelve months upfront. Month boundaries use the paid subscription anchor, including end-of-month clipping. Purchased credit is retained while a subscription is inactive. Cancellation is at the end of the paid period, and automatic replenishment is disabled on cancellation.

Automatic replenishment is opt-in. The ledger claims the next purchase against the publisher's ceiling before dispatching a payment. Pending or ambiguous payments do not grant credit or free the same reserved spending capacity for another attempt. Failed or unknown outcomes pause automatic replenishment; there is no automatic payment retry loop. The ceiling applies to automatic top-up purchases, not the base subscription or manually selected top-ups.

The local demo makes only synthetic payments and synthetic usage charges. Its test receipts are persisted with the local ledger and can never establish real payment. Existing unenrolled demo sites keep their free local workflow. Requests to enrolled local published sites use the synthetic meter; the billing panel also offers explicit synthetic chat/voice samples. These are not measured provider invoices.

The Stripe service exposes reserve/settle operations, with an `acquired` result that distinguishes newly authorized work from a replay. Live provider settlement is not activated by this test implementation. Owner and visitor provider entry points reject sites enrolled in Stripe test billing; continuous voice rechecks eligibility before authorizing subsequent turns. Synthetic or Stripe test credit cannot fund paid OpenAI calls. Unenrolled connected pilots retain their existing daily attempt limits. Activating real funded usage requires production payment configuration and per-operation provider usage reconciliation, including actual service tier/region and continuous voice input/transcription. Recent activity counts are not used as money.

## Stripe integration

Stripe is the payment provider for publishers paying the platform. [billing-stripe](../lib/billing-stripe.ts) implements the REST protocol behind injected configuration and transport: hosted Checkout for subscriptions and top-ups, retrieval for reconciliation, period-end cancellation/resumption, and an off-session top-up primitive that requires a saved customer-consent record, matching payment-method ownership and an already claimed ceiling. It uses existing Stripe Price IDs supplied by configuration; it does not create prices or configure a merchant account.

The adapter accepts only `sk_test_` keys and rejects `livemode: true` responses/events. It confines API calls to Stripe, uses a ten-second request timeout, does not follow redirects and does not retry failed requests. Checkout return destinations come only from the configured application origin. A browser returning from checkout is not proof of payment, and client input cannot set credit amounts, subscription periods or a confirmed status. Stripe's [Checkout fulfillment guide](https://docs.stripe.com/checkout/fulfillment) requires checking payment status and handling repeated fulfillment.

Webhook authentication verifies the original request body against its HMAC-SHA256 signature, checks a five-minute timestamp tolerance and requires the configured API version. The verifier runs before provider reconciliation reads. Signature verification is necessary even in test mode. The service must also bind the verified payment to its saved publisher/site/order/customer and persist payment identity with the ledger change. Event delivery can be duplicated or reordered; distinct events can describe the same payment. See [Stripe webhook security and delivery behavior](https://docs.stripe.com/webhooks).

Subscription entitlement is derived from a confirmed `invoice.paid` event and active subscription, with the saved price, currency, one full non-prorated subscription line, paid invoice-payment record and exact period checked. A checkout completion alone never activates a subscription. Top-ups require `payment_status: paid`; delayed or failed checkout events do not grant credit. The bounded initial integration rejects discounts, prorations, mixed invoices, incomplete line/payment lists and non-USD payments rather than guessing their entitlement. Those cases need an explicit supported policy before activation. See [Stripe subscription events](https://docs.stripe.com/billing/subscriptions/webhooks) and the [Invoice Payment object](https://docs.stripe.com/api/invoice-payment/object).

An auto-replenishment preference alone is not authorization to reuse a card. Before real off-session payments, the product needs the publisher's explicit permission describing the payment frequency and how amounts are determined, a properly saved payment method, and a customer-attention path when authentication is required. The provider primitive checks a server-held consent reference; it does not invent consent or enroll a card. See [Stripe's Setup Intents guidance](https://docs.stripe.com/payments/setup-intents).

Future visitor-to-publisher payments default to a separate Stripe Connect integration. They are not platform subscription payments and are not implemented by this offer. Publisher documents, knowledge records and AI-generated plans cannot manufacture a checkout action or connected account. Merchant onboarding, account ownership, fees, refunds, disputes and payment-confirmed capabilities require a separately reviewed integration.

## Test configuration and routes

The local demo needs no Stripe configuration and never contacts Stripe, even if Stripe variables exist in the process. A connected Firebase workspace can use separately supplied test configuration through [billing setup](../lib/billing-setup.ts). No configuration files or credentials were created here.

| Runtime setting | Purpose |
| --- | --- |
| `VOICE_STRIPE_MODE=test` | Explicitly select Stripe test mode; live mode is rejected |
| `STRIPE_SECRET_KEY` | Test key only; stays on the server |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the test webhook endpoint |
| `STRIPE_API_VERSION` | Explicit Stripe API version matching the webhook and supported response schemas |
| `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` | Existing USD recurring test Price IDs for $29/month and $300/year |
| `STRIPE_PRICE_TOPUP_10`, `STRIPE_PRICE_TOPUP_25`, `STRIPE_PRICE_TOPUP_50` | Existing USD one-time test Price IDs |
| `VOICE_APP_ORIGIN` | Existing trusted workspace origin for Checkout returns |

The owner-authorized `/api/sites/[siteId]/billing` route reads balances and creates test Checkout requests. `/api/billing/stripe/webhook` verifies the signed raw body before locating an order or making provider reads. Checkout returns open Usage & billing for the owned site; query parameters cannot grant a subscription or credit. Refreshing billing reconciles already-known Checkout/subscription objects without retrying a payment. An open checkout can be resumed after a reload through its saved Stripe test URL; pending confirmation prevents a second checkout. Webhooks handle delayed confirmations, including automatic top-ups whose first response was lost.

If a Checkout creation response is lost before any provider ID or URL is saved, the request remains unknown and blocks another purchase. Refresh cannot discover an unknown provider ID. This state requires operator reconciliation; the implementation does not automatically replay a creation request or risk a duplicate after Stripe's idempotency retention window.

`voiceStripeTestBilling` stores an isolated owner/site account through Firestore transactions, with provider calls outside transaction callbacks. The local store serializes payment confirmation and ledger changes into one atomic file replacement. Both are bounded test stores: replay records are retained up to their documented 1,000-record limits, then new work fails closed instead of forgetting payment identities. The Firestore document also has a 750,000-byte bound. Production rollout needs durable archival or a sharded journal; no migration, TTL policy, scheduler or cloud setting was created here.

## Verification and activation limits

Automated payment tests use fake customer IDs, fake price IDs, synthetic signing material and mocked transports. They cover exact launch amounts, pending/failed payments, duplicate receipt identities, corrupt stored data, raw-body tampering, stale/forged signatures, wrong owner/site/order/customer/price/period, live-mode rejection, fixed redirects and cancellation/automatic-payment guards. They make no Stripe or paid model requests.

Verified locally on September 9, 2026: 206 server/unit tests and 17 rendering tests passed; 35 core, 25 voice and 11 billing browser tests passed across the isolated runs. Lint, TypeScript and the production webpack build passed. Desktop and mobile billing screenshots were reviewed. Browser tests used a source-matched temporary checkout, synthetic workspace data and mocked providers; the resumed Stripe destination was fulfilled locally without a network request. No live Stripe, Firebase payment transaction or paid AI behavior was tested.

Passing these tests does not establish a configured merchant account or live settlement. Real activation still requires separately authorized Stripe configuration, approved payment/consent terms, tax/refund/dispute handling, verified webhook delivery and production usage reconciliation. The existing custom-domain routing limitation also remains. No production billing or deployment was activated as part of this implementation.
