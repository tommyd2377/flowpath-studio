# FlowPath Studio paid MVP — local test implementation

October 27: private Save draft and Preview draft are now separate from Publish / Update published version and View published version. Draft edits preserve the existing published snapshot and visitor funding until explicit promotion. Additive private draft fields and revision-bound owner-only prepaid previews need no migration; legacy published data and segments retain their prior meaning. Approved published snapshots use exact, current-policy historical proofs while draft Save/Publish remain bound to the current review head. No live payment activation or deployment is included. See [shared contracts](parallel-work/contracts.md).

October 25, 2026. This builds on the current simple waveform. It does not restore archived Studio. No deployment, push, production configuration, real payments or live voice tests were performed. The separately authorized FlowPath Studio sandbox setup is recorded below.

## Status and preview

The local synthetic flow works end to end: account → save waveform → get test pack → allocate finite budget → explicitly publish → anonymous sponsored usage → cumulative intro expiry → account sign-in → explicit visitor-funded continuation. One account still has one waveform. The preserved legacy fixture default is **$5 USD / 15 minutes / 900 seconds**; server configuration can select another test pack. Pricing remains undecided: neither $1/10 minutes nor $5/$6 per hour is selected by this implementation. Existing purchase snapshots and credited seconds are never revalued. No subscriptions, top-ups, payouts, Connect or commissions.

**This is not ready to accept real money.** `paidVoiceReady()` deliberately returns true only in explicit local fixture mode. Outside fixtures, both paid voice and checkout creation fail closed. No environment flag enables live processing. The existing homepage's separate 180-second demo and its protective controls remain intact. A paid-test activation routes private waveform starts through paid admission and rejects the legacy personal free-start endpoint except for the verified founder's explicit [admin continuation](admin-testing.md).

Run a synthetic preview using Node 24 and a fresh temporary directory (no credentials needed):

```sh
FLOWPATH_ACCOUNT_FIXTURE_DIRECTORY="$(mktemp -d /private/tmp/flowpath-paid-preview.XXXXXX)" FLOWPATH_ACCOUNT_MODE=local FLOWPATH_PAID_FIXTURES=1 FLOWPATH_LIVE_ENABLED=0 npm run dev
```

The UI labels its checkout synthetic. It never asks for card details or calls Stripe/OpenAI. Its SDP/provider sockets are synthetic; actual listening requires a separately approved live test and implementation of reliable upstream enforcement. Browser tests replace media as well. The synthetic filesystem adapter is single-process only; production source uses Firestore transactions and existing server-only database rules, which deny all browser access.

## Payment policy and publishing

`/account` adds Creator pays, Introductory allowance and Visitor pays. Intro allowance accepts seconds via fractional minutes, including 5, 10 or 15 minutes. Creator pays has no configured per-visitor allowance, bounded by finite funds, the allocated waveform budget, 15-minute segments and infrastructure limits. Sponsorship budgets are cumulative seconds including already spent time. They allocate that portion of the same prepaid wallet; personal use and other waveforms cannot spend it. Decreasing a budget cannot invalidate holds. Switching to Visitor pays releases unheld allocation and preserves active sponsored holds until settlement.

Saving creates a private snapshot. Publish is explicit; `/p/<id>` returns only ID, name, accent and portrait, plus public payment mode/availability. Instructions, provider settings, owner UID, budget and ledger are never returned. Unpublish blocks new visitor sessions and provider starts; already admitted sessions may finish their existing reserved segment and remain cancellable. Saved identity/voice instructions, payer, allowance and revision are fixed for each segment. Metadata/prompt changes apply to subsequent sessions.

An account may open its private `/w/<id>` address. A visitor may use a published creator-funded experience without an account. Sponsor exhaustion never selects the visitor's balance. The paywall requires an account and available paid minutes. Buying returns to the saved destination and requires Continue, then a waveform gesture; no purchase callback starts voice. Return URLs are restricted to known local waveform routes. A return redirect never credits minutes. Canceled and pending payments are displayed distinctly.

The existing invitation policy remains the default. Explicit Firebase paid-test mode permits verified new Google/email users to join without an invitation in the same application account. Disabled memberships remain disabled. This is an application admission change only; no auth providers or cloud settings were changed. The usual verification and durable session checks remain in place.

## Anonymous identity and abuse controls

A distinct random HttpOnly, SameSite=Lax, year-long cookie is registered server-side before use; only its hash is persisted. Unissued values do not grant identity. Web Locks settle first issuance across tabs when available. Without Web Locks, an initial parallel first-visit cookie race remains possible. This cookie is separate from homepage demo identity, does not authorize account access, and persists across refreshes and conversations. There is no fingerprinting, IP identity, transcript or audio storage for billing.

Anonymous consumed/held time is per waveform. On sign-in, a transaction adds consumed anonymous usage to account usage exactly once. Multiple anonymous identities add their consumption conservatively. Linking waits for active calls to finish. A browser already linked to another account cannot relink to obtain another allowance; it must use the original account or a separate browser identity. Cleared cookies and different devices can obtain new anonymous identities: this cannot guarantee one allowance per human. Per-identity concurrency, three starts per minute, a 128-waveform tracking cap and shared durable global capacity/day limits bound abuse. The local synthetic policy is three connections and 9,000 admitted seconds/day. These are infrastructure limits, separate from money and visitor allowances.

## Ledger and session accounting

All accounting is in `paidTest*` collections, isolated from any future live ledger. Atomic transactions cover wallet balance, personal holds, per-waveform allocated/held/spent seconds, participant allowance/active state, segment records and immutable ledger entries. Publishing and personal spending contend on the same wallet. Reservations contend on the same budget/participant/global-capacity records. Revoked/changing Firebase sessions are rechecked inside admission and owner mutation transactions. Opaque request UUIDs are single-use; early cancellation leaves a tombstone before a late POST can allocate.

Ledger entries are purchase credits, reservation holds, actual usage debits, released holds, budget allocations and compensating reversal adjustments. The wallet balance is credited seconds minus settled debits and adjustments; available personal seconds exclude holds and sponsorship allocation. Sponsor allocations do not duplicate credit. A purchased pack is a server-owned snapshot, never a browser amount or quantity.

The reservation deadline begins at server admission, before provider creation. Setup reduces the maximum connected duration and is free. Billable connected usage starts only when the server receives `session.started` over its provider control connection. On valid provider `session.closed`, the charge is the minimum of provider-confirmed cumulative duration, server-observed connected elapsed time and the reservation. Duration is rounded up once to an integer second per segment. A call without confirmed connection costs zero. Verified termination ends provider duration; event delivery delay does not add provider usage. Unused seconds are released. A new connection gets a new segment and hold; it cannot reuse a settled identifier. Uncertain reconnects remain blocked until the original segment settles.

Duplicate closure paths settle once. A lost final event, missing provider identifier, failed persistence or crash retains the hold. A timer, day change or successful REST hangup acknowledgment never proves final duration and never releases funds. The adapter can reattach and close a persisted provider ID through the existing supervisor. No audio or transcripts are needed for accounting. Provider overshoot is recorded on the segment, charged at most the reservation and borne by the platform.

### October 26 accounting hardening

Paid admission now rejects missing, infinite, fractional or negative daily caps; concurrency must be an integer from 1 to 20. A zero daily-second cap pauses starts. The existing segment maximum remains 900 seconds, bounded further by the prepaid wallet, allocated sponsorship budget, cumulative intro allowance and shared daily reservation cap. The cap counts full admitted reservations and is not refunded by early settlement. Invalid wallet, allowance, sponsorship or global-capacity records fail closed for reconciliation. These are finite **admission/accounting bounds**; they do not establish a guaranteed provider-cost bound after a lost creation response or late cutoff.

Late provider-ID persistence preserves `uncertain` state. Confirmed creation/connection and uncertain reservations cannot be released through a generic rejected-setup result. A confirmed no-provider-attempt setup failure remains free. Settlement validates held funds/allowance/capacity before applying one atomic debit, release and audit; a failed write rolls back all of them. Reversals preserve active holds and original payers, and settlement may leave compensating debt. Final duration is rounded once, clamped to the reservation and observed connected elapsed time; provider overshoot remains platform liability.

The billing factory accepts a server-owned `assertWaveformAllowed(tx, ownerUid, waveform)` hook. Save, publish and admission check approval in their existing database transaction before financial writes; unpublish and confirmed cleanup remain available. The paid runtime snapshots `creationContentDigest` during configuration resolution and passes it into reserve. A concurrent content edit fails reserve without a hold, even if the new version is separately approved. A publication revision change after reservation prevents provider setup. The integration runtime owns enabling the safety hook and supplying its authoritative review store; omitting it preserves older unit fixtures and is not production safety approval.

### Fixture reconciliation procedure

`createPaidReconciliation(store, { environment: 'fixture', lookup })` is a local test utility with an injected synthetic provider-authority lookup. It has no HTTP endpoint, admin dashboard, production provider adapter or live credential path. Its only resolution input is the segment ID; the caller cannot submit a charge/duration through `resolve`.

1. `inspect(id)` reports state, reserved/charged seconds and whether provider identity/connection are known. It does not release funds or perform provider work.
2. `resolve(id)` inspects only an uncertain segment and queries the injected authority once. Timeout, lookup failure, an unknown outcome, elapsed expiry and day rollover preserve every hold and block replacement admission.
3. Confirmed final closure must bind the original request ID, matching provider ID, bounded reference ID and final cumulative duration. A recovered provider ID is persisted. Without server-confirmed connection, the charge remains zero. A confirmed no-creation result must bind the original request and cannot conflict with any stored provider/connection evidence. A missing response or provider lookup returning no record is not, by itself, proof of no creation.
4. Confirmed settlement and the `provider_reconciliation` ledger entry commit together. Concurrent/replayed resolution settles once. Failed writes leave holds intact for a later authorized retry. No balance edit, refund, provider creation or automatic retry occurs.

This procedure proves synthetic accounting behavior only. A real operational reconciliation process still needs a provider-backed, recoverable request-identity lookup with authoritative terminal outcomes, controlled operator access and independent acceptance. Unknown outcomes must remain unresolved.

Billing-lane verification on October 26: **48 scoped paid/Stripe Node tests passed** under sanitized Node 24.6.0, plus ESLint on the changed modules/tests and `git diff --check`. Fake authority tests cover nonfinite caps, concurrent reservations, corrupt accounting records, stale approved content, late provider identity, unknown/reordered outcomes, rollback, reversal debt and idempotent settlement. No build, browser suite, live API, real Stripe call, private runtime access or deployment was run in this lane; integration owns the full checks.

### Required upstream work before activation

The existing supervisor closes upstream via sideband, a server timer and one REST fallback. Paid segments are now wired into the existing independent deadline scheduler and authenticated expiry route; OIDC validation happens before ledger/provider access. Synthetic tests verify fresh-worker reattachment, partial settlement, authenticated retry after a missing final event, unknown-ID holds and scheduling failure before creation. The runtime still refuses non-fixture creation and does not expose real provider credentials for paid-test recovery. No real task was scheduled. Queue delivery can be late and a lost creation response can leave an unknown provider ID. **A guaranteed paid overshoot bound has not been established.** This implementation does not pretend a browser timeout or a delayed queue establishes one. Paid orphan recovery is not live-verified.

Before enabling real paid usage, implement and verify a provider-backed hard cutoff/recoverable creation protocol, persist provider lifecycle authority, and independently verify the paid deadline worker with response loss, restart, late task delivery, persistence failures and missing finalization. Establish a measured/documented overshoot bound and a manual reconciliation procedure for unresolved holds. Do not clear uncertain holds just because their deadlines passed. No hidden model, tools or automatic paid creation retries are used.

The fixture reconciliation helper above is not that production procedure. No provider-guaranteed cutoff, lost-create lookup authority or hard overshoot bound has been established; the fixture-only paid-readiness gate remains unchanged.

## Stripe boundary

`lib/stripe-test.ts` implements native hosted Checkout REST calls with allowlisted server configuration, a stable per-purchase idempotency key, one card-supported pack, and safe destination return URLs. Supported hosted wallets depend on the target sandbox/account/browser; wallet visibility has not been verified. No separate Stripe customer account, subscription or saved-payment flow is introduced. Before creation it checks the API account matches the configured FlowPath account and that the configured price is active, test-only, one-time, USD and the exact amount.

The webhook verifies the timestamp and HMAC-SHA256 signature of the bounded raw body, then rejects live/foreign-account events. Successful payment events cause retrieval of the canonical Checkout Session, PaymentIntent and line items. Fulfillment validates paid/succeeded state, UID, purchase ID, pack ID, price ID, quantity, received amount, currency and seconds against the stored purchase. Only then does one database transaction credit the wallet and record event/intent allocation. Different event IDs for the same purchase cannot double credit; an intent cannot fund another purchase. Late success may follow an earlier failure; late failure cannot undo paid fulfillment. Duplicate checkout clicks reuse the same pending purchase for 30 minutes.

Refunds are reconciled from canonical cumulative refunded amounts; disputes conservatively revoke the full pack. Reversed credit uses compensating entries, including when reversal arrives before purchase fulfillment. An already spent reversal can make the wallet negative; future personal/sponsored admissions are blocked until funds cover existing allocations. Existing held segments keep their original payer and bounded reservation; no automatic renewal occurs. A won dispute requires a separately reviewed auditable restoration; this version offers no restoration/admin endpoint. The code never initiates a refund or other money movement.

### Sandbox setup — catalog and private local connection configured

On October 25, 2026, the user explicitly authorized Brave access to FlowPath Studio's Stripe sandbox for pack/webhook setup. Optional test onboarding selected online payments/digital goods; tax, managed-payments and invoicing recommendations were skipped. FlowTime and GoPulse were not opened or changed. Live activation, agreements, identity and bank details were left to the user.

- Sandbox account: `acct_1UUQrvAdUlT47bKj` (distinct from its parent FlowPath Studio account).
- Product: `prod_VVRr9skG123dfA`, **FlowPath Studio — 15 minutes**.
- Price: `price_1UUQy5AdUlT47bKjAi89dmed`, **$5.00 USD, one-time**, active/default.
- Price metadata: `credited_seconds=900`, `pack_id=minutes-15`. Server configuration remains authoritative for credit quantity. The All-products catalog was empty before creation.
- After separate explicit credential approval, created **FlowPath Studio local sandbox** with custom permissions: Accounts read, Prices read, Checkout Sessions read/write, PaymentIntents read, Charges and Refunds read. The final Stripe review showed four read permissions and one write permission. The user entered the new key privately outside the checkout.
- Independently queried account and price with that configured test key: exact sandbox account matched, price was active/test-only/one-time, USD 500 cents, metadata 900 seconds. No payment or Checkout Session was created.
- Installed Stripe CLI 1.35.0. Its existing default configuration was not read or reused. An isolated CLI configuration and sandbox-only browser authorization were created under a private temporary directory after approval. Both `XDG_CONFIG_HOME` and `--config` point there; unrelated inherited Stripe credentials are removed from the child environment.
- The isolated CLI listener forwards snapshot events to `http://127.0.0.1:3220/api/billing/webhook`. Its signing secret was captured directly into a mode-600 private environment file outside the repository, with secret values redacted from output. No remote endpoint or deployment was created. Local forwarding exists only while that listener and receiver are running.
- API-key dashboard navigation unexpectedly exposed an existing full-access sandbox key in browser tool output. The user was notified and explicitly chose to handle rotation personally. That key was not used, copied into app configuration or rotated by the agent. Subsequent credential UI output was redacted.
- Automatic approval review temporarily blocked dashboard reading because its origin permission scope was broader than the authorized single sandbox. Browser interaction stopped until the user renewed explicit permission. The subsequent read and metadata save succeeded in the same FlowPath sandbox tab. Added `pack_id=minutes-15` while preserving `credited_seconds=900` and USD 500 cents. Stripe emitted `evt_1UURXqAdUlT47bKjbL1Uamc3`; the isolated listener reported HTTP **200** from the signature-verifying local webhook, and the Next receiver independently logged that 200. This verifies real signed event delivery and acceptance. It does not verify payment fulfillment, Checkout or wallet visibility.

The listener subscribes to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, plus `price.updated` for the harmless connection check.

The private local connection uses `FLOWPATH_STRIPE_LOCAL_SANDBOX=1`, `FLOWPATH_STRIPE_LOCAL_ORIGIN=http://127.0.0.1:3220`, explicit local account/fixture directory settings, `FLOWPATH_STRIPE_TEST_ACCOUNT_ID`, `FLOWPATH_STRIPE_TEST_PRICE_ID`, `FLOWPATH_STRIPE_TEST_KEY` and `FLOWPATH_STRIPE_TEST_WEBHOOK_SECRET`. It requires development, local accounts, a loopback origin and a separate fixture directory; mixed synthetic-Stripe flags, Firebase mode, public origins and production fail closed. Live voice stays disabled. Secrets never belong in source or this document. No production environment or deployment file was modified.

After reliable upstream enforcement is implemented, use sandbox test data to verify hosted checkout, wallet/card fallback, canceled checkout, redirect-before-webhook, async success/failure, replay, mismatched account/price and reversal handling. The automated Stripe tests currently inject fake HTTP responses and synthetic signatures. Real purchases remain paused even with valid sandbox configuration.

## Verification and launch checklist

Run `npm run check`, `npm run test:browser`, and `npm run test:browser:paid`. The paid browser suite launches an isolated local server/profile with a temporary synthetic ledger and blocks external browser traffic. It checks publishing, anonymous voice, unpublish cleanup, cumulative allowance after refresh/signup, explicit payer choice, synthetic checkout, cancellation, repeated clicks, back navigation and mobile overflow. Unit/HTTP tests cover concurrent allocation, payer snapshots, partial/setup calls, uncertain holds, cross-user denial, idempotency, signature/account/pack validation, reordered payments and compensating debt. These tests do not establish real Firestore contention, real Firebase signup, physical audio, Stripe wallet support or provider crash recovery.

Final October 25 local results: `npm run check` passed lint, type generation/typecheck, **174 unit/integration tests** and the production build. `npm run test:browser` passed **43** isolated checks, including founder limit notices, regular dismissal, explicit continuation, no override at the ultimate cap, and portrait movement. `npm run test:browser:paid` passed **4** synthetic scenarios, including the founder prepaid notice and explicit waveform gesture. `git diff --check` passed. The admin dialog, mobile/landscape portrait and mobile paywall were visually inspected. An initial browser run needed permission to bind its localhost test port; the rerun passed. A new paid UI test initially asserted text after its component had unmounted; correcting that test expectation produced a clean final run. Isolated test servers stopped after completion; the private local Stripe receiver/listener are left running with live voice disabled.

Real Stripe account/price configuration and one signed `price.updated` delivery were verified. No real Stripe Checkout/payment fulfillment, Firebase account data, provider crash recovery or paid live voice was tested. The existing Gmail/Benjamin Franklin record was not inspected or rewritten; synthetic legacy-waveform compatibility passed. Upstream enforcement and full Stripe/Firebase acceptance remain launch prerequisites. Admin source behavior and its exact limits are documented in [admin-testing.md](admin-testing.md).

Before launch:

- Finish and independently verify upstream cutoff/deadline/recovery; keep purchases blocked until then.
- After upstream enforcement, finish full Stripe sandbox checkout/fulfillment acceptance. Signed local forwarding is verified, but is temporary and requires its local processes to remain running.
- Run real Firebase and Stripe sandbox acceptance, including simultaneous server instances and browser authentication/checkout returns. No real money or live voice unless separately approved with host/task/budget.
- Add a separately reviewed live ledger/configuration path, operational reconciliation and reversal/restoration policy. Never reuse test events, balances or price IDs.
- Review the final diff and obtain separate authorization for production configuration, live activation, push and deployment. None occurred in this work.

## Official documentation consulted

- [Stripe hosted Checkout](https://docs.stripe.com/payments/checkout) and [Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create): chosen for a small hosted payment boundary.
- [Stripe webhook signatures, retries and ordering](https://docs.stripe.com/webhooks): raw signature checking and durable duplicate handling.
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests): stable keys on creation; account/database fulfillment still needs its own atomic idempotency.
- [Stripe refunds](https://docs.stripe.com/refunds): reconciliation only; no refund initiation.
- [GPT-Live configuration](https://developers.openai.com/api/docs/guides/live-conversations#configuration-fields) and [usage and graceful close](https://developers.openai.com/api/docs/guides/live-conversations#usage-and-graceful-close): final `session.closed` and cumulative duration, with no inference of finalization from transport loss.

The supplied local Next.js route/page guides were read before route implementation. No dependencies were added.

### Full real-account localhost follow-up

The user requested the full app locally rather than synthetic accounts. [local-app.md](local-app.md) records the real Firebase account connection, approved localhost OAuth domain, corrected server-identity selection, isolated local voice/ledger namespace, normal visitor/admin admission and independent local deadline worker. Final follow-up checks passed 180 server tests, 43 standard browser checks and 4 paid-flow browser checks. Live voice is enabled only for the explicitly approved manual localhost use; Codex started no provider conversation. Real paid Checkout/voice remain paused pending the upstream enforcement acceptance described above.
