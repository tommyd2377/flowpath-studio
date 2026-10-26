# October 26 source handoff

The user authorized committing today's integrated work, publishing it to `tommyd2377/flowpath-studio` on **main**, and continuing from main. Deployment is explicitly not authorized. Older branches remain preserved. `599b592` is the earlier foundation, not the feature baseline for new work: fetch `origin/main`, resolve its current full SHA and use that exact commit for a new isolated lane.

The running checkout is `/Users/thomasdevito/.codex/worktrees/studio-mvp-integration/theVoice`, serving localhost:3220. Git permits a branch in one worktree at a time; the original `/Users/thomasdevito/Projects/theVoice` checkout is preserved on a parking branch when main is checked out here. Do not stop this server or copy private runtime files to another worktree merely to change Git branches.

## Delivered implementation

- **Voice and text:** GPT-6 Luna delegation; corrected provider event selectors; dictation and voice-controlled text operations; stale/duplicate event protection; Stop/Clear/Undo/Copy/Hide and retained after-call text. Normal local manual testing uses the existing Google account, never synthetic owner buttons.
- **Desktop:** selected left portrait beside the raised waveform, 800 ms transitions, hidden-until-requested Text Box, internally scrolling content and visible toolbar, keyboard/reduced-motion support, and News example only on the homepage. Existing mobile reflow remains; no native framework was selected.
- **Knowledge/plugins:** private PDF/DOCX/TXT uploads, asynchronous preparation, document selection/removal, authenticated retrieval and source-bound excerpts. A shared static registry and single-owner async tool dispatcher connect Knowledge to Text Box. No executable third-party loading or marketplace.
- **Creator configuration:** 15,000-character instructions with preserved over-limit drafts and server enforcement; the 256 KiB request envelope also fits a permitted photo plus a full multibyte prompt. Existing shorter prompts remain readable.
- **Local founder testing:** validated localhost + saved Admin testing has no daily/start/silence/app-duration quota. Hosted/public/other-account limits, authorization and confirmed cleanup remain intact; no live price/provider/account configuration was changed.
- **Creation safety:** background editor review and exact-content/policy binding; Save reuses an already-approved version; direct API/publication/admission enforcement and manual-review queue use the same authority. Real production policy/reviewer activation remains unfinished.
- **Billing/demo:** strengthened finite sponsor caps, idempotent accounting/settlement, uncertain-hold reconciliation and content-bound admission. Existing creator/intro/visitor payer modes are reused. The 180-second homepage welcome remains, with refresh-resistant visitor allowance and Studio platform budget controls. News is separate and untouched.
- **Analytics:** allowlisted observation contracts, no-op default and bounded synthetic sink; no transcript/user/provider identifiers or financial authority. No external provider selected.

## Prototypes and decisions still open

- Mobile work is a tested HTTPS fallback/UID/permission/billing contract prototype plus design exploration, not an installed iOS/Android app. Apple sign-in, native transport and installed-app link associations remain future acceptance work.
- Naming and revenue documents contain proposals, not availability/trademark research or approved prices, shares, payouts or a product rename. The existing configured test pack was preserved.
- Hosted Knowledge needs explicit document publication/version review, funding limits and provider-resource reconciliation. Real PDF/DOCX extraction remains unverified. Live payment activation needs verified provider cutoff/recovery, sandbox acceptance and explicit authorization.
- Analytics delivery/consent/retention and the production safety provider/policy still need decisions. The retired website generator and independent News app are outside this work.

## Evidence and next discussion

Current integrated source passed `npm run check` (lint, types, **311** unit/integration tests and build), **60** standard browser tests and **6** paid-fixture browser tests. Checks used an isolated source-only copy with synthetic providers/media/payments; no emulators or deployment ran.

The separately approved real Brave/normal-account Knowledge acceptance uploaded the fictional Franklin sample, indexed it, retrieved exact facts, produced the correct spoken answer and displayed the matching excerpt/filename on a spoken request. One call reported 93 provider seconds. Its answer started about 4.8 seconds after delegation; do not claim sub-second live retrieval. The user ended the call before the planned live Hide check, and the expanded diagnostic drawer covered that control. Session-only diagnostics were cleared without saving a transcript/audio log. See [Knowledge evidence](../knowledge.md#subsequent-approved-live-acceptance--october-26).

Practical next discussion: choose the next product capability or polish Knowledge (source presentation, answer latency, missing-answer behavior and PDF/DOCX acceptance). Mobile, pricing, branding and public plugin distribution remain separate decisions. This source backup is not launch approval.

Coordination header for later work:

```text
Repository: tommyd2377/flowpath-studio
Base: resolve the current origin/main SHA; use an isolated branch/worktree for parallel work
Contracts: docs/parallel-work/contracts.md; ownership: docs/parallel-work/ownership.md
Runtime: Node 24; actual local app at localhost:3220 — keep it running
Preserve existing changes and Google sessions. No deployment, live billing/configuration changes,
credentials, force push or paid API tests without their required explicit authorization.
```
