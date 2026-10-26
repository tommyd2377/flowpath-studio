# Creation safety core

This lane implements a server-owned exact-content review state machine and a bounded admin queue. It does not activate enforcement, select a review model/provider, invoke paid APIs, or change existing account, publication or voice runtime behavior. Integration owns those endpoints and transaction hooks. The supplied evidence is synthetic, with no deployed or live moderation verification.

## Content and policy binding

`canonicalCreationCandidate()` trims name and initialPrompt exactly as the current save validator does. It retains their existing 80/8,000-character limits and control-character rules. Optional text is exactly `{ type: 'text', version: 1, text }`, limited to 4,000 characters; whitespace and line breaks are preserved. Unknown text-panel keys and control characters are rejected, and content is never truncated. The canonical optional value is null. A missing panel and null share a digest; an explicitly empty panel has a different digest. HTML-shaped text remains text and must be escaped by the renderer.

`creationContentDigest()` computes SHA-256 over a fixed-key JSON object containing all three fields. Appearance, voice and adminTesting are outside this initial content contract. These fields cannot grant approval. Photo/portrait and identity/appearance safety treatment remains an explicit policy decision before expanding coverage; this text review does not certify images.

`CreationSafetyPolicy` requires a nonempty version and an explicit action for every exported category. Available categories are extremist impersonation, violent extremism, sexual content involving minors, hateful abuse, credible harm, fraud/impersonation and privacy abuse. Actions are `block` or `manual-review`; extremist impersonation must use `block`. These category names define the integration boundary, not a completed classifier or final approved policy wording. No default policy is silently selected.

`CreationSafetyBinding` contains `{ digest, policyVersion, policyDigest }`. The policy digest includes the version and ordered category actions, so changing a category also invalidates approvals when the version was not bumped. Review findings must cover every category with `clear`, `violation` or `uncertain`. A violation of a blocking category blocks; another violation, uncertainty or malformed/incomplete findings require manual review. Only complete clear findings allow automated approval. Reviewer failures/unavailability require manual review.

## Server API and storage

`createCreationReviewStore(database, options)` consumes the existing `VoiceDatabase`/`VoiceTransaction`, not a parallel database abstraction. Options supply the policy, a production/fixture mode, optional trusted reviewer, clock and required owner/admin verification callbacks. Verification must use server-verified UID/session authority **inside the supplied transaction**; request bodies, role booleans and the founder admin-testing preference are not authority. This lane intentionally does not change auth schemas.

- `request(actor, candidate)` returns `{ record, needsReview }`. Identical current content/policy reuses its review, including pending or completed results. A material change immediately creates a new current review; no old completion can replace it.
- `runReview(proof)` atomically claims the current pending review once, then invokes the injected reviewer outside the transaction. Completion rechecks owner, review ID, content and policy proof against the current record and current policy. It refuses stale work. No client verdict is accepted, no provider is selected, and no automatic retries occur.
- `get(actor)` returns that owner's current record after verification. It is private and contains the submitted prompt; integration must use an explicit minimal projection for browser status.
- `requireAllowed(tx, ownerUid, candidate, expectedBinding?)` recomputes the binding and reads the current allowed record in the caller's transaction. It returns the server proof or throws. Create/Save reuses this allowed review rather than making another model call. Missing legacy approval, pending, blocked, manual review, changed content/policy and a mismatched expected binding all fail closed.
- `listManual(actor)` requires verified review-admin authority and returns pending/manual candidates in the unresolved queue. Pending items are visible for operations but cannot yet receive a manual decision.
- `decide(actor, { ownerUid, reviewId, digest, policyVersion, policyDigest, decision })` requires verified review-admin authority and an exact current `manual-review` proof. An explicit allowed/blocked decision records actor UID and time, removes the item from the queue and is bound to that exact content/policy. It cannot override a category block, approve pending work, replay a decision, or approve a newer version.

Server-only collections are `creationSafetyOwners/{sha256(uid)}` (current review pointer), `creationSafetyReviews/{randomUUID}` (candidate, binding, state, attempt/decision metadata), and `creationSafetyQueue/manual` (unresolved review IDs). The queue contains at most 200 records and rejects additional work when full. A new version removes its superseded version from the queue. Completed historical records remain private for audit; retention/cleanup is undecided. No prompts, review content or provider errors are logged by these modules.

The store reads before writing, as required by Firestore transactions. Reuse the **same backing database and transaction** for safety and protected content/accounting mutations. Call `requireAllowed` before the mutation writes, and ensure every other transaction read also precedes writes. Publication/admission must independently check authoritative safety against the exact loaded snapshot inside their own transaction. A preflight check followed by a separate write/reservation is insufficient. Carry the returned binding with a saved snapshot so the loaded content and reservation cannot diverge after a concurrent edit. Safety failure must roll back the protected mutation/reservation.

## Fixtures, unavailable infrastructure and recovery

No reviewer defaults to allowing content. With configured policy but no reviewer, a claimed request becomes `manual-review` with `review-unavailable`; it cannot be used until an authorized exact-version human review completes. With missing or invalid policy, operations needing approval return unavailable. Production mode refuses to invoke a fixture reviewer, and fixture store mode is rejected when NODE_ENV is production. `createFixtureCreationReviewer({nodeEnv:'development',enabled:true}, callback)` additionally requires explicit development-fixture selection; its injected callback is synthetic evidence only.

An interrupted attempt stays pending and cannot be approved or automatically retried. Failed/unavailable attempts go to manual review once, without paid retries. Operational recovery of abandoned pending work, durable background job delivery and per-owner/global request/call limits need integration decisions before a real reviewer is enabled. The 200-item queue is a storage bound, **not a paid-call budget**. An older in-flight review may finish externally after an edit, but its completion cannot authorize content or update the current review. This lane creates no runtime jobs, timers, cloud resources or third-party calls itself.

## Decisions before activation

- Approve the policy wording, category actions, image/identity coverage and human-review procedure. No model/provider or moderation endpoint is chosen here.
- Choose the reviewer, consent/privacy/retention rules, bounded spend/call budget, rate limits and job recovery behavior. Real paid review testing requires separate app/host/task/budget approval.
- Decide legacy rollout explicitly. The primitive treats absent approval as ineligible; enforcement remains an integration-owned activation choice so existing content is not silently reclassified or migrated by this lane.
- Bind editor review, exact-version Save/Create, private execution, publication updates and admission to one coherent snapshot. Keep unreviewed drafts non-executable; a partial private/public write must never publish or execute unchecked content. No broad admin-testing bypass is valid.
- Confirm queue access/retention and provider job infrastructure. No rules, IAM, auth providers, environment or deployment configuration were changed here.

## Verification

Use Node 24: `node --import tsx --test tests/creation-safety.test.ts`. The tests use an in-memory serialized transaction adapter with rollback and Firestore-style read-before-write assertions; no fixture files are written into source or private runtime. Coverage includes canonical limits, exact text changes, category blocking, duplicate reuse, missing policy/reviewer, production fixture refusal, forged ownership/proof, stale policy, concurrent edit/Create, out-of-order completion, one-attempt claims, explicit manual decisions and corrupted records. Integration runs the full check and isolated browser suites after wiring the host.
