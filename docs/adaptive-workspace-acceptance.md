# Assignment 2 acceptance and assignment 3 handoff

Studio-only working-tree integration, September 2026. Nothing in this handoff is a commit, deployment, live provider test or approval to spend. Assignment 1's reviewed semantic graph and public projection are consumed without introducing a competing knowledge schema.

## Independent integration result

The [assignment 3 integration report](astra-integration-review.md) supersedes the completion assessment below. Independent tests found and fixed disconnected structured facts, qualified relationship loss, map/deictic ambiguity, child clipping, unsupported DOCX meaning loss, and bounded-detail fallback/date labelling. The original assignment 2 run and file inventory below are historical; the report records fresh checks and remaining live limitations.

Current result: **278 server + 21 rendering tests** and the full check/build passed; **94 isolated browser tests** passed after the phone typing fix and two scoped test-harness corrections. The combined implementation is ready for hands-on local evaluation with synthetic data. No live model, real audio, physical-device or production readiness claim follows from these checks.

## Reproducible offline scenario

Use Node 24 and the existing locked dependencies. Run `npm run check`, then `npm run test:browser`. The runner uses an isolated browser profile, a fresh demo data directory and port 3225, grouped so the unchanged 12-site pilot cap is not exhausted. It does not use the developer's personal browser, microphone, Firebase emulators or paid APIs.

For the short acceptance demo after `npm run build`:

```sh
npm run test:browser -- tests/browser/adaptive-workspace.spec.ts --output=test-results/adaptive-demo
```

The fixture performs real local TXT extraction, explicitly reviews the synthetic semantic graph, uploads two generated local PNGs, saves style/greeting settings, and publishes only to the isolated demo server. It exercises both a studio and bookstore vocabulary. The address is synthetic, not a live business location. Screenshots are written to the test output directory.

The primary browser scenario is: intro-only → address → email too → Items collection → first photo in the publisher's order → Back → map too → close only map → photo focus/return → keyboard modal image → done with photo → explicit replacement. It samples intermediate entry/return geometry and checks page scroll, opener focus, example labels and private original rejection. Additional cases retain two detail objects, filters and reading position on a 390 px reduced-motion viewport; ordinary browsing works with exhausted AI.

For an interactive local demo, use the existing keyless demo mode (`VOICE_BACKEND=demo VOICE_AI_MODE=demo npm run dev`) and ordinary Studio review/publish controls with the synthetic fixtures. Do not change environment configuration or enable a live provider for this scenario. The browser tests are the authoritative reproducible setup; their isolated data is intentionally temporary.

## Acceptance ledger

| Requirement | Evidence / test | Boundary |
| --- | --- | --- |
| Multiple same/mixed objects, add/update/focus/close/replace/reset | Adaptive reducer tests and desktop sequence | 12 objects, no silent eviction |
| Atomicity, idempotency, stale/publication/scene rejection | Adaptive contract tests; mocked voice ACK tests | No automatic repair generation |
| Semantic contact facts, qualified values, honest missing location/media | Shared retrieval tests and adaptive planner/rendering | Schematic reviewed coordinates only; no invented geocoding |
| Album order, contextual/example photos, current-publication authorization | Adaptive, media-runtime and media browser suites | Synthetic local images; no live interpretation |
| Actual open/mounted/full/partial/offscreen/obscured scene | Mocked-voice browser scene test plus server revalidation tests | Structural geometry, not pixel vision or proof of reading |
| Applied/failed/cancelled acknowledgment and interruption | Realtime-control unit tests; voice/quality browser suites | Mocked provider events do not prove live comprehension |
| Symmetric focus/return, retained instances/scroll/filters, keyboard/modal/reduced motion | Adaptive, motion, shared-reveal and quality browser suites | Intermediate geometry and screenshots, not just final DOM |
| External search coexists without changing graph; disabled opt-in | Search browser/server tests | Demo results and mocked map transport |
| Three layouts/palettes, three optional greeting points, save/publish/undo | Adaptive contract tests and Studio browser coverage | Offline text preview; natural live speech quality unverified |
| Standalone shared package / v1 compatibility | Packed independent consumer, rendering and contract tests | No Next.js/Firebase/provider dependency in package |
| Privacy and source lifecycle | Public route assertions, ingestion/media/semantic tests | No original artifacts in visitor serialization |

## Original assignment 2 verification run (historical)

Node **24.6.0**, existing locked dependencies, final local production build:

- `npm run check` — passed: ESLint, generated route types/TypeScript, **271 server tests**, **21 rendering tests**, packed independent consumer verification and Next.js production build. Zero unit/rendering failures or skips.
- `npm run test:browser` — **90 passed, zero failures/skips**, repeated against the final build including the phone composer-clearance adjustment. Group totals: ingestion **3**, workspace **5**, catalog/media/motion **32**, voice/chat **34**, external search **5**, existing synthetic billing regressions **11**. All provider/audio/map/payment transport in these tests is mocked or deterministic; no live transaction or paid provider was used.
- `git diff --check` — passed. No commit, deployment, package publication, emulator, personal browser, real microphone or paid API call was used.

The OpenAI documentation skill informed the Studio adapter's quiet `session.thinking.append` scene updates and the distinction between accepted intent and browser-confirmed display. This extends the existing application adapter, not the shared transport, and adds no automatic model response or paid retry.

### Inspected visual evidence

All images are synthetic fixture output, not claims about live publisher media. The focus tests also assert intermediate geometry numerically, symmetric travel/return, no page jump, focus restoration, retained scroll and phone composer clearance.

- [Desktop focused photo](../test-results/platform/workspace/adaptive-workspace-address-3a0f5--keyboard-lightbox-is-modal/desktop-photo-focus.png)
- [Desktop return in flight](../test-results/platform/workspace/adaptive-workspace-address-3a0f5--keyboard-lightbox-is-modal/desktop-photo-return-intermediate.png)
- [Bookstore phone, retained reading position](../test-results/platform/workspace/adaptive-workspace-booksto-b5e37-ilters-and-reading-position/bookstore-phone-focus.png)
- Narrow Studio previews: [balanced/midnight](../test-results/platform/workspace/adaptive-workspace-publish-3de3f-dio-preview-and-publication/studio-balanced-midnight.png), [editorial/forest](../test-results/platform/workspace/adaptive-workspace-publish-3de3f-dio-preview-and-publication/studio-editorial-forest.png), [compact/parchment](../test-results/platform/workspace/adaptive-workspace-publish-3de3f-dio-preview-and-publication/studio-compact-parchment.png).

Artifacts are local, uncommitted test output and are regenerated by the runner. The acceptance browser spec records the exact fixture setup and interactions; it does not use the user's Studio data.

## Assignment file inventory

The pre-edit baseline covered 297 existing source, documentation and test files. Of those, 252 remain byte-for-byte unchanged; the 45 paths below contain scoped assignment edits. No baseline file was removed. All five `lib/gpt-live/*` files are byte-for-byte unchanged. Pre-existing Studio brand/logo, fixed status/waveform and unrelated GPT-Live work were retained; no sibling FlowPath file, credential, root dependency lockfile or deployment configuration was edited. These are working-tree changes, not a commit.

New files (11):

```text
components/VisitorWorkspace.tsx
docs/adaptive-workspace-acceptance.md
docs/adaptive-workspace-architecture.md
lib/knowledge-display.ts
lib/site-style.ts
lib/visitor-workspace.ts
lib/workspace-screen.ts
packages/platform-ui/src/AdaptiveWorkspace.tsx
packages/platform-ui/src/workspace.ts
tests/adaptive-workspace.test.ts
tests/browser/adaptive-workspace.spec.ts
```

Existing baseline paths changed (45):

```text
app/api/sites/[siteId]/route.ts
app/api/visitor/[slug]/route.ts
components/EditorPanels.tsx
components/GreetingSettings.tsx
components/SearchExplore.tsx
components/SiteExperience.tsx
components/VisitorAssistant.tsx
docs/architecture.md
docs/catalog-experience-investigation.md
docs/component-interaction-system-proposal.md
docs/project-todo.md
docs/search-and-explore.md
docs/visitor-conversations.md
lib/ingestion.ts
lib/site-commands.ts
lib/site-greeting.ts
lib/site-model.ts
lib/use-visitor-session.ts
lib/visitor-model.ts
lib/visitor-provider.ts
lib/visitor-realtime-context.ts
lib/visitor-realtime-control.ts
lib/visitor-request.ts
packages/platform-ui/package.json
packages/platform-ui/src/ExternalSearchResults.tsx
packages/platform-ui/src/MediaViews.tsx
packages/platform-ui/src/compile.ts
packages/platform-ui/src/components.tsx
packages/platform-ui/src/contracts.ts
packages/platform-ui/src/index.ts
packages/platform-ui/src/styles.css
scripts/test-browser.mjs
scripts/verify-platform-package.mjs
tests/browser/media-runtime.spec.ts
tests/browser/media.spec.ts
tests/browser/motion.spec.ts
tests/browser/platform.spec.ts
tests/browser/search-explore.spec.ts
tests/browser/semantic-ingestion.spec.ts
tests/browser/shared-reveal.spec.ts
tests/browser/source-review.spec.ts
tests/browser/visitor-quality.spec.ts
tests/browser/visitor-realtime.spec.ts
tests/semantic-lifecycle.test.ts
tests/visitor-realtime-control.test.ts
```

## Calendar-question routing follow-up (2026-10-03)

The offline command guard leaves questions such as “Will you close next Saturday?” and “Can you close every Sunday?” on the ordinary content path instead of closing the focused object. Calendar periods following `this`, `next` or `every` defer; “close this panel” and the published title “Next Steps” remain valid close targets. This is a routing safeguard, not a source of business hours or general language understanding.

Six focused command tests passed, including sixteen calendar formulations that retain the focused card and three explicit closes that remove it. Scoped lint, TypeScript and the isolated production webpack build passed. No new browser, voice or live-model test was run for this follow-up.

## Narrow v1 comparisons (2026-10-03)

The shared v1 comparison now owns its responsive CSS container. A bare `PresentationView` in the visitor workspace and a comparison inside `CatalogExplorer` both switch to complete stacked records when the comparison itself is at most 600 px wide. A narrow desktop panel uses the same layout; widening it restores the existing table. Source values, entity controls and the separate v2 `TaskComparison` are unchanged.

The original CSS fails the new 320 px compact-visibility regression. Eighteen browser component checks now pass, including bare and catalog-hosted v1 comparisons at 320/390/1440 px, desktop panel resizing, long names/qualified values, keyboard focus and the existing v2/estimate/rich-table checks. Eleven shared rendering tests, scoped lint, the production webpack build with TypeScript, and the independent packed-package check also pass. Static component checks do not establish live model response quality.

Nine compiled-app cases used the frozen T. Schreiber, Arms Acres and Roberta publications at 320/390/1440 px, with all non-GET traffic mocked locally. Both compared entities and their formatted values survived; all eighteen keyboard detail/Back cycles, hidden-control focus exclusions and one live reduced-motion toggle passed, with no horizontal clipping. All 35 workspace/public-catalog/media file hashes remained unchanged. An initial harness check omitted the revision from an expected reference key; that failed run was retained and the incomplete cases passed with the exact key. T. Schreiber and Arms are manually curated controls; none of these checks proves automatic interpretation or live provider quality.

## Missing published values in v1 comparisons (2026-10-03)

When at least one compared item supplies an attribute, every item now keeps that attribute's label and shows `Not specified` for null, omitted or whitespace-only values. This replaces empty desktop cells and omitted mobile rows. Attributes missing for every compared item remain suppressed; published zero, false, units and qualified source wording remain intact. The change is local to v1 comparison rendering and does not fill the catalog, infer material or stock, or change v2 comparisons.

The two missingness rendering regressions fail against the prior implementation. With the fix, fourteen focused rendering checks, scoped lint, product TypeScript and the independent packed-package check pass. Fourteen distinct offline comparison browser checks pass across the existing v1/v2 controls and new 320/390/1440 px missingness cases, including semantic table/list labels, focus and overflow checks. The first desktop missingness run failed because its expected accessible name omitted browser-inserted whitespace; the corrected selector and all three new viewport cases pass. An independent source-fidelity review found no blockers. Browser evidence uses synthetic data and static shared-component markup with network requests blocked; it does not establish hydration, live-provider quality or automated website interpretation.

## Remaining live and platform limits

- Live GPT-Live/Luna speech comprehension, natural delivery of the three greeting points, real audio latency and physical-device acoustics need a separately authorized bounded live test. Offline success does not establish these.
- Phone and narrow-preview evidence uses isolated Chromium viewports, not a physical iPhone or a signed-in Safari/Brave session. Cross-browser and physical-device behavior remain separate verification.
- Arbitrary image regions, annotated media, diagrams, freeform 3-D, arbitrary publisher themes, new capabilities and graph infrastructure are not implemented. None is fabricated for the demo.
- Coordinates render only when reviewed and unambiguous. Otherwise the object explains the missing information; existing opted-in external map results keep their own provenance.
- Current browser awareness is bounded structural state. Only 24 child items are reported at once, and ordinary controls remain the fallback for unresolved or ambiguous references.
- Browser acknowledgments describe a matching committed display, not human attention, a completed spoken utterance or a conversion. Usage/quotas/billing/deployment remain their existing boundaries.
