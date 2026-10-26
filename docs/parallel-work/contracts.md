# Parallel work: shared contracts

Audit date: October 26, 2026. Read [current state](current-state.md) and [ownership](ownership.md) first. **Implemented** means present in this checkout, not deployed or live-verified. **Proposed** means a lane design constraint, not an available API. Extend the existing modules; do not create a second identity system, ledger, voice host or website generator.

## Identity and authorization

**Implemented:** `AccountUser`, `WaveformInput`, `Waveform` and `AccountMode` in `lib/account-model.ts`; account exchange/logout at `/api/account`; private configuration at `/api/waveform`. The authority is verified Firebase UID, membership and the active server application session. Google and verified email/password are accepted; Apple is not. Browser Firebase state is in-memory, cleared after exchange for the HttpOnly application cookie. `ownerSessions` hashes bind UID, expiry and active/changing/revoked state. Mutating transactions recheck that session. Exact Host/Origin policy and deny-all client database rules remain intact.

Anonymous paid visitor identity and homepage demo identity grant usage scope only. `PaidActor` is constructed on the server; client-supplied UID, role, balance or owner is never authority. The paid visitor-to-account usage association is not an account merge. Preserve invitation defaults and the existing explicitly selected paid-test registration behavior.

**Proposed:** web, iOS and Android use the same backend UID, waveform ownership, membership and wallet. Native auth transport and Apple sign-in need a separate auth design; preserve existing cookies/endpoints while adding verified transport. Provider linking requires proof/control of both identities; equal email strings must never merge accounts or wallets. Do not enable a provider or migrate accounts in a feature lane.

## Waveform configuration and publication

**Implemented:** one `ownerWaveforms/{uid}` document; stable random waveform ID; name (80 characters), initialPrompt (8,000), voice, accentColor, bounded raster profilePhoto, optional founder-only adminTesting and updatedAt. Preserve old-record defaults and existing validation. Public settings live in the existing `Publication` in `lib/paid-store.ts`: ownerUid, waveform snapshot, published, settings, spent, held, revision. `PaymentSettings` is `{ mode: 'creator' | 'intro' | 'visitor', allowanceSeconds, budgetSeconds }`.

Saving is private initially; `/api/publishing` explicitly publishes/unpublishes. Subsequent saves currently update a published snapshot while retaining its published flag. The private save and paid snapshot hook are separate operations. `/api/published` deliberately projects display ID/name/accent/photo and payment availability; it excludes owner UID, instructions, wallet/budget, provider settings and ledger. Do not serialize the full owner record publicly.

**Proposed:** reviewed-content version and optional text configuration are additive, coordinator-owned schema changes. Keep publication revision for its existing snapshot/accounting purpose; it is not moderation approval. Safety integration must prevent an unchecked edit from becoming public or starting a new session, including partial failure between the private save and publication update. Legacy treatment needs a decision before enforcement changes behavior.

## Links and routing

**Implemented:** `/w/<UUID>` is private; `/p/<UUID>` is the published web route. Copy-link currently uses the browser origin. `returnDestination()` in `lib/paid-model.ts` accepts only validated `/w/` or `/p/` destinations, otherwise `/account`. A URL is not permission to read private configuration. Unpublished waveforms reject new visitor admission; existing cleanup remains possible.

**Proposed:** retain `/p/<stable-id>` as the canonical HTTPS sharing path on the approved Studio origin; no installation required. Future universal/app links must resolve to the same ID and use this web fallback. Do not ship custom-scheme-only links, rename the domain, expose `/w` as public, or add association files until mobile identifiers and domain ownership are approved. Existing links and web sessions must continue working.

## Session lifecycle

**Implemented:** reuse `lib/voice-session.ts`, `lib/use-voice-session.ts`, `lib/voice-server.ts` and the existing admission adapters. `/api/session` serves homepage/private flows; `/api/paid-session?waveformId=...` serves the paid flow. Readiness precedes microphone access. A request UUID identifies admission and cancellation; unknown cancellation can create a scoped tombstone so a late POST cannot start work.

Order: server authorization/configuration → atomic allowance/hold reservation → independent deadline scheduling → provider creation → persisted provider identity → provider-confirmed connection → validated closure/settlement. A paid segment records payer, waveform, publication revision, reserved seconds and deadline. Preserve startup watchdog, normal 900-second maximum, browser silence cleanup, actual-playback waveform animation, 800 ms motion, reduced motion and keyboard cancellation. Existing founder testing exceptions never remove shared capacity, maximum duration or cleanup authority.

Provider IDs stay server-side. Keep the original endpoint, actor/payer scope and cancellation identity throughout cleanup, including logout and navigation. `session.started` on the server control connection starts billable connected time. A matching, valid `session.closed` with final duration is settlement evidence. Browser timers, analytics, transport closure and REST hangup acknowledgments are not final usage evidence. Uncertainty retains holds and blocks replacement admission; deadline/day rollover cannot erase it. Retries may close an existing call, never automatically create another paid call.

**Proposed safety binding:** configuration loaded before reservation and revision read inside reservation must be bound to the same approved content version. Admission must fail on a concurrent material edit rather than run unreviewed/stale configuration. The present ordering does not establish that guarantee. Hard cutoff/recoverable creation and paid overshoot acceptance remain billing/integration blockers; do not remove the fixture-only gate.

## Payer, preview and budgets

**Implemented:** `X-FlowPath-Payer: creator|self` expresses a requested payer; the server validates eligibility in the internal allocation checks used by `createPaidStore().quote()` and `reserve()`. It is not a trusted account identifier.

| Mode | Admission contract |
| --- | --- |
| `creator` | Anonymous visitors may consume allocated creator funds. No per-visitor allowance, but finite prepaid balance, waveform budget, segment maximum and global capacity always bound spending. |
| `intro` | Creator funds cumulative per-waveform participant seconds up to allowance, including active holds. Exhaustion requires an account, balance and explicit own-balance continuation. |
| `visitor` | An account and explicit self-funded choice are required from the first segment. |

Sponsor exhaustion never silently selects the visitor's wallet. Purchase return does not start voice; explicit Continue and a waveform gesture remain required. A new segment fixes its payer and limits; later settings changes cannot rewrite an admitted segment's payer.

Paid previews use the registered, year-long opaque paid visitor cookie, independent of page mounts. Refresh does not reset consumed/held intro seconds. Transactional linking adds anonymous consumption to UID usage exactly once and waits for active calls to close. It forbids relinking the same browser identity to another UID. Cookie deletion/new devices remain an abuse limit, not proof of a unique human. No fingerprinting is proposed.

The homepage's **separate 180-second demo stays unchanged**, including its current per-page refresh behavior and legacy cleanup identity. That soft bound must never be reused for paid intro entitlement. Its platform budget reserves full blocks, unlike measured paid wallet debits. Studio demo/member/paid capacity currently shares `voiceAdmission/global` when using the same backing database. Any new demo-specific cap must be additional and finite, preserving the existing global ceiling. News is an independent app with a separately owned platform-funded cap; no Studio import, installed-plugin claim or shared entitlement is permitted. News enforcement needs its own authorized audit.

## Accounting and payment fulfillment

**Implemented:** reuse `VoiceDatabase`/`VoiceTransaction`, `createPaidStore`, `PaidSegment`, `Purchase` and `MinutePack`. `paidTest*` collections are test ledger data; the file fixture adapter is single-process only. Firestore-backed operations use transactions; synthetic tests do not prove deployed contention behavior.

- Wallet credit, holds, sponsorship allocation, participant use, global capacity, segment state and ledger transitions remain server-authoritative and atomic at their existing transaction boundaries. Personal available seconds exclude held and allocated credit; allocation cannot duplicate money.
- UUIDs cannot reserve twice. Closure settles once. Billable seconds are rounded up once per segment and bounded by reserved seconds, provider-confirmed duration and server-observed connected elapsed time. Unconnected setup costs zero. Unused holds release only on confirmed settlement; provider overshoot is recorded and borne by the platform.
- Persist the server-selected pack on purchase. Fulfillment validates the account, mode, checkout/payment identifiers, currency, amount, quantity, pack and payer binding. Deduplicate event IDs and payment intents. Redirects, browser flags and analytics cannot grant credit.
- `lib/stripe-test.ts` is test-only: signed raw webhook verification and canonical payment retrieval precede fulfillment. Refund/dispute events make idempotent compensating ledger entries; this code does not initiate refunds or payouts. Reversal ordering and unresolved holds need explicit reconciliation, never balance edits by a client.

**Pricing is undecided.** The existing `DEFAULT_PACK` is the superseded 500-cent/900-second test default; runtime can override seconds/cents and select a test price. It was preserved, not endorsed. No new code should assume that pack. Display and purchase validation must consume the server pack snapshot. Actual private/live configuration was not inspected. A pricing choice and any migration of purchased entitlements require separate approval; never silently revalue old credits.

**Proposed:** live ledger activation, payout/revenue sharing, multi-currency or product changes require explicit decisions and reconciliation/migration design. No live Stripe changes, purchases or provider calls are authorized by these contracts. Paid readiness currently returns true only in explicit synthetic fixtures.

## Creation safety: proposed, not implemented

Reuse the current editor and server boundaries; do not add a second creation workflow. During name/instruction editing, debounce a background review of a server-canonicalized candidate. Proposed review record: owner UID, draft ID/revision, content digest, policy version, status, review ID and timestamps. Statuses: `pending`, `approved`, `rejected`, `manual-review-required`; a missing/mismatched digest is stale/unreviewed. Decision fields are server-owned, absent from client-writable waveform input. A client may reference a review, but the server recomputes and verifies its digest; a client boolean is never approval.

Material input includes name and initialPrompt, plus text-panel content once enabled. Define normalization once on the server. Identity/appearance changes that affect safety need explicit policy treatment; do not silently exclude new fields. A completed review applies only to its exact digest and policy version. Late responses cannot approve a newer draft; material edits immediately remove eligibility. Bound request rates and reuse an identical completed review; no automatic paid retries.

Create/Save validates that the **exact submitted version already passed**; it does not launch a redundant AI review. Reject pending, changed, rejected, manual-review-required or missing versions through the direct API too. Publication and admission verify authoritative approved content atomically with the mutation/reservation. Until an approved edit is promoted, keep the previous approved version or block use according to the agreed legacy policy; never expose the unchecked edit. Private autosaved drafts, if needed, must be explicitly non-executable and separate from approved configuration.

Acceptance tests: direct API bypass, edited name/prompt after approval, out-of-order responses, duplicate review requests, simultaneous edit/create, publish and start races, partial private/public write failure, policy change and legacy record behavior. Review-provider selection/cost limits and legacy enforcement are unresolved; implement with fake reviewers first. Fake reviewers are test/fixture-only, never a production fallback; absent/unavailable policy or review infrastructure fails closed for approval. Manual-review-required cannot be approved by a generic save/admin-testing toggle.

## Analytics: proposed observation boundary

No product analytics provider is selected or implemented. Add a small provider-neutral, allowlisted event model, initially a no-op/test sink. Candidate events: `waveform_viewed`, `voice_start_requested`, `voice_connected`, `voice_ended`, `paywall_shown`, `payer_selected`; server-only settlement observations may reference a deduplicated ledger operation after commit.

Envelope proposal: schemaVersion, eventId, eventName, occurredAt, source (`client`/`server`), platform (`web`/`ios`/`android`), optional public waveform ID and bounded outcome/payer enums. These are telemetry labels, not authentication or financial authority. Client events may be missing, duplicated or forged. Never derive credit, allowance resets, charges, refunds or settlement from them. Analytics failure cannot block cleanup or roll back a committed ledger transition.

No prompts, transcripts, audio, email, cookies/tokens, private owner IDs, provider IDs, raw payloads or free-form errors. Retention/consent/provider decisions precede external delivery. Existing opt-in browser-memory diagnostics remain separate and must not be forwarded into analytics.

## First text panel: proposed interface

Small additive configuration: `{ type: 'text', version: 1, text: string }`, optional/absent for legacy waveforms. Proposed MVP bound: 4,000 characters; reject oversize input rather than truncate. Schema owner approves the field and limit before persistence wiring. Text lane owns a pure `TextPanel` component accepting validated configuration (or null); integration supplies it as a sibling below the waveform/status. Public output uses an explicit safe text projection.

Render escaped React text with preserved line breaks. No executable HTML, Markdown HTML, scripts, iframe, network fetch, third-party marketplace, secrets, auth/ledger access or model tools. This phase displays creator-authored text; dynamic model-driven text is a separate contract. Unmount/reset on waveform/identity change; preserve media lifecycle, mobile layout and keyboard access. Material text edits join the creation-safety digest before publishing is enabled. No new framework, plugin registry or dependency is needed for this boundary.
