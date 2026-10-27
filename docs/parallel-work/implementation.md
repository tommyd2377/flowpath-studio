# Local MVP integration candidate

**Creation-safety follow-up:** full localhost now uses conservative GPT-6 Luna review for names, instructions, portraits and immutable Knowledge documents, with a separate 50¢ cumulative waveform budget. Existing Franklin content is included explicitly, with no legacy exemption. Borderline versions wait for Thomas. No hosted activation, deployment or new voice quota was introduced. See [creation safety](../creation-safety.md) for current coverage and verification; older activation paragraphs below describe the pre-activation foundation.

**Source handoff supersedes the branch status below:** the user authorized today's completed integration and Knowledge work to be committed and promoted/pushed to **main**, without deployment. Use the current `origin/main` SHA for new lanes. See the [October 26 handoff](october-26-handoff.md) and [Knowledge acceptance](../knowledge.md). Earlier snapshot tables and launch blockers below remain historical evidence, not the current branch selection or latest test counts.

**Later October 26 update:** interactive Text Box, Luna delegation and the real-startup selector correction are implemented through application commit `bd24198`. The latest check passed 288 unit tests and 52 standard browser checks; the initial plugin integration also passed six paid browser tests. Real Brave/Google-account startup was verified, and the user reports basic dictation works. [Experience direction](../experience-design.md) records the requested on-demand display, compact layout and homepage-only News link as next UX work. The original MVP snapshot/results below are historical, not the latest text-plugin feature list.

**Selected desktop follow-up:** after reviewing the mockups in `28be2a6`, the user approved the left-portrait layout and actual Brave acceptance. The candidate now implements the compact row, viewport-fit panel with persistent actions, hidden-until-requested UI, show/hide commands, after-call reopening and homepage-only News. See [Text Box](../text-panel.md) for final verification and live-test status. The 288/52 results above describe the earlier application snapshot, not this follow-up.

During live acceptance, the user explicitly removed all local founder-testing quotas after the shared reservation limit blocked restarts. Validated localhost + verified founder + saved Admin testing now bypasses daily/start/silence/elapsed-time gates and local expiry tasks. This is a local runtime exception; no live Stripe/provider setting, private environment file or hosted policy was edited. The earlier one-call temporary numeric override was removed. See [local app](../local-app.md).

October 26, 2026. Candidate branch: `codex/mvp-integration`, based on complete baseline `599b5920d5aee767397d654417ce3afd74befef7`. Shared `main` remains at that baseline. This is local implementation with synthetic verification, not deployment or live acceptance. Resolve the candidate's final SHA from Git or the coordinator handoff before review.

## Implemented in the candidate

- **Billing:** finite policy/accounting validation, monotonic uncertain holds, exact resolved-content binding at reservation, fixture-only authority-based reconciliation and idempotent audit records. All three existing payer modes, finite sponsor allocation, self-payment consent, test fulfillment and pack snapshots are reused. No new price selected and no entitlement revaluation. Real paid readiness remains fixture-only.
- **Demo controls:** stable-cookie daily allowance survives refreshes/tabs; the welcome remains 180 seconds. Transactional Studio platform cap supplements global admission. The abstract News configuration is unused/reference-only, with no News protection delivered or required for Studio launch. News stays separate and serves as a reference for future plugins designed one at a time. See [demo limits](../demo-limits.md).
- **Creation safety:** background review while editing name/instructions/text; digest and policy fingerprint bind the exact version. Save reuses authority without another reviewer call. Direct API writes, publication, public projection and session admission enforce the current allowed version when safety is selected. Pending/stale/blocked/manual versions fail closed. Owner cleanup and unpublishing remain available after approval stales; actor/ownership checks still apply.
- **Admin review:** authenticated queue for pending/manual records; only a verified admin can explicitly allow/block the exact current manual-review proof. Blocked content is not approvable through this queue or admin-testing preferences. Fixture admin is a synthetic identity available only with the explicit development safety-fixture flag.
- **Text panel:** 4,000-character plain text, server validation, explicit public projection, escaped display below the waveform, visitor Show/Hide, creator updates and identity/content visibility resets. No executable HTML, third-party registry, speech/model tools or arbitrary visitor text.
- **Analytics:** strict event allowlists, no-op default and bounded test sink. Hosts observe demo/voice engagement, navigation, creation steps, payer selection and confirmed provider usage. No names, prompts, transcripts, audio, identifiers, URLs, auth material or raw errors. Tab-return observation is memory-only, not cross-session/user retention. Cost has a validated server-only contract but is not emitted from an assumed price: authoritative monetary evidence is not yet available.
- **Mobile/research:** tested HTTPS `/p/<UUID>` web-fallback resolver and shared UID/owner/billing display contracts. Framework and native transport remain proposals. See [mobile tradeoffs](../mobile-prototype.md), [naming proposals](../research/naming.md), and [revenue proposals](../research/revenue-model.md).

## Local selection and activation boundaries

`FLOWPATH_SAFETY_FIXTURES=1` requires development plus local synthetic accounts. Playwright selects it explicitly. Its deterministic reviewer is synthetic and labeled in the editor; it is never a production fallback. The local queue/UI can be tested with the labeled **Use test safety admin** fixture. No real account or provider configuration is changed.

`FLOWPATH_CREATION_SAFETY_ENABLED=1` selects server enforcement for nonfixture runtime. An explicit complete `FLOWPATH_CREATION_POLICY_JSON` is required; no production review provider is installed. Missing policy is unavailable/fail-closed, and an unavailable reviewer routes a configured-policy candidate to manual review. The fixture policy does not settle production policy categories or thresholds. No private environment file was read or changed.

Existing legacy behavior remains when safety is not selected; new text configuration is unavailable in that mode. Enabling enforcement makes unreviewed legacy records ineligible for new starts/public access until approved. Decide the legacy rollout before activation. Appearance/voice are outside the current material digest; policy treatment of portraits and new future fields remains explicit future scope.

Remaining Studio decisions/blockers: production policy wording/provider/privacy and paid-review budget/rate/job-recovery controls; legacy activation; measured upstream hard cutoff/recoverable creation and true reconciliation authority; pricing and old-entitlement treatment; analytics delivery/consent/retention; mobile framework/Apple/token transport/app identities; brand/domain and revenue split. Independent News implementation, activation and enforcement are outside this scope and are not Studio launch blockers. No automatic paid retries or abandoned-review replay is installed.

## Workers and configuration evidence

All new workers were explicitly spawned with accepted `model: gpt-6.1-sol` and `reasoning_effort: xhigh` arguments, without inheritance assumptions or Astra substitution. Their effective model/effort/service-tier readbacks are not exposed by the collaboration API. Coordinator model is exposed as GPT-6.1 Sol; its effective reasoning/speed readback and a supported per-worker Fast setter are unavailable. The user's selected Fast setting was not changed. This matches the documented [explicit subagent settings](https://learn.chatgpt.com/docs/agent-configuration/subagents#choosing-models-and-reasoning), but is not independent runtime verification.

| Worker | Agent / thread ID | Scope and original commits |
| --- | --- | --- |
| Billing | `/root/mvp_billing` / `01a178f0-cdd6-7761-aec7-99bb7ac7b795` | `d493ec0` billing safeguards; resumed once through native collaboration after capacity failure; completed. |
| Safety/mobile/research | `/root/mvp_safety` / `01a178f1-06c4-7890-b02c-1ebfe9e9d430` | `0cca9cc` safety core; `c7b4bee` mobile/research; completed. |
| Text/analytics/review UI | `/root/mvp_display_analytics` / `01a178f1-4c58-79d3-b564-34ce44b01b0c` | `764aacc` primitives; `21b7206` review hook/queue; completed. |

Each worker used its own `studio-mvp-{billing,safety,display}/theVoice` worktree. Integration alone edited shared schemas/auth/runtime/host/harness in `studio-mvp-integration/theVoice`. Completed audit agents were not relaunched. All worker commits were cherry-picked into the isolated candidate, never merged into shared main.

## Verification evidence

Node 24, installed dependencies, synthetic accounts/providers/payments/media, fresh temporary fixture state, no private env/runtime copied into worktrees. No emulator, new vendor account, credential, paid API call, real purchase, cloud/account change, push or deployment.

- Original homepage case: 1/1 passes unchanged in the clean managed worktree. The broad run's voice cases also pass with normal `page.goto()` load waiting. No waveform/media/image behavior was weakened to hide the earlier failure. Its exact older temporary-checkout cause remains unproven.
- Standard browser first run: 39 passed; 8 failed because a new accessible safety status made old Save assertions ambiguous; 1 failed because a new API test omitted required Origin. Scoped assertions and the test header were corrected; the nine affected cases passed on focused rerun. Afterward, the **full final standard run passed 49/49** on committed application snapshot `a6feb96`; the final acceptance is this full run, not the focused reruns.
- Final paid/public browser on the identical committed code: **6/6 passed**, including all payer modes, cumulative intro, explicit consent, failed-start handling, escaped public text, creator updates and no automatic voice start from display actions.
- Final `npm run check`: lint, type generation/typecheck, all 260 unit/integration tests and the production build passed after integration corrections. No unit tests were skipped. Browser suites are verified separately on the final code.

Logs: `/private/tmp/flowpath-mvp-check-final.log`, `/private/tmp/flowpath-mvp-browser-final.log`, `/private/tmp/flowpath-mvp-browser-paid-final.log`. Mocked passes do not prove provider quality, real sign-in, deployed Firestore contention, physical-device audio, native association or live payment/cutoff readiness.
