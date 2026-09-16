# Whole-website conversational filtering

Implemented locally on 2026-09-15. The website is the query surface: there is no separate visitor collection browser beneath it. This document describes the current source; the earlier milestone reports are historical.

See [chat-only acceptance](chat-only-acceptance.md) for the latest removal of all filter forms, command-to-render flow, presentation refinements and verification. The port-3227 preview and earlier test counts below describe a saved historical snapshot.

## State and ownership

`VisitorTaskSession` owns scope, typed predicates, preferences, sort, query revision, result page, foreground detail/comparison, and a bounded navigation stack. `confirmed` snapshots the query histories, active query, page, foreground, navigation and display scene only after a browser receipt. New conversations and manual interruption resume that confirmed snapshot and cancel older generations. The client provider holds a projection of this session and rolls failed displays back to its last confirmed projection.

- `query.patch` refines, broadens, removes individual constraints or changes sorting. It closes the foreground and starts the updated query at its first page.
- `record.detail` and `selection.compare` retain the query and page in navigation history. `view.back` restores that page and ordering. Pagination retains the preceding page.
- `view.reset` removes scope restrictions, search, predicates, preferences and sorting and restores the full website. It retains selections and saved artifacts.
- `home` cancels pending work, clears filters and restores the publisher's configured opening. A website opening retains the complete website; an assistant opening returns to that opening. Clearing workspace panels remains a separate navigation action.
- Source information, photos and external evidence can still use existing workspace surfaces. They do not own collection filters. Entity filtering cannot be proposed through `update_workspace`; the chat and realtime adapters redirect those proposals to the typed task capability path.

Query history remains bounded to 20 revisions per query, eight queries and eight navigation entries. The visitor interface exposes one active composition. These histories are temporary visitor-session data, not publisher edits.

## Query to render to acknowledgment

1. Chat is the only filtering input. Clear commands use `websiteQueryCommand` through `query.command`; broader interpretation in chat and realtime voice uses `createVisitorTaskBridge`. Both reach the same typed executor and display acknowledgment. Navigation controls still propose their existing capabilities directly. Ordinary questions can retrieve without changing the screen.
2. `visitorTaskContext` resolves the current authorized publication. V1 catalogs are adapted into the same canonical space as V2 collection publications. The V2 repository loads the complete published index, including nested membership and records beyond the current page.
3. The deterministic query evaluator applies supported typed attributes and relationships to canonical records. Unknown, conflicting, conditional and inapplicable values remain distinct; prose does not establish prices, dietary claims, inventory or executable capabilities. Duplicate memberships do not duplicate entities.

   Lexical search also indexes complete published summaries and reading blocks. For V2, the server streams authorized, checksum-verified record chunks into token postings once per cached publication; it does not retain full bodies in compact index records or send them to the browser/model. Existing 128 MiB publication read and estimated index ceilings remain enforced. Cold initialization therefore reads more than the compact field index. Ordinary retrieval and detail pagination remain separately bounded.
4. The server returns a validated `VisitorTaskView`: exact count, bounded result page, stable result-set references, qualified fields, grouping and authorized media. The default page contains 24 records; the view contract permits at most 48. Counts describe the full query, not mounted cards.
5. `VisitorTasksProvider` supplies header, foreground and secondary task controls to `VisitorWorkspace`. `taskWebsiteSections` maps the ordered records into `PublishedWebsite` sections and `ContentCard`s. It preserves the server's order. Highly interleaved groups use one native section with category labels instead of repeatedly inserting headings.
6. Motion coordinates section exits, hero collapse and card layout changes. Canonical card keys and shared layout IDs preserve visual identity. Reduced motion removes layout travel. The provider waits for stable geometry, scrolls new content into view when necessary, and observes actual visible record IDs.
7. The browser posts the operation/query/result-set/scene binding to `/tasks` with `action: ack`. Only that receipt permits conversational completion. Later viewport observations update references after scrolling and resizing without replaying completion.

The bridge provides the assistant with the current typed query, qualified schema, result count, confirmed scene and foreground. A retrieval preview is not evidence that those records are displayed. Numbered results and ordinals in the confirmed page resolve by stable result code, including below-the-fold cards on mobile. Explicitly visible ordinals and foreground comparison references require a confirmed current scene; stale or ambiguous references require clarification.

## Native and imported layouts

Both generated and imported sites currently use `PublishedWebsite` with the publisher's balanced, editorial or compact layout and palette. The current checkout does **not** contain a preserved HTML/CSS visitor renderer: `nativeWebsiteContent` removes the obsolete `websiteLayoutRevisionId` and `websiteReadingRevisionId` references. Import is reviewed native composition, not exact source-markup reproduction.

For native V1 sites, reset restores the original website sections, prose, photo distribution and same-name grouping. Opening a group of distinct records with the same name exposes separate canonical results; their attributes are never merged. Filtered records reuse approved associated images, preserving illustrative labels. V2 sites restore a bounded all-publication page alongside the native introductory content. Neither path appends a detached results panel.

The assistant and website navigation remain available. Counts, active criteria and a restore control sit above matching native content. Search, hierarchy, fields and sorting are requested conversationally. The former disclosure and editable criterion controls have been removed; filter chips are passive context. Details and comparison are inline foreground content with Back. Secondary existing capabilities (selection, saved artifacts, research and synthetic action demonstrations) remain available in this same composition.

## Pending work and recovery

Pending work shows a subtle immediate message and keeps the previous useful composition. New typing, manual interaction, reset and Home supersede old requests. Server generation/revision checks and client abort/generation checks reject stale results. Failed execution or acknowledgment retains the last confirmed view and exposes recovery controls. No-match results keep the criteria visible and offer removal or reset; the system does not silently relax them.

The shared command interpreter is intentionally conservative and uses published field descriptors and values. It is available in chat even when model answers are exhausted or unavailable, without changing quota settings. The demo interpreter delegates to it. It supports common typed limits, category refinements/broadening, sorting, reset, Back and visible ordinals. Unsupported or ambiguous meanings ask for clarification. Connected model interpretation uses the same capabilities and display receipts, but its language quality and live speech recognition require separately authorized live testing. No paid retries were added.

## Removed interface and code map

Removed: the “Browse and filter collections” launcher, detached task-browser/query-surface wrapper, `QueryCollection` presentation, its separate results cards, the filter/sort disclosure and forms, editable filter chips, fallback website search form/state, the redundant Retrieved records presentation, and unused styles. Query contracts, repository/index, capabilities, validation, publication review, task execution and non-filter task components remain.

| Area | Files |
| --- | --- |
| Session and confirmed state | `lib/visitor-task-store.ts`, `lib/visitor-capabilities.ts` |
| Authorized whole-publication query | `lib/visitor-task-context.ts`, `lib/catalog-query.ts`, `lib/catalog-query-index.ts`, `lib/catalog-repository.ts` |
| Shared conversational execution | `lib/visitor-task-bridge.ts`, `lib/visitor-chat-task.ts`, `lib/visitor-realtime-control.ts`, `lib/visitor-task-runner.ts` |
| Transport and manual execution | `app/api/visitor/[slug]/route.ts`, `app/api/visitor/[slug]/tasks/route.ts`, `components/VisitorAssistant.tsx` |
| Website projection and acknowledgment | `components/VisitorTasks.tsx`, `components/VisitorWorkspace.tsx`, `components/SiteExperience.tsx`, `lib/use-task-viewport.ts` |
| Native rendering, media and motion | `lib/website-presentation.ts`, `packages/platform-ui/src/PublishedWebsite.tsx`, `collection-space.ts`, `styles.css`, existing shared Motion infrastructure |
| Shared contracts | `packages/platform-ui/src/task-view.ts`, `query.ts` |
| Offline interpretation and fixtures | `lib/visitor-demo-query.ts`, `fixtures/visitor-tasks.ts` |
| Regression evidence | `tests/whole-website-query.test.ts`, visitor query/task tests, `tests/browser/visitor-tasks.spec.ts`, `visitor-realtime.spec.ts`, `published-website.spec.ts`, `website-import.spec.ts` |

## Earlier verification snapshots

For the current chat-only follow-up, see [chat-only acceptance](chat-only-acceptance.md). The results below describe the earlier implementation snapshots.

Verification used Node 24, the existing isolated Playwright Chromium binary and a source snapshot taken from the working checkout, including concurrent changes present at that time. The snapshot excluded environment files and private workspace data. Browser servers used `VOICE_BACKEND=demo`, `VOICE_AI_MODE=demo`, fresh synthetic data and port 3225. No personal browser profiles or paid providers were used.

| Check | Result and scope |
| --- | --- |
| `npm run check` | Passed: lint, typecheck, 465 server tests, 21 rendering tests, packed independent consumer and production build. |
| Final presentation follow-ups | Lint, typecheck and production build passed again after the final client changes. |
| `npm run test:browser -- tests/browser/visitor-tasks.spec.ts` | 5 passed: 10,000-record streamed import/review/apply/publish; filtering beyond the first page and into a record body; canonical deduplication; product/service refinements; broadening; sort; unknown price; detail/Back; mobile below-the-fold ordinals; failure/empty recovery; pending state; newer requests/Home beating held responses; keyboard selection; viewport references; reduced motion; retained synthetic capabilities. |
| `npm run test:browser -- tests/browser/published-website.spec.ts tests/browser/website-import.spec.ts` | 6 passed: native layouts, distributed approved images, distinct same-name records, full-text imported reading, mobile, Home, exhausted-chat navigation, and retained import review behavior. |
| Focused realtime browser cases (command below) | 3 passed: shared real query state behind mocked transports, display receipts, foreground transitions, manual supersession and Home on desktop/mobile. |
| Focused compatibility browser cases (command below) | 2 passed: bounded detail field pages with Back to results; retained publisher links and deduplicated photo-album browsing. |

```sh
npm run test:browser -- tests/browser/visitor-realtime.spec.ts --grep 'mocked chat and voice share|foreground cards yield'
npm run test:browser -- tests/browser/adaptive-workspace.spec.ts --grep 'long published details use|explicit v2 migration'
```

The 16 focused browser cases use actual React layout and Motion. Assertions sample the hero's collapsing height, verify reduced-motion settling, check that filtered content reaches the viewport from near the footer, and keep the first matching card within the initial mobile viewport. Screenshots of desktop/mobile filtered and restored sites were visually inspected. The large publication mounts 24 records at a time and keeps task-view payloads below 150,000 bytes. This is targeted browser coverage, not a claim that the entire browser suite was rerun.

Logs, source hashes and representative screenshots are saved under the ignored local directory `test-results/whole-website-filtering-2026-09-15/`. No commit, push, deployment, credential/configuration change or user-content publication was performed. The review/apply/publish calls in tests affected only synthetic publishers. Concurrent navigation/workspace changes in the checkout were preserved.

Additional concurrent voice/runtime and workspace timing changes arrived after the final browser snapshot. They were preserved; the source-hash manifest records which files differ. The browser results and port-3227 preview cover the saved snapshot, not those later edits. The overlapping files include `VisitorAssistant.tsx`, `VisitorWorkspace.tsx`, `visitor-realtime-control.ts` and `AdaptiveWorkspace.tsx`.

A follow-up on the latest working checkout passed `npm run typecheck`. Its `npm test` run passed 452 of 465 server tests and failed 13 cases in `tests/visitor-realtime-control.test.ts`; rendering tests did not run because the server suite failed. Twelve failures expect a second model response that the concurrent direct-navigation confirmation changes skip; the remaining failure concerns superseding an old navigation timer and acknowledgment after changed speech cancellation. These later voice changes were not reverted or repaired in this filtering task. The saved snapshot's 465 server and 21 rendering tests passed before those changes arrived. See `current-checkout-followup.txt` in the evidence directory for the failure summary.

### Running preview and manual sequence

The existing development server remains on `http://127.0.0.1:3220`. A separate verified production build runs with only this task's synthetic data and offline providers on port 3227:

- Products: `http://127.0.0.1:3227/s/website-products-1789484365916`
- Services: `http://127.0.0.1:3227/s/website-services-1789484383817`

On the product preview:

1. Type “Show me chocolate cakes”, then “Only those under $40”. Expect 14, then 6 matches; the unknown price does not qualify.
2. Type “Include vanilla too”. Expect 13 matches. Type “Sort price descending”.
3. Type “Open the second one”, then “Go back to those results”. The filtered page and ordering return. Numbered results remain addressable on mobile even below the fold.
4. Open another item and type “Remove the price limit”. Expect 27 matches and the foreground detail to close.
5. Type “Remove the flavor filter”, “Undo”, or “Clear search” to revise criteria. Use Enter to submit and Escape to dismiss the expanded composer. “Show everything again” restores all 40 records and introductory content. Home restores this publisher's website opening.

Also try “Show the larger sizes” after filtering; the published size attribute orders the same composition from larger to smaller. No unpublished size or capacity is inferred.

For the service preview, use “Show me remote”, “Only those under $40”, and “Include studio too”; the same engine uses the published service fields and price basis.

### Remaining limits

- Live model interpretation, microphone capture, recognition and spoken audio were not tested. Mocked voice verifies transport/execution/acknowledgment behavior only. Live tests require task-specific authorization and a bounded call budget.
- The offline language preview is conservative; complex unsupported wording asks for clarification. The typed executor supports the published query/relationship contracts and retains their existing bounds.
- Current imports render native FlowPath layouts. There is no preserved source-HTML renderer or promise of exact source-site visual reproduction.
- Full-text index warm-up reads bounded published record chunks on a cold cache. The existing read/index ceilings and 24-record default page remain in force; this work does not establish performance beyond the supported 10,000-record synthetic publication.

## Photo request follow-up

On 2026-09-15, three authorized live chat submissions of “Show me your photos” were tested in the Codex in-app browser at `http://127.0.0.1:3220/s/doc-s-cake-shop`. Two failed before a gallery appeared; one displayed the published album and received a successful browser acknowledgment. The classified failure was `stale`. These are real chat/provider observations, not microphone or speech-recognition tests.

The model-facing `update_workspace` contract previously required the model to copy the workspace publication identity as well as separate catalog/media revision identities. A catalog or media revision copied into the batch's publication field reproduces the same publication-rejection category offline. The live trace classifies the failure but does not retain the model's raw arguments, so that exact erroneous value was not captured.

`workspaceToolJsonSchema` and `parseWorkspaceToolReply` in `lib/visitor-workspace.ts` now let the model propose operations and an optional scene revision. The server supplies `schemaVersion`, `requestId`, `publicationId` and `baseRevision` from the context used for that model turn. Both `visitor-chat-task.ts` and `visitor-realtime-control.ts` use this path. The voice adapter retains the model-turn snapshot while awaiting its response. Publication/reference checks and the client's stale-view guards still apply. Fully specified legacy batches remain validated as supplied; incorrect identities are never silently repaired.

Chat error events now carry bounded failure classifications into Developer diagnostics. Schema paths retain only approved field names and numeric positions; arbitrary keys are redacted. Provider status codes are retained without provider response bodies, prompts or credentials. The visitor-facing error remains separate from diagnostic metadata.

Focused verification passed 73 tests across workspace tool binding, realtime control, chat streaming and diagnostic sanitization. New cases cover photo display acknowledgment, omitted server-owned identities, incorrect legacy identities, changed views and unpublished media. A subsequent full check of the combined working checkout passed lint, typecheck, 490 server tests and 21 rendering tests; the earlier 13 voice test failures are no longer present in that run.

After the fix, the actual in-app browser also verified the manual Published photos scope: 58 matching published images, a bounded 24-record page, and visibly loaded cake photos in the native composition. This manual path makes no model calls. An approved follow-up live submission of “Show me your photos” subsequently displayed the 57-image album. The broader acceptance set and remaining provider limitations are recorded in [chat-only acceptance](chat-only-acceptance.md). Logs and the source comparison are saved in the ignored `test-results/photo-request-2026-09-15/` directory.
