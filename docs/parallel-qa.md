# Candidate verification and remaining launch work

October 26, 2026. Branch `codex/mvp-integration`; tested application code snapshot **`a6feb96dfc1bea69ba4d73980a63bade385a21ba`**. The final handoff adds verification documentation only, preserving this exact application/test tree. Shared `main` is clean at `599b5920d5aee767397d654417ce3afd74befef7`; no push, deployment or shared-main merge occurred.

## Local evidence

| Check | Evidence |
| --- | --- |
| Lint | `npm run check` passed ESLint. |
| Types | Next type generation and `tsc --noEmit` passed. |
| Unit/integration | 260 passed, zero failed/skipped, using fake Firebase/database/provider/payment authority. |
| Build | Production Next build passed, including review/admin routes. |
| Full standard browser | **49/49 passed in one complete final run** on the committed code snapshot, including the former homepage-load path. |
| Full paid/public browser | **6/6 passed in one complete final run** on the identical committed code snapshot; fixtures only. |
| Diff/docs | Whitespace and local documentation links checked before final commit. |
| Live/deployed/native | Not run. No paid model/reviewer call, purchase, real provider session, cloud change or physical-device acceptance. |

The earlier integration browser run exposed broad status-selector ambiguity and one missing Origin in a new API test; those tests were corrected without weakening safety or navigation waiting. Focused reruns were used during repair, followed by the full final standard run above. The old temporary-checkout homepage timeout did not reproduce in the clean managed worktree; both the normal load wait and explicit optimized-logo completion pass. Its original environmental cause remains unproven; no voice/image workaround was used to hide it.

Coverage includes ownership/session revocation; exact-name/prompt/text approval reuse; forged/stale/pending/manual decisions; cancellation and unpublishing after safety stales; provider preflight denial without an uncertain remote hold; idempotent payment/settlement and uncertain reconciliation; finite demo/creator budgets; page refresh/concurrent-tab abuse; escaped visitor text and creator updates; no voice auto-start from checkout/display actions; 800 ms motion, reduced motion, mobile layouts and keyboard/media cleanup. Mobile contracts are synthetic, not a native app.

Logs: `/private/tmp/flowpath-mvp-check-final.log`, `/private/tmp/flowpath-mvp-browser-final.log`, `/private/tmp/flowpath-mvp-browser-paid-final.log`. All checks used Node 24, installed dependencies, a sanitized child environment and fresh test fixtures. No private env/runtime was copied into worktrees. Existing closure tasks were retained; no new trigger, queue or provider-creation retry loop was added.

## Try the current text panel locally

This preview exercises accounts, background synthetic review, text display, publication and fake checkout. It makes no paid/provider call and does not demonstrate real voice or measured latency. Keep this worktree free of private environment files; none were copied here.

```sh
cd /Users/thomasdevito/.codex/worktrees/studio-mvp-integration/theVoice
env -i PATH=/Users/thomasdevito/.nvm/versions/node/v24.6.0/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  TMPDIR=/private/tmp NEXT_TELEMETRY_DISABLED=1 FLOWPATH_LIVE_ENABLED=0 \
  FLOWPATH_ACCOUNT_MODE=local FLOWPATH_SAFETY_FIXTURES=1 FLOWPATH_PAID_FIXTURES=1 \
  FLOWPATH_ACCOUNT_FIXTURE_DIRECTORY="$(mktemp -d /private/tmp/flowpath-mvp-preview.XXXXXX)" \
  npm run dev
```

Open `http://127.0.0.1:3220/account`, choose **Use test owner A**, enter a name/instructions and **Text below the waveform**, wait for the explicitly synthetic approval and Save. The synthetic pack/checkout controls grant fake credit only. Continue to the waveform, choose own-balance continuation when shown, and try **Show text / Hide text** without tapping Start conversation. To test a published visitor experience, use a finite synthetic sponsorship budget and an unsigned-in window. The displayed legacy test pack is not approved pricing. Stop the preview with Ctrl-C; the fixture directory is temporary synthetic data.

The text plugin is deliberately finished at creator-authored plain text plus local visitor Show/Hide. No arbitrary voice-driven text tool, transcription, search or executable content was added. Seamless voice interaction and responsiveness in hundreds of milliseconds remain future design goals, not measured benchmarks or claims about this preview.

## Launch work: decisions, code and acceptance are different

| Area | Decisions needed | Missing implementation | Separate acceptance |
| --- | --- | --- | --- |
| Creation moderation | Production policy wording/thresholds, reviewer/provider, input retention/privacy, budget/rate limits, legacy-record rollout. | Production reviewer adapter; bounded durable job/rate/call controls and recovery of abandoned attempts. Current reviewer is explicitly development-synthetic; production is unavailable/manual, never synthetic auto-approval. | Approved real-review host/task/call budget; adversarial/race checks and verified admin process. |
| Analytics | Consent, retention, permitted aggregation/identity, delivery/storage choice. | Persistent production collector/adapter. Current host hooks use a no-op default; memory-only test sink is not a production analytics service or cross-session retention system. Monetary cost is not inferred from an assumed rate. | Privacy checks and failure/load tests for the selected collector, initially synthetic. New vendor accounts/credentials need separate approval. |
| Live paid voice/recovery | Pricing, old-entitlement treatment and unresolved-hold operations; supported provider cutoff/recoverable-creation protocol. | Verified upstream hard cutoff and response-loss recovery; real provider reconciliation authority/operations. Fixture authority helpers do not create those guarantees. Live paid gates remain closed. | Separately authorized bounded provider tests and real Stripe sandbox acceptance for checkout/fulfillment/replay/reversal. No real money or live Stripe activation. |
| Native/mobile | Swift vs React Native/Expo, platform targets, verified token/session transport, Apple/provider/app IDs and domain associations. | Native app, native media spike, Apple sign-in and installed-app link associations. The current pure link/account prototype preserves HTTPS fallback and UID authority only. | Mock contracts first; later authorized physical devices, app links, sign-in and separately budgeted real voice. |
| Brand/revenue | Name/domain shortlist, price and gross/net share definition. | No implementation required until selected; Connect/payouts/marketplace are outside this MVP. | Domain/trademark/legal and commercial validation by the owner; proposals claim no availability or clearance. |

News is outside the current Studio implementation/launch scope. It remains an external reference application for future plugins built one at a time. The abstract configuration entry is unused/reference-only, not News enforcement, and missing independent News protection is not a Studio launch blocker. No News worker, inspection, modification or deployment occurred.

Production activation is unfinished. These local passes do not authorize keys/grants, provider activation, account or financial changes, deployment, publication, push or a merge into shared main. Integration can proceed with synthetic adapters/contract tests while those Studio decisions are pending.
