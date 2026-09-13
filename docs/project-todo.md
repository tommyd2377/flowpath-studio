# FlowPath Studio to-do list

New requests from the project-planning conversation are recorded here for later implementation and status checks. Earlier items remain in the planning conversation and their individual investigation documents.

## SEARCH-03 — Reliable catalog navigation and richer optional web context

- **Added:** 2026-09-12.
- **Scope:** Full published-item discovery, publisher assistant purpose, search/image/source grids with stable spoken labels, separately enabled cited web additions within cards, whole-card pointer controls, hover previews and voice highlighting; maps excluded.
- **Status:** Implemented locally; offline code checks and 16 isolated browser tests passed. See the [code map and evidence](search-workspace-improvements.md). Live search/speech quality and monetary billing activation remain unverified and inactive, respectively.

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
- **Boundaries:** Published facts/identities are preserved; same-name grouping is navigation rather than a knowledge merge. Real speech and production deployment are not claimed by chat/browser testing.
