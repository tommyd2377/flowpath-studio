# FlowPath Studio to-do list

New requests from the project-planning conversation are recorded here for later implementation and status checks. Earlier items remain in the planning conversation and their individual investigation documents.

## SEARCH-03 — Reliable catalog navigation and richer optional web context

- **Added:** 2026-09-12.
- **Scope:** Full published-item discovery, publisher assistant purpose, search/image/source grids with stable spoken labels, separately enabled cited web additions within cards, whole-card pointer controls, hover previews and voice highlighting; maps excluded.
- **Status:** Implemented locally; offline code checks and 16 isolated browser tests passed. See the [code map and evidence](search-workspace-improvements.md). Live search/speech quality and monetary billing activation remain unverified and inactive, respectively.
- **Published-text follow-up:** Fixed long website prose overflowing the assistant's structured context before answering. Chat and voice now receive bounded matching passages and share a publication-scoped reader that can search and page through all published section/entity text. Tests cover unrelated publishers and both execution paths; live answer quality remains to be verified. See [architecture and evidence](visitor-task-execution.md#answering-questions-from-published-text).

## GREETING-01 — Publisher-selected information for the spoken greeting

- **Added:** 2026-09-12
- **Status:** Implemented; independently reviewed in assignment 3. Offline persistence, pruning, preview, publication and mocked voice coordination passed. Natural live delivery still requires an authorized live test. See [integration report](astra-integration-review.md).
- **User request:** “When choosing initial greeting publisher can choose three pieces of info and voice fills in.”
- **Working interpretation:** During greeting setup, the publisher chooses three pieces of information to include. The voice assistant composes a short, natural opening greeting around those points, supplying the wording and transitions using approved publisher content. The publisher does not need to write the entire spoken script. “Fills in” means composing the language, without inventing missing facts.
- **Acceptance target:** The greeting covers the chosen information accurately and naturally, follows the site's selected tone, and respects the existing Save/Publish and visitor-speaks-first behavior.
- **Implementation starting points:** Existing [greeting settings](../components/GreetingSettings.tsx) and [opening settings](../components/OpeningSettings.tsx), which already include a three-highlight input. Check how these feed the voice greeting before choosing an implementation.
- **Implemented evidence:** Three optional approved source/entity/fact or bounded custom-text slots in `GreetingSettings`; deterministic preview and qualified fact wording; Save/Publish validation, source/graph pruning and Undo coverage in `tests/adaptive-workspace.test.ts`. Spoken points remain separate from visual opening selections. See [architecture](adaptive-workspace-architecture.md) and [acceptance ledger](adaptive-workspace-acceptance.md).

## WORKSPACE-02 — Adaptive visitor experience

- **Status:** Integrated Studio implementation; assignment 3 corrected structured-fact registration, public relationship retention, location/deictic ambiguity, screen clipping, detail fallback and phone typing overlap. Current verification and remaining limits are recorded in the [independent integration report](astra-integration-review.md).
- **Independent acceptance:** Ready for hands-on local evaluation. Full check passed with 278 server and 21 rendering tests; 94 isolated browser tests passed. Live interpretation/speech and production operation remain unverified.
- **Implemented:** Twelve independently addressable objects, atomic published-reference-validated operations, retained per-object state, semantic contact/location facts, catalog/media/source/external compositions, actual bounded browser scene, truthful browser acknowledgments, symmetric focus/return, keyboard/modal/reduced-motion fallback, three token-backed layouts and palettes, and explicit intro-only/no-AI browsing.
- **Not claimed:** Live speech comprehension/latency, deployment, arbitrary annotated media/diagrams/3-D, new executable capabilities, production readiness or completion of unrelated billing/domain/business work.

## WORKSPACE-04 — Home and complete website browsing

- **Status:** Implemented locally; final verification is recorded in [Home and published website](home-and-published-website.md).
- **Implemented:** A universal Home command/control, complete responsive Browse website, shared editorial cards, reference deduplication and same-name entry grouping, measured website visibility, independent search routing, grounded follow-up topics and bounded temporary-search rotation.
- **Foreground follow-up:** Fixed floating cards covering task results, inconsistent task Home/Back, stale task revisions after backend reads, photo-overlay navigation and mobile access to the Voice/Chat switch. The foreground source/entity and actual visible records stay synchronized. All 36 isolated voice/chat, workspace and filtering browser tests passed, including desktop/mobile transitions and rejecting stale pre-Home results; live speech interpretation remains unverified in this pass. See [foreground coordination](visitor-task-execution.md#foreground-coordination).
- **Clear-all follow-up:** Simple typed commands such as “close all three panels” now clear locally without a model request or task-storage dependency. Voice has an acknowledged Clear action; model bulk closes tolerate layout-only movement while preserving publication/workspace revision guards. Full checks and all 27 isolated voice/chat browser tests passed, including mobile, task-service failure and stale-layout bulk closing. See [implementation and evidence](visitor-task-execution.md#clearing-the-visitor-workspace); live speech selection remains unverified.
- **Boundaries:** Published facts/identities are preserved; same-name grouping is navigation rather than a knowledge merge. Real speech and production deployment are not claimed by chat/browser testing.

## VOICE-05 — Reliable pauses and restarting a conversation

- **Added:** 2026-09-13.
- **Request:** After pausing for 30–60 seconds, follow the visitor's current intent instead of restarting old work.
- **Status:** Implemented locally: consume completed/failed request versions, reject delayed delegations without new substantive speech, stop quiet-state updates from extending inactivity, and treat restart history as context while waiting for the next request. Preserve the current page and cards. See [pause/restart architecture and verification](gpt-live.md#studio-pause-and-restart-follow-up-september-13). Real speech behavior remains to be verified.
- **Checks:** 88 focused tests and 24 isolated browser regressions passed with mocked providers/audio. The original whole-project build encountered a type error in concurrent website-import work; a subsequent clear-all verification passed the full project check and all 27 voice/chat browser regressions, including pause/restart. See the linked verification notes and [later check](visitor-task-execution.md#clearing-the-visitor-workspace).

## KNOWLEDGE-UX-01 — Simplify publisher knowledge editing and starting over

- **Added:** 2026-09-13.
- **Request:** Make the Knowledge section understandable to a new publisher, with an obvious way to delete information and start over, protected by clear confirmation.
- **Status:** First cleanup pass implemented locally: plain-language workflow and summary, prominent draft-knowledge deletion with site-name confirmation, advanced collection tools in a disclosure, and removal of both knowledge and collection draft references. Lint, typecheck and two knowledge lifecycle/PDF tests passed. Browser confirmation/cancellation remains unverified. Full-site reset and further review-screen simplification remain to do.
- **Brochure follow-up:** Implemented grouped content review with explicit batch approval, visible Apply eligibility, topic-based reading sections, and a complete extracted-text reader for future prose imports. Exact source-name locations do not approve unrelated facts. Full checks passed (417 server and 21 rendering tests); the isolated desktop/mobile approval → draft → publication → reading → Home flow passed without paid calls. Embedded PDF photos, live semantic-quality evaluation and further publisher simplification remain open. See [source review](source-review.md#brochures-and-prose-content-first-review).
- **Acceptance:** Explain what is draft versus published; show exactly what each deletion removes and retains; support clearing knowledge without orphaned collection references; make a complete site reset (including proposals, photos, original uploads and Undo retention) understandable and separately confirmed. Preserve other sites and account settings. Test cancellation, stale revisions, publication boundaries and empty states. Do not reset the user's new PDF test data while implementing.
