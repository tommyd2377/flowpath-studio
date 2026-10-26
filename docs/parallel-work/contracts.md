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

The homepage retains its **separate 180-second demo**. The subsequently authorized MVP implementation adds a stable-cookie daily allowance across refreshes and tabs, preserving page-scoped and legacy cleanup identity; see [demo limits](../demo-limits.md). That soft bound must never be reused for paid intro entitlement. Its platform budget reserves full blocks, unlike measured paid wallet debits. Studio demo/member/paid capacity currently shares `voiceAdmission/global` when using the same backing database. Any new demo-specific cap must be additional and finite, preserving the existing global ceiling. News is a separate reference app for future plugins designed one at a time; no Studio import, installed-plugin claim or shared entitlement is permitted. Independent News work is outside this Studio scope and is not a launch dependency; the abstract configuration entry is unused/reference-only.

## Accounting and payment fulfillment

**Implemented:** reuse `VoiceDatabase`/`VoiceTransaction`, `createPaidStore`, `PaidSegment`, `Purchase` and `MinutePack`. `paidTest*` collections are test ledger data; the file fixture adapter is single-process only. Firestore-backed operations use transactions; synthetic tests do not prove deployed contention behavior.

- Wallet credit, holds, sponsorship allocation, participant use, global capacity, segment state and ledger transitions remain server-authoritative and atomic at their existing transaction boundaries. Personal available seconds exclude held and allocated credit; allocation cannot duplicate money.
- UUIDs cannot reserve twice. Closure settles once. Billable seconds are rounded up once per segment and bounded by reserved seconds, provider-confirmed duration and server-observed connected elapsed time. Unconnected setup costs zero. Unused holds release only on confirmed settlement; provider overshoot is recorded and borne by the platform.
- Persist the server-selected pack on purchase. Fulfillment validates the account, mode, checkout/payment identifiers, currency, amount, quantity, pack and payer binding. Deduplicate event IDs and payment intents. Redirects, browser flags and analytics cannot grant credit.
- `lib/stripe-test.ts` is test-only: signed raw webhook verification and canonical payment retrieval precede fulfillment. Refund/dispute events make idempotent compensating ledger entries; this code does not initiate refunds or payouts. Reversal ordering and unresolved holds need explicit reconciliation, never balance edits by a client.

**Pricing is undecided.** The existing `DEFAULT_PACK` is the superseded 500-cent/900-second test default; runtime can override seconds/cents and select a test price. It was preserved, not endorsed. No new code should assume that pack. Display and purchase validation must consume the server pack snapshot. Actual private/live configuration was not inspected. A pricing choice and any migration of purchased entitlements require separate approval; never silently revalue old credits.

**Proposed:** live ledger activation, payout/revenue sharing, multi-currency or product changes require explicit decisions and reconciliation/migration design. No live Stripe changes, purchases or provider calls are authorized by these contracts. Paid readiness currently returns true only in explicit synthetic fixtures.

## Creation safety: implemented locally, production activation gated

The candidate reuses the current editor and server boundaries, with a debounced background check during name/instruction/text editing. The server record binds owner UID, review ID, content digest, policy version/fingerprint, status and timestamps. Actual stored statuses are `pending`, `allowed`, `blocked`, `manual-review`; the UI also identifies stale/unavailable versions. Decision fields are server-owned, absent from client-writable waveform input. A client may reference a review, but the server recomputes and verifies its digest; a client boolean is never approval. See [implementation status](implementation.md) for activation boundaries.

Material input includes name and initialPrompt, plus text-panel content once enabled. Define normalization once on the server. Identity/appearance changes that affect safety need explicit policy treatment; do not silently exclude new fields. A completed review applies only to its exact digest and policy version. Late responses cannot approve a newer draft; material edits immediately remove eligibility. Bound request rates and reuse an identical completed review; no automatic paid retries.

Create/Save validates that the **exact submitted version already passed**; it does not launch a redundant AI review. Reject pending, changed, rejected, manual-review-required or missing versions through the direct API too. Publication and admission verify authoritative approved content atomically with the mutation/reservation. Until an approved edit is promoted, keep the previous approved version or block use according to the agreed legacy policy; never expose the unchecked edit. Private autosaved drafts, if needed, must be explicitly non-executable and separate from approved configuration.

Acceptance tests: direct API bypass, edited name/prompt after approval, out-of-order responses, duplicate review requests, simultaneous edit/create, publish and start races, partial private/public write failure, policy change and legacy record behavior. Review-provider selection/cost limits and legacy enforcement are unresolved; implement with fake reviewers first. Fake reviewers are test/fixture-only, never a production fallback; absent/unavailable policy or review infrastructure fails closed for approval. Manual-review-required cannot be approved by a generic save/admin-testing toggle.

## Analytics: implemented observation boundary, no external vendor

No external analytics provider is selected. The implemented allowlisted model uses a no-op default and bounded test sink; hosts observe views, navigation, creation, paywall/payer selection and voice lifecycle. Server-only usage observations require confirmed evidence. No assumed price is converted into a cost observation.

Implemented envelope: schemaVersion, fresh telemetry eventId, eventName, occurredAt, source (`client`/`server`), platform (`web`/`ios`/`android`) and strictly allowlisted outcome/payer enums. Version 1 carries no waveform, user, session or provider identifiers. These are telemetry labels, not authentication or financial authority. Client events may be missing, duplicated or forged. Never derive credit, allowance resets, charges, refunds or settlement from them. Analytics failure cannot block cleanup or roll back a committed ledger transition.

No prompts, transcripts, audio, email, cookies/tokens, private owner IDs, provider IDs, raw payloads or free-form errors. Retention/consent/provider decisions precede external delivery. Existing opt-in browser-memory diagnostics remain separate and must not be forwarded into analytics.

## First text panel: implemented local interface

October 26 user-approved extension: `{ type: 'text', version: 2 }` enables the interactive Text Box through the waveform settings plugin dropdown. It contains no saved visitor text. The server registers its narrow `update_text_box` function only from authenticated saved configuration; GPT-6 Luna is the default delegation model. `live-text-session.ts` holds each conversation's dictation and edits in tab memory, with Stop/Clear/Undo/Copy and stale-event protection. Its output/acknowledgments have no financial authority. See [Text Box](../text-panel.md) for event, retention and timing details.

Legacy `{ type: 'text', version: 1, text: string }` remains readable without migration and retains its authored-content review gate. Version 2 is a capability only and works with normal Firebase account settings; when creation review is enabled, its configuration joins the exact-version digest. Render escaped plain text, without executable HTML, scripts, iframe, arbitrary fetches, marketplace, auth/ledger access or unregistered tools. Reset session text on waveform/identity/new-conversation changes and preserve it after closure for Copy. Existing media lifecycle and keyboard/mobile behavior remain. No framework or new dependency is introduced.

**Proposed next presentation contract:** saved capability does not mean visible UI. Per-conversation closed/open presentation is separate from voice and Writing/Paused. Explicit display/dictation requests reveal the panel in approximately 800 ms; closed panels have no rendered/focusable/pointer-accessible controls. Stop writing pauses capture while leaving text visible; Hide pauses and dismisses without ending voice or clearing content. No show/hide tool action is implemented yet. The host will own layout, motion/focus and future compatibility, initially with one visual plugin active at a time. See [experience design](../experience-design.md). News navigation belongs only on the Studio homepage; this removal on individual waveforms remains next UI work.
