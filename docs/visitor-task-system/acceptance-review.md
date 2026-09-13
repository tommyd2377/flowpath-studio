# Independent visitor task system review

Reviewed 2026-09-13 against the architecture, implementation plan, implementation prompt, report, current source and independently executed checks. Baseline: `64c8676`, with the uncommitted task implementation on `codex/visitor-task-system`. Validation used a separate filesystem snapshot and isolated synthetic data; the user's port 3220 server and saved sites were left untouched.

## Verdict

The main task/query architecture is implemented and can be tested with an existing site. **R1–R4 now have local fixes and regression coverage.** The initial findings below are retained as the reproduction record; the follow-up verification section records the checks on the fixes. The requested PDF upload limit remains 10 MiB. Live provider/device and deployed-production acceptance remain separate.

Code and tests establish portable contracts, hierarchical records/collections, deterministic filtering, shared capability execution, dependent evidence, cancellation/receipts, editable artifacts, demo adapters, and a bounded 10,000-record import-to-browser path. They do not establish live model interpretation quality, microphone behavior, production Firebase behavior or real commerce/scheduling integrations. M7 remains unperformed.

## Initial reproduced findings (before fixes)

### R1 — P1: source-to-collections conversion loses publisher corrections when repeated

In [the collection migration route](../../app/api/sites/[siteId]/collections/route.ts), `migrate` calls `repository.begin` without `previousReviewId`. [CatalogRepository.begin](../../lib/catalog-repository.ts) carries record, metadata and membership corrections forward only when that previous review is supplied. The JSONL import route does supply it, so the existing JSONL reimport test does not cover this separate source-migration path.

Independent reproduction used actual local owner routes: upload and interpret a synthetic two-record source, apply knowledge, migrate, rename a record to `Publisher corrected label`, apply collections, and migrate the same source again. The new review's record name reverted to `Original source label`. The current publication is not overwritten by opening this review; accepting and publishing the regenerated review would discard the correction.

Required follow-up: preserve the applicable previous source-conversion review and its corrections through repeated conversion, changed source data, renamed records and rejected memberships; retain revision/ownership checks. Also explain or reconcile the explicit synchronization boundary: once a v2 collection publication is selected, new v1 source knowledge is not automatically incorporated into that manifest.

### R2 — P1: visible-card references remain tied to a previous viewport after scrolling

[VisitorTasks.show](../../components/VisitorTasks.tsx) records visible IDs when an operation renders, but does not update or invalidate that scene on scrolling/resizing. [reference.resolve](../../lib/visitor-capabilities.ts) trusts the stored IDs while the query/result set remains unchanged. Repeated display acknowledgments for one operation also return before refreshing the scene. [The model bridge](../../lib/visitor-task-bridge.ts) does not explicitly expose the current acknowledged task scene in its instruction data.

Independent mobile browser reproduction: an interaction acknowledged records 5–8. Scrolling showed records 17–19 with no new task scene acknowledgment. A real `reference.resolve` operation for visible ordinal 1 successfully returned record 5, which was no longer visible. This used the actual UI and server, with no model call. The test observed the defect; it is not a passing acceptance result for screen awareness.

Required follow-up: distinguish completion receipts from ongoing viewport state; update or invalidate scene authority on viewport changes, bind references to a fresh scene revision, and provide the relevant bounded scene to both channels. Verify scrolling, resizing, detail/comparison focus, page/sort changes, and manual interruption. Stable displayed codes/names can be used during initial testing; visible ordinals should not be signed off yet.

### R3 — P2: removing a facet's own filter can leave an empty OR expression

[withoutField / withoutNode](../../lib/catalog-query.ts) preserve a group even when every child was removed. An empty `any` group evaluates false. With a single `flag = true` clause inside `any`, the facet reports no values and zero unknown records; the equivalent `all` case correctly reports false: 4, true: 3, unknown: 1 on the same eight-record fixture. Own-field exclusion should not erase all possible facet values. The same pruning pattern also needs coverage for zero-result alternatives.

Required follow-up: define pruning semantics for emptied and nested Boolean groups, retaining genuinely empty input expressions' intended meaning; test equivalent AND/OR groupings, NOT, multi-field groups and explicit zero-result refinements without mutating the active query.

### R4 — P2: initial chat submission can precede assistant readiness

The existing `tests/browser/motion.spec.ts:258` scenario, on a published site with ordinary sections and no knowledge catalog, failed twice at the first chat submission: two requested cards never appeared. The text remained in the composer. The browser suite therefore did not finish green unchanged.

A diagnostic copy that filled the composer, waited for its `Wedding stories` suggestion to become enabled, and then pressed Enter passed the entire scenario, including additive views, focus/return and retained scroll. The availability guard in [VisitorAssistant.sendChat](../../components/VisitorAssistant.tsx) returns before submission while the asynchronous availability state is absent; that guard is also present in baseline `64c8676`. This is evidence of a readiness race, not proof that the new task implementation introduced it. The diagnostic wait was not added to the repository test, and no runtime fix was made.

Required follow-up: make readiness visible and prevent or deliberately queue early submission; stabilize the motion test against an explicit readiness signal without dropping its visual assertions. Add a separate delayed-availability test covering the early-submit behavior. Until then, wait for enabled assistant controls before your first chat request.

## Fixes and follow-up verification — 2026-09-13

The user requested shutdown and fixes. Port **3220 was stopped before edits** and remains stopped. Changes build on the existing uncommitted implementation and PDF cap change.

- **R1:** Source conversion now supplies the explicit current review, or resolves the latest site-owned review/publication fallback, to the existing correction merge. It refuses to replace an unfinished import/Apply. A regression uses actual owner routes to carry a corrected name, collection metadata and rejected membership across changed source values and a new source record; implicit/explicit previous-review paths, stale revisions and cross-site review rejection are covered. Studio explains the explicit source Apply → refresh collection review → Apply collections → Publish sequence.
- **R2:** `lib/use-task-viewport.ts` observes visible records on scroll, resize, visibility and layout changes. It invalidates a moving scene and sends a settled observation after a 150 ms debounce, suppressing unchanged observations. `action: scene` validates operation/generation/query/result identity and allowed IDs. `VisitorTaskStore` persists this in a separate `scene-<sessionId>` document in its existing namespace, with its own CAS revision; viewport writes do not increment task revisions or repeat completion receipts. Both channel bridges receive the bounded current scene with canonical IDs/names. Visible ordinal resolution requires its exact revision, and dependent evidence carries that revision through later capabilities. Old observations, hidden/moving scenes, stale references and stale evidence fail explicitly. The task route awaits capability execution inside its error boundary so asynchronous stale-state failures produce the intended 409 clarification response instead of an opaque 500. Task state retains its active display result so read-only steps cannot prune its viewport authority.
- **R3:** Facet/refinement pruning removes groups emptied by removal while preserving the semantics of originally empty expressions. The regression covers OR/AND/nested NOT, remaining sibling criteria, explicit empty OR, zero-result alternatives and input immutability.
- **R4:** Chat announces “Getting the assistant ready…” and makes the composer read-only with submission disabled until availability resolves. A delayed-response browser regression exercises early Enter and the first ready submission; the existing legacy motion scenario retains its original interactions and visual assertions. A separate existing photo-motion case now waits for the prior composer/backdrop animation before capturing its scroll baseline; its motion, focus and scroll assertions are unchanged. The focused three-case motion/readiness run passed.

`npm run check` passed on the fixes: lint, typecheck, **393 server tests**, **21 rendering tests**, packed-consumer verification and production build. Both mocked channel contexts were 29,104 bytes before display; tests also assert the acknowledged scene and its invalidation in both channels. Log: `/private/tmp/flowpath-review-fix-check.log`.

**The final complete isolated browser suite passed all 108 cases with zero failures:** tasks 3, ingestion 3, workspace 10, website 2, core 33, mocked voice 19, quality 20, search 7 and synthetic billing 11. Log: `/private/tmp/flowpath-review-fix-browser-final.log`. The two added cases passed alongside all 106 prior scenarios, including the original legacy chat/motion case. The viewport regression uses actual DOM visibility and task HTTP routes and checks stale-reference HTTP 409 responses; the delayed-availability case uses a held mock response. Focused browser test lint and `git diff --check` passed. Final port checks found no listeners on 3220 or 3225.

The baseline source hash comparison found only the scoped fixes/tests/documentation changed; no baseline files were deleted. This does not establish live speech/model quality or deployed Firebase behavior. No paid calls, deployment, commit or push were performed.

## Initial independent verification

- `npm run check` passed: lint, typecheck, **390 server tests**, **21 rendering tests**, packed independent package consumer, and production build.
- Additional typecheck and focused lint passed after enlarging the existing HTTP PDF browser fixture.
- Four focused existing browser acceptance cases passed: 10,000-record actual Studio import/review/Apply/Publish/browse, mobile no-AI selection/artifact/demo actions, v1 conversion preserving links/photos, and mocked chat/voice shared query state with late-result rejection.
- Additional offline probes reproduced R1 and R3; an actual isolated mobile browser/server probe reproduced R2.
- Across all browser groups, **105 of 106 existing acceptance scenarios passed**, including the updated PDF fixture. The grouped command stopped at R4; the remaining four groups were then run independently and all 57 passed. R4 failed again in isolation; its diagnostic readiness-gated copy passed. Do not describe this as a clean, unchanged full-suite pass.
- Exactly 10 MiB is accepted by the upload reader; one byte more is rejected by upload and extraction. Invalid signatures and smaller non-PDF limits remain enforced. An actual local owner-route PDF larger than 2 MiB is parsed and produces a validated review candidate. The existing production-server HTTP test now uploads and extracts a real PDF slightly above **9 MiB**, below the 10 MiB cap, and passed.
- A synthetic published v1 site with no collection manifest successfully initialized the real task route and returned both source records without explicit migration, validating the reuse guidance below.
- Paid APIs, live search, real microphone/audio, cloud persistence and deployed hosting were not exercised. Demo cart, tax and appointments use synthetic data only.

## PDF change

Both [upload validation](../../lib/file-validation.ts) and [source extraction](../../lib/source-extractors.ts) now accept PDFs up to **10 MiB**, displayed as 10 MB alongside the existing photo limit. [The Files panel](../../components/EditorPanels.tsx), README and platform documentation agree. DOCX/XLSX/HTML remain 2 MiB; CSV/TXT remain 256 KiB. The 100 MiB site storage quota and 20 non-image source-file cap remain.

PDF interpretation still requires readable text, at most **40 pages** and **60,000 extracted characters**, and has a bounded parser deadline. Scanned/blank-page PDFs are not automatically OCRed, and embedded PDF images are not automatically extracted into a photo library. Ordinary document interpretation retains the legacy 100-entity cap; the verified 10,000-record path uses streamed canonical JSONL imports. Larger upload size does not remove these processing boundaries.

This code applies in local and Firebase modes when released. No deployment was performed. The production host is not established by this review: [Vercel Functions' 4.5 MB request limit](https://vercel.com/docs/functions/limitations), for example, would require an authorized direct-to-storage or chunked transport before the full 10 MiB could reach this route. Files are sent through the application server today. See [platform limits](../platform-foundation.md#current-pilot-limits).

## Test without starting over

Your existing site, uploads and published knowledge can be reused. The visitor task context adapts existing v1 published knowledge automatically. **No deletion, re-upload, new site or explicit collection migration is required merely to test filtering against that knowledge.**

1. Use the updated local app at `http://127.0.0.1:3220`. If the server is stopped, select Node 24 and run `npm run dev` in this repository; its predev script builds the shared UI package. If it is already running but showing old shared components, rebuild with `npm run build:platform` and refresh. Keep the same backend and data configuration.
2. Open the actual published `/s/<slug>` page in a fresh tab or refresh it. The Studio preview is not the live visitor chat/voice path. If you only have a draft, review it and publish it yourself first.
3. Click **Browse and filter collections**. Choose a collection/subcollection, enable or disable **Including subcollections**, search for a known record, and edit filters/sorting using fields the publication actually contains. Counts should reflect the full scope, with missing facts remaining unknown.
4. Add two criteria, edit only one, and check the other remains. Try **Undo criteria**, selection/comparison, an artifact and **Home**. Return to collections and confirm selections and a saved artifact remain within the same visitor session. Export anything you need to retain outside the session; the implementation is not permanent account-based artifact storage.
5. Test chat with the same content after “Getting the assistant ready…” clears: “Show [existing collection]”; “Only those with [published field/value]”; “Change that to [another value], keeping the other filter”; “Compare [two displayed names/codes]”; “Make a brief from those”; “Take me home.” Use real names/fields from your site instead of expecting fields absent from the PDF. Repeat by voice afterward. Shared logic passing in chat does not prove speech recognition, microphone permissions or startup/audio latency.
6. Once enabled by the publisher, test research as a separate chain: select a known record, ask for additional web information, then images or a map based on returned evidence. Check that external information is attributed and does not overwrite publisher facts. This review has not live-validated those provider calls.

For **new hierarchy review**, optionally choose **Knowledge → Review source knowledge as collections → review → Apply collections to draft → Publish** and refresh the visitor page. Repeated source conversion now preserves matching publisher corrections. Existing published data does not need this step for basic task filtering.

For a **new PDF**, use Files upload, then Knowledge → select source → Interpret source → review → Apply to draft → Publish. Existing successfully interpreted PDFs need not be reinterpreted merely because the upload cap changed. A separate test site is useful only if you want to avoid mixing the new brochure with your current topics. If the site already uses a v2 collection manifest, source changes require a corresponding collection review/application before publishing the new queryable records. Review the refreshed collection proposal before applying it.

Recommended next action: when ready to test again, restart the local app and use the manual chat/voice sequence with the existing site. Do not rebuild or discard it. Live provider/device acceptance remains separate from the offline fixes.
