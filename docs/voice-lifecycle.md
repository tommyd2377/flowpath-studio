# Hosted voice lifecycle candidate — October 27, 2026

Local candidate based on `a236516c5bbde0410958be50231dac43571122a2`. This is a safety/recovery change, **not hosted voice activation**. The existing Firebase App Hosting architecture, accounts, UI, Text Box, Knowledge, Luna delegation and billing fixtures remain. No infrastructure, permission, credential or live service changes are included.

## Decision and implemented boundary

The original HTTP creation handler returned SDP while its sideband socket and timers continued in process memory. A minimum instance count and always-allocated CPU do not guarantee that the process survives. The documented provider API does not establish a configurable WebRTC hard duration cap or recovery of an unknown provider ID. Building a long-running creation worker around those gaps would not establish a spending bound.

The candidate therefore closes hosted admission in `getProductionVoiceServer`: GET is unavailable and POST cannot reserve or create a provider session, even if an old `FLOWPATH_LIVE_ENABLED=1` remains. This is a code gate, with no environment opt-in. The independent paid path remains fixture-only. No browser timer, analytics event, founder preference or task delivery can bypass these gates. A full active-session worker is **not implemented or claimed ready**.

The validated full localhost runtime retains its existing supervisor and detached local deadline worker. Saved Admin testing still removes founder daily/start/silence/app-duration quotas there. Hosted/public/other-account finite policies are preserved; localhost policy is not a production exemption. Synthetic fixtures remain isolated. No paid tests are authorized by this candidate.

## Request-owned cleanup of existing known sessions

Hosted cancellation/logout and authenticated expiry can clean up a previously stored session even when starts are paused or account/content/configuration state changes. Existing caller identity/ownership and task OIDC checks still precede cleanup. Cancellation or expiry durably records intent before any provider attachment.

`claimCleanup` uses the same Firestore transaction abstraction and `voiceConversations` record. It requires canceled intent and a known provider ID, increments a monotonic epoch, and grants a 20-second lease. Concurrent deliveries cannot both hold an unexpired claim. Old records need no migration: absent cleanup metadata is valid and the first claim adds it. Malformed metadata fails closed. Lease expiry authorizes another cleanup attempt only; it never releases capacity, refunds reservations, creates a provider, or proves the old provider closed.

The hosted handler awaits one sideband attachment (at most four seconds) and one graceful close (at most four seconds), disposes its socket/timers, then awaits settlement before returning. It does not register an orphan continuation or invoke the SIP hangup endpoint. No transcripts, audio, prompts, keys or free-form provider failures are logged. Database operations remain subject to SDK/platform failures; a crash, timeout or failed write leaves the durable reservation and lease available for investigation/retry after expiry, not successful settlement.

Settlement validates the matching provider ID, current epoch and unexpired lease in the same transaction as usage/capacity changes. Once cleanup takes ownership, a previous process-local controller without its token cannot finalize. A stale/expired worker cannot release a hold or overwrite newer authority. Terminal replays are idempotent. Only validated `session.closed` usage confirms closure; no final event means uncertainty. Busy or unresolved cleanup returns pending/503 through the existing cancellation/deadline contracts. Queue retries may repeat cleanup, never creation.

A lease cannot prevent every overlapping provider socket if an old process freezes beyond its lease and later resumes. Epoch fencing protects database settlement; the provider exposes no matching fencing token. A failed database write after receiving finalization can also leave a hold unresolved if a later attach does not replay that event. Both are explicit operational limits.

Fencing requires every participating database writer to run this protocol. An older deployed binary that ignores the new field is not externally fenced by this change. Verify old revisions/controllers are drained before relying on this cleanup protocol; no mixed-version rollout safety is claimed. The reported zero-instance pause is not proof that all remote provider sessions have ended.

Unknown creation responses remain blocked without retries or fictitious refunds. If an ID arrives after expiry changed the reservation to uncertain, `created` retains that ID and preserves the uncertainty/deadline for cleanup. It cannot revive admission or extend the cap. Reconnect/continuation cannot replace an unsettled session. Missing IDs, elapsed time, transport failure and successful HTTP acknowledgments alone are not authoritative usage evidence.

Paid fixture settlement/holds retain their existing tests and authority. This cleanup lease is for the hosted nonpaid store; an adapter without `claimCleanup` fails closed in the request-owned path. It is not a new live paid recovery implementation.

## Official guarantees examined

All sources were read on October 27; these are documentation findings, not live acceptance.

| Source | Documented / not established |
| --- | --- |
| [Live create reference](https://developers.openai.com/api/reference/resources/live/methods/create) | Session configuration and transport produce a provider ID/SDP. No documented configurable WebRTC `max_duration`/`expires_at`, create idempotency, or request-ID lookup that recovers a lost creation response was found. SIP limits do not establish WebRTC limits. |
| [Session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations#usage-and-graceful-close) | `session.closed` supplies final usage. Closing cancels queued Responses; an active response can finish, and client-delegated work must be handled separately. Lost transport without finalization leaves usage unconfirmed; this is not a hard cutoff of all billable work. |
| [Sideband reference](https://developers.openai.com/api/reference/resources/live/sideband-websocket) | Attach controls an existing known session. This does not establish complete replay or guaranteed terminal-event recovery after a crash. |
| [SIP hangup reference](https://developers.openai.com/api/reference/resources/live/subresources/sessions/methods/hangup) | REST hangup is documented for SIP. The new hosted WebRTC cleanup path does not assume it works there. The established local path is unchanged. |
| [SIP sideband replay](https://developers.openai.com/api/docs/guides/voice-sip#monitor-and-end-the-call) | Limited replay is described in SIP context, not proof of complete WebRTC finalization replay. |
| [Cloud Run request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout) | Requests have a bounded lifetime (default 300 seconds, configurable up to 3600); timeout does not necessarily kill processing. Extending a timeout is not a remote provider cutoff. Current hosted timeout was not inspected/changed here. |
| [Container contract](https://docs.cloud.google.com/run/docs/container-contract#lifecycle) and [autoscaling](https://docs.cloud.google.com/run/docs/about-instance-autoscaling) | CPU outside requests depends on billing settings; even warm instances can terminate. Shutdown normally gives a 10-second SIGTERM grace period; crashes/forced termination can interrupt work. No process-survival guarantee. |
| [Cloud Tasks task reference](https://docs.cloud.google.com/tasks/docs/reference/rest/v2/projects.locations.queues.tasks) and [limitations](https://docs.cloud.google.com/tasks/docs/common-pitfalls) | HTTP dispatch deadlines are approximate (15 seconds–30 minutes); canceled delivery does not ensure handler termination. Delivery can repeat or be delayed/out of order. Scheduled cleanup is not an enforced upstream expiry. The existing 30-second expiry task remains cleanup only. |
| [App Hosting configuration](https://firebase.google.com/docs/app-hosting/configure) | Supports zero minimum instances and CPU allocated only during requests. Those options alone cannot make orphan background supervision safe. |

## Required before hosted voice activation

1. Establish a provider-backed bound for WebRTC creation, session usage and outstanding delegation, including a lost creation response. Obtain a documented recovery protocol or independently reviewed, explicitly budgeted acceptance evidence for the residual exposure. Do not add unsupported API fields or assume global duration guarantees from SIP.
2. Implement a bounded active-execution owner (an awaited request/task is a candidate), with durable handoff/lease/fencing and cancellation/heartbeat/deadline behavior. The new cleanup path is not this active worker. Identify any required private endpoint/queue timeout/IAM change and obtain separate approval before provisioning it. No new worker infrastructure is required by the current gated candidate.
3. Test real provider closure/finalization recovery, duplicate/delayed deliveries, process shutdown/restart, missing IDs/events, storage failure and stale owners under a separately authorized host/task/call budget. Keep unknown outcomes unresolved and preserve financial holds.
4. Review actual scaling, CPU allocation and App Hosting request lifetimes; obtain explicit release/reactivation approval. The separate investigation reported manual scaling zero and zero-instance metrics. This thread has not independently inspected production/session records. Firebase Auth and Firestore remain separate and preserved.

The proposed source-only zero-idle configuration edit was rejected by automatic approval review pending direct user approval. `apphosting.yaml` remains unchanged (`minInstances: 1`, `cpuAlwaysAllocated: true`, live flag on); this must be reconciled before any future release. The code admission gate remains closed regardless. Do not deploy this candidate merely to update configuration.

## Verification

Final source checks passed: lint, generated route types/TypeScript, **341 unit/integration tests** and the production build. Standard browser regressions passed **62/62**; paid-flow browser fixtures passed **6/6**. The 12 focused cleanup tests and their lint were rerun after tightening the test's environment restoration; all passed. Candidate code bytes match the checked source copy. No new runtime dependency or lockfile change is included.

Checks used `/private/tmp/flowpath-lifecycle-check-DKX0dZ`, a source-only temporary copy with existing installed dependencies and synthetic accounts/providers/media; no private runtime or credentials were copied. Initial direct-worktree type generation was blocked by filesystem permissions; the copy resolved that. The first copy build rejected a node_modules symlink outside Turbopack's root; copying the existing dependencies resolved it and `npm run build` passed. An initial synthetic-fixture/async-error-wrapper failure and a TypeScript narrowing error were fixed before the final passing checks. Browser startup initially lacked loopback-bind permission; the authorized isolated rerun passed. The aggregate `npm run check` stopped at that initial symlink build failure; its lint/types/tests stages passed and the standalone build passed after the dependency-copy correction. No redundant full suite was run after that environment-only correction.

Logs are `/private/tmp/flowpath-lifecycle-{focused,check,build,browser,paid-browser,cleanup-final}.log`. Temporary test servers stop when Playwright finishes; the user's localhost:3220 server was not started. Real-provider, Cloud Run termination/scale-to-zero, Cloud Tasks delivery and Firebase contention acceptance are **not run** and remain unverified.

Focused tests cover hosted/paid admission gates, duplicate/busy cleanup, attach/close failures, expired/fenced/late finalization, rollback, unknown and late IDs, delayed deadlines, revoked-account cleanup, missing adapter capability, malformed ownership and browser disconnect. Existing suites cover lost creation responses, local founder exemptions, accounting holds, stop/reconnect and task authentication. Simulated crashes/leases are not a real process-kill/cloud acceptance claim.
