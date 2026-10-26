# Parallel work: ownership and handoff

October 26, 2026. Pair with [contracts](contracts.md) and [current state](current-state.md). These are file leases, not authorization to deploy, operate accounts, use paid APIs or change private configuration.

## Base and isolation

- Confirmed repository: `tommyd2377/flowpath-studio`, `/Users/thomasdevito/Projects/theVoice`.
- Common Git ancestor: `2dcb4481b64966de9d7a8c8f8f4a3842b0f99f3f`, branch `codex/simple-waveform`.
- **Repository handoff follow-up:** after the audit, the user authorized committing/pushing the current app and clarified that the branch literally named **`main`** must contain the waveform application and be the repository default. `main` advances through the existing waveform history without rewriting it; other branches remain preserved. The inherited application source is committed as **`ccdddb59e34f0da33a9742143c686fb6e3d084e0`**, separately from these foundation documents. At audit start it comprised 30 modified tracked files and 42 untracked files; those changes were preserved, not reimplemented.
- Use the verified `origin/main` tip containing this document as the common foundation. Fetch and resolve its full SHA once, record it in every lane's coordination header, then create isolated worktrees from that same commit. Do not reconstruct the baseline from the old ancestor or overwrite a checkout from the audit archive.
- The source-only archive in current-state.md remains a historical local snapshot with per-file hashes. It excludes credentials, `.env*`, runtime data, archives, `.git`, dependencies and generated output; it predates this repository handoff. Prefer the committed branch for new work. No private runtime/env files should be copied into worktrees.
- Each lane branches from that **same** foundation SHA into its own worktree. If Git/worktree creation is unavailable, use one independent extracted source copy per worker and return a scoped patch plus baseline manifest hash; integration applies it once and runs checks. Never have two implementation workers edit one directory. Read-only audit agents may inspect the original checkout.
- Do not start lanes from bare `2dcb448` and reimplement the missing paid code. The original foundation audit made no Git mutations; the later repository handoff is separately user-authorized. That approval does not grant future lanes permission to push, merge or deploy. Older branches/history remain preserved and outside active feature scope.

System `/usr/bin/git` is blocked by an unaccepted Xcode license. An already-installed fallback works: `/Users/thomasdevito/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/git`. Use it where necessary; do not accept a license or install tools automatically. Managed Codex worktrees may be used when their Git setup supports this environment.

## One owner per shared surface

The **integration coordinator** is the sole owner of shared schemas, auth/security, manifests and integration wiring. The **billing lane** is the sole owner of billing primitives. An owner may accept another lane's patch, but the contributor does not edit the owner's files concurrently. Exported type/signature changes require schema-owner review, even inside billing-owned modules.

| Owner | Reserved files/surfaces |
| --- | --- |
| Integration: schemas | `lib/account-model.ts`, `lib/paid-model.ts`; exported `Publication`, `PaidActor`, `PaidSegment`, `Purchase`, `VoiceDatabase`, `VoiceTransaction` contracts; proposed moderation/text/analytics boundary approval. Billing implements approved type edits in its owned store. |
| Integration: auth/security | `lib/account-client.ts`, `lib/account-server.ts`, `lib/account-runtime.ts`, `lib/firebase-accounts.ts`, `lib/production-account-session.ts`, `lib/invitations.ts`, `lib/request-origin.ts`, `app/api/account/**`, `app/api/waveform/**`, `firestore.rules`, `storage.rules`, auth/account tests. Provider/security configuration is frozen without explicit user approval. |
| Billing: primitives | `lib/paid-store.ts`, `lib/paid-database.ts`, `lib/paid-api.ts`, `lib/paid-runtime.ts`, `lib/paid-voice-store.ts`, `lib/paid-voice-runtime.ts`, `lib/paid-http.ts`, `lib/paid-client.ts`, `lib/paid-local-sandbox.ts`, `lib/stripe-test.ts`. No other lane writes these directly. |
| Integration: runtime/host | `lib/production-voice-store.ts`, `lib/production-voice-runtime.ts`, `lib/voice-server.ts`, `lib/voice-deadline.ts`, `lib/local-voice-deadline.ts`, `lib/local-app-runtime.ts`, `lib/voice-session.ts`, `lib/use-voice-session.ts`, `lib/voice-config.ts`, `app/api/session/**`, `app/api/voice-expiry/**`, `components/AccountSettings.tsx`, `components/OwnerWaveform.tsx`, `components/VoiceExperience.tsx`, `components/Waveform.tsx`, `components/VoiceDiagnostics.tsx`, `components/AdminLimitDialog.tsx`, `lib/voice-diagnostics.ts`, `app/globals.css`, root layout/home/account/private pages. |
| Integration: tooling and QA harness | `package.json`, `package-lock.json`, `.nvmrc`, TypeScript/Next/ESLint/Playwright configuration, common test fixtures, existing mixed browser suites, `scripts/**`, shared CI configuration and this coordination directory. No dependency changes in feature lanes. Deployment/env files stay frozen. |

Unlisted existing files remain integration-owned until explicitly assigned. This avoids an implied lease from a broad directory wildcard. `archives/**`, private runtime, secrets and the sibling News checkout are outside every lane's edit scope. Keep the existing footer and branding.

## Lanes and dependencies

The proposed paths below do not imply that the files already exist. A lane may create only its listed new files/directories and change its listed existing files. Submit requested shared edits as a patch/design to the named owner.

| Lane | May edit | Depends on / completion boundary |
| --- | --- | --- |
| Billing | Billing primitives above; `components/PaidSettings.tsx`, `components/PaidExperience.tsx`, `components/TestCheckout.tsx`; `app/api/billing/**`, `app/api/publishing/**`, `app/api/published/**`, `app/api/paid-session/**`, `app/p/**`, `app/checkout-test/**`; `tests/paid-*.test.ts`, `tests/stripe-test.test.ts`, `tests/browser/paid.spec.ts`; `docs/paid-mvp.md` | Starts from snapshot, reuses three modes/ledger. Investigate remaining acceptance gaps with fake providers. Schema changes through integration; moderation hooks coordinated with safety. Pricing, real provider tests and activation remain blocked decisions. No live checkout/settings/refunds. |
| Demo limits | `lib/public-voice-identity.ts`, `tests/public-voice-identity.test.ts`; new `tests/demo-budget.test.ts`, `docs/demo-limits.md` | Preserve homepage 180 seconds and current refresh semantics. Propose any separate platform demo cap through integration's shared admission store; no paid intro edits. News requires a separate authorized app-specific task and independent cap. |
| Analytics | New `lib/analytics-events.ts`, `lib/analytics-sink.ts`, `tests/analytics-events.test.ts`, `docs/analytics.md` | Provider-neutral types/no-op sink and synthetic tests can start now. Integration adds host hooks; billing owns post-commit ledger observations. No SDK/provider, automatic diagnostics export or external delivery until chosen. |
| Creation safety | New `lib/creation-safety.ts`, `lib/creation-review.ts`, `components/CreationSafetyStatus.tsx`, `tests/creation-safety.test.ts`, `docs/creation-safety.md` | Implement/test pure version state with a fake reviewer first. Integration owns editor/save/auth hooks; billing owns publication/admission hooks. Agree digest inputs and legacy policy before enforcement. No paid reviews without specific approval. |
| Text panel | New `lib/text-panel.ts`, `components/TextPanel.tsx`, `tests/text-panel.test.ts`, `tests/browser/text-panel.spec.ts`, `docs/text-panel.md` | Standalone plain-text validator/component first. Schema owner approves field/limit; integration mounts and persists it; billing adds public projection. Safety must bind material text before public activation. No arbitrary HTML or model tools. |
| Mobile prototype | New `prototypes/mobile-contracts/**`, `docs/mobile-prototype.md` | Framework-neutral contract fixtures/navigation specification only until framework is chosen. Consume current UID/waveform/billing contracts through fake transport; no duplicate backend. Apple, native transport, app IDs and association files require auth/integration decisions. No native project/manifest/store work yet. |
| Naming research | New `docs/research/naming.md` | Independent research can start; distinguish availability from legal clearance. No product/domain/package/link rename, registration or purchase. No application edits. |
| Revenue-model research | New `docs/research/revenue-model.md` | Independent scenarios using stated assumptions; pricing, fee/tax allocation, liability and refund treatment remain decisions. No payouts, Connect, ledger schema edits or financial actions. |
| End-to-end QA | New `tests/browser/parallel-acceptance.spec.ts`, `docs/parallel-qa.md` | Plan baseline/acceptance matrix now; execute against integrated snapshot as lanes land. Existing fixtures/config/mixed suites stay with integration. Cover identity isolation, three payer modes, refresh, races, moderation bypass, escaped text, web fallback and cleanup. No live credentials/payment/voice or signed-in personal browsers. |

## Integration sequence and checks

1. Freeze/source-hash the baseline; distribute the same snapshot or common foundation commit. Each thread reports branch/worktree, baseline, file lease and planned changes before editing.
2. Start independent research, pure analytics, safety state, text rendering and mobile contract work in isolated directories. Billing/demo audits can also start immediately from the snapshot. Runtime wiring waits for shared interfaces to be agreed.
3. Review shared schema proposals once. Apply auth changes, if any, through integration. Serialize safety's save/publish/admission work with billing; bind content and financial reservation to the same approved snapshot. Apply text/public projection after its moderation boundary exists.
4. Integrate one lane at a time. Check only the scoped patch against inherited dirty work; no cleanup refactor, bulk formatting or dependency upgrades. Migration/behavior-breaking changes require a concrete proposal and user approval before execution.
5. Use Node 24. Run `npm run check`; run `npm run test:browser` for session/interaction integration and `npm run test:browser:paid` for paid/publication integration. Test pure modules with the existing Node test harness. Run suites sequentially when they share `.next` or ports. Preserve mocked/live/deployed distinctions.

Baseline checks use a source-only temporary copy with locally copied installed dependencies and a sanitized environment, no `.env*` or private data. Next auto-loads env files; do not run an unreviewed local runtime merely because tests disable live voice. No emulator or dependency installation is needed. Report missing tools/permissions precisely and continue independent work.

## Paste into each later thread

```text
FlowPath Studio lane: <lane>; single writer: <thread>.
Repo: tommyd2377/flowpath-studio. Git ancestor: 2dcb4481b64966de9d7a8c8f8f4a3842b0f99f3f.
Foundation: <verified origin/main SHA including these docs>; source snapshot commit is ccdddb59e34f0da33a9742143c686fb6e3d084e0.
Worktree/source copy: <absolute isolated path>; branch: <branch or patch-only>.
Read AGENTS.md, README.md, docs/architecture.md and docs/parallel-work/{current-state,contracts,ownership}.md.
Edit lease: <exact lane paths>. Shared schemas/auth/runtime/manifests: integration only; billing primitives: billing only.
Reuse current implementations and preserve inherited user work, web sessions, private /w links and public /p fallback.
Keep 180s homepage demo; paid intro never resets on refresh; never silently charge visitors or assume a price.
No secrets/private runtime, paid API calls, purchases, cloud/provider changes, deploy/push/merge, account actions or branding changes.
Use fake providers and isolated local fixtures. Return scoped diff, tests/results, contract changes and unresolved decisions.
```
