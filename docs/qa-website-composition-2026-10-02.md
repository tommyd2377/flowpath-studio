# Website composition and source-fidelity verification — 2 October 2026

## Delivered behavior

Branding has a local **Suggest layout** review flow and optional bounded connected-model proposal. Applying a suggestion changes the local preview; Save draft and Publish remain separate. Every approved section remains available, saved styling is preserved, navigation uses truthful short labels, primary actions use registered destinations, and heroes use explicitly reviewed assets. Stale or rejected plans retain the ordinary website. Private review notes are omitted from publication. See [contract, workflow and limits](website-composition.md).

The importer preserves long HTML text tails and no longer assumes that bare dollar prices are USD. Explicit supported currency evidence is retained. Unknown/conflicting currency stays literal text with review notes and cannot enter numeric calculations. Existing bare-dollar test sources were deliberately left unchanged: changing their expected fields from invented USD amounts to literal, unconfirmed-currency text reflects the corrected source fidelity. Units, conditions, identity and complete price wording are still asserted.

Website cards and stories use lazy display renditions; heroes remain eager. The 2000-pixel derivative limit remains. No new responsive-image variants, OCR service, capability inference or source-layout replication was added.

## Verification

All checks used Node 24. No paid model calls were made by this task. Provider/quota tests use injected mocks; browser contexts use isolated demo storage and block external requests.

| Check | Result |
| --- | --- |
| Whole repository lint | Passed |
| Whole repository TypeScript | Passed |
| Production build | Passed |
| Packed independent platform consumer, including new composition subpath | Passed |
| Isolated staged snapshot, excluding concurrent unstaged work | TypeScript passed; **60 / 60 focused tests passed** |
| Server tests, final shared-checkout run | **1,153 / 1,154 passed**; one unrelated sibling parity failure |
| Rendering tests, run separately because the server test command stopped | **64 / 64 passed** |
| Composition browser suite | **6 / 6 passed** |
| Representative template browser suite | **3 / 3 passed**, each across Editorial, Showcase and Clarity at desktop/mobile and Studio preview |

The remaining server failure is `tests/gpt-live.test.ts`, “the installed sibling checkout has byte-identical Live runtime and browser architecture.” Concurrent Studio changes use different model defaults/instructions from the independent FlowPath checkout. This task did not alter that project, the visitor model policy or the test to hide the mismatch. Dynamic to-do was informed. The shared-checkout `npm test` command therefore remains non-green despite all generator-specific checks passing.

The browser suite uploads generated **CSV, saved HTML with more than 8,000 characters, and a simple text PDF** through the actual upload, extraction, proposal, review, apply and publication APIs. These are parser-backed **synthetic source evaluations**, not customer-source evaluations. It verifies source qualifications at the bottom of long details, unchanged knowledge revisions, rejected stale/invalid requests, repeated read-only local proposals, discard, Cancel focus return, Apply focus continuation, manual-edit cancellation, leaving Branding, private-note exclusion and clean publish state.

## Before/after result

The separate services A/B case uses a **curated synthetic catalog and generated illustrations**, not imported business data. The baseline first section and action were “Good work begins with listening.” The applied local plan leads with “Ways we can work together,” a short **Services** navigation label and an action targeting that collection. Every original heading, content record, qualification and saved style is unchanged. Both 1440-pixel and 390-pixel viewports fit without horizontal overflow. Card images decode at 1400 × 1100, with measured maximum displayed widths of 822 and 350 pixels respectively. This verifies the rendition change; it does not establish perfect DPR2 sharpness at the largest desktop width.

[Desktop before](screenshots/composition-2026-10-02/curated-services-baseline-desktop.png) · [Desktop after](screenshots/composition-2026-10-02/curated-services-planned-desktop.png) · [Mobile before](screenshots/composition-2026-10-02/curated-services-baseline-mobile.png) · [Mobile after](screenshots/composition-2026-10-02/curated-services-planned-mobile.png) · [Exact metrics](screenshots/composition-2026-10-02/curated-services-composition-ab.json).

Visual inspection found clear hierarchy, intact qualifications and no clipping or overlap. The deliberately repetitive long HTML fixture still produces a tall overview; complete text retention is not editorial condensation. [Imported CSV mobile](screenshots/composition-2026-10-02/synthetic-csv-mobile.png) and [long HTML final qualification](screenshots/composition-2026-10-02/synthetic-html-mobile-qualification.png) show the source-fidelity checks.

## Limits and coordination

No live model-generation or real-customer-source quality evaluation was run. The local planner demonstrates a bounded composition improvement, not general proof of Squarespace-level art direction. Screenshot critique, broader document structuring, scanned sources and responsive image variants remain future work.

The exact related Codex task is **Dynamic to-do**, ID `01a09071-c278-7c41-b210-6f0d04a1a187`. Supported thread messages shared ownership, findings and the parity failure. Its later turn is active, but explicit acceptance of Git integration ownership has not been received. Shared-file staging retains unrelated hunks; only the three Studio model constants required by the new provider are included from its `ai-model.ts` changes.

The exact origin is `tommyd2377/flowpath-studio`. Read-only GitHub inspection found stale empty Vercel/Railway check-suite records, zero check runs and no deployments, workflows, statuses, hooks or environments. No local provider project configuration was found. These records do not establish deployment linkage and do not contradict the user's direct confirmation that this project is tested locally. No deployment command or cloud-resource change was performed.

Detailed test logs and traces are retained locally under `/tmp/flowpath-generator-implementation-20261002/`; the selected visual evidence above is checked into the repository.
