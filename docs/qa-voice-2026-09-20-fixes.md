# September 20: photo, menu and screen-awareness fixes

Implemented after the publisher authorized the six changes from the recorded-session audit. These are shared Studio/runtime changes, not cake-shop-specific rules. No publisher content, photo labels, publication, credentials or production configuration was changed.

## Evidence

The [11:05 audit](qa-voice-2026-09-20-1105.md) remains the source for the rejected `published-photos` reference, prose menu selection, cancelled work and oversized website images. The later recording `b0b066bd-3eb3-4311-8672-713d35cad981` (11:10:28–11:13:45 America/New_York) exposed additional failures:

- A clarification retained an older detail record. The old detail won the renderer's precedence, and the browser acknowledged IDs from that view instead of the clarification. The server correctly rejected that receipt.
- A batch added two photo albums without an explicit focus operation. The old focused photo stayed primary. A final text answer then took priority because `update_workspace` did not carry the confirmed-display flag through the task runner.
- The resulting surface placed a 546-pixel-wide gallery at y=926 in a 902-pixel-high viewport. Its first photo began at y=960. The second album was absent from the composition. Confirming the outer surface was not proof that the requested photos were visible.
- A screen update included photo IDs and repeated content in 48 fragments, about 16.9 KB, with approximately 39.6 seconds of observed delivery. Browser state was available to the backend, but that does not establish what the voice understood at any instant.

Evidence is transcripts, validated tool calls, browser state, receipts and delivery timing. Hidden model reasoning and unrecorded audio cannot be reconstructed.

## Changes

| Area | Implemented behavior |
| --- | --- |
| Photo references | The virtual published-photo collection advertised by the task catalog is also recognized by workspace tools. It resolves only current, approved photos with publication/revision checks intact. Collision handling preserves an existing publisher collection. This is not an automatic gallery fallback for unrelated requests. |
| Gallery and answer composition | Successful workspace tools preserve their display result through the closing answer. Newly requested objects get focus when the batch omits it. Albums requested together share one wide grid, deduplicate shared photos and keep their original IDs for navigation. Old prose does not squeeze the grid into a supporting column. Previous compositions remain in Back/Forward history. |
| Honest screen receipts | Receipts check the requested region, visible grid items and loaded visible photos, not only the outer frame. Context distinguishes offscreen content and reports visible item IDs/counts. Clarification has precedence over retained detail; its receipt excludes IDs from the old detail or unrelated photo grids. |
| Timely voice context | The main screen observation fits a single bounded context fragment. Full references remain available to backend tools. Up to four visible photo labels use a separate channel, so paging does not resend the previous answer or contact facts. Existing content and research memory remain separate from visibility. Provider delivery is not proof of comprehension. |
| Structured menu/catalog requests | Explicit browsing of a named collection takes priority over a same-named article; explicit opening still supports article detail. Backend guidance prefers structured items for menu, catalog, service, portfolio and itinerary browsing. Mixed calculations/research requests still go to the model intact. No cake-shop vocabulary is hardcoded. |
| Recovery and website proportions | Reconnect starts in listening mode without first authorizing a response to retained history. Fresh speech received during readiness remains eligible. Task preparation detects a changed server generation; restoration refreshes metadata before restoring the retained view, without replaying model work or removing stale-state guards. Regular website priced products/services use bounded thumbnails and readable rows across all three templates. |

The existing Motion transitions, whole-state history, reduced-motion behavior and media playback lifecycle are preserved. Loading failures leave useful descriptions available but are not successful photo displays.

## Verification

- Production build, lint, TypeScript and packed-package checks **passed** locally.
- Server suite: **665 passed; one existing sibling-checkout byte-parity check failed.** That check compares Studio with the separate FlowPath repository. A pre-edit baseline comparison already differed; the new optional listening-mode startup also needs reconciliation there. The other project was not edited. The failure was not skipped or rewritten to pass.
- Rendering suite: **30 passed** (run separately because the aggregate script stops after the server-suite failure).
- Final isolated browser passes: **31 passed** — 26 information-surface/history/receipt cases and five website cases. Coverage includes multiple requested albums, an offscreen-gallery rejection, clarification after detail, a fresh question after a server-generation change, Back/Forward, products/services, reduced motion and mobile geometry. Priced menu/service images and three hero aspect ratios passed across Editorial, Showcase and Clarity at desktop/mobile sizes. An initial combined run exceeded the unchanged 12-site demo fixture cap; running the groups on separate isolated servers resolved that setup issue without changing the quota.
- Visual inspection: [desktop combined grid](screenshots/information-surface/combined-photo-grid-desktop.png), [mobile combined grid](screenshots/information-surface/combined-photo-grid-mobile.png), and synthetic priced-item screenshots under `test-results/six-fixes*`. Photos are at the top of the information surface; menus use compact image/text/price rows.
- Actual published cake-shop page: reloaded in the in-app browser on the restarted local server, then inspected at mobile and 1440-pixel desktop widths. The first priced image was loaded and measured 96 pixels square on mobile and approximately 170 pixels including the desktop image treatment; its row measured about 253/213 pixels tall respectively. This verifies the previously oversized website rows with the real publication, without invoking chat or voice. The illustrative labels and image assignments were not changed.
- Browser providers are mocked; catalog operations, history restore, generation checks and display receipts use the real isolated local implementation. External requests are blocked. No new paid API calls were made.

The isolated test servers are stopped. The normal local server remains on `http://127.0.0.1:3220`, with a fresh cake-shop tab ready for the requested manual voice test. Voice and recording have not been started.

## Manual acceptance still needed

Refresh the local published page before testing. Record one short session: show all photos → show the menu → narrow to an item → show its photos → Back/Forward → Home → reopen photos. Then pause/reconnect and make a fresh request. Check recognition, interruption, audible grounding, actual model tool selection and whether the visible result agrees with speech. Those are not proven by mocked tests.

Keep broader follow-ups in [the master list](project-todo.md): greeting-point display, research/memory applicability, imported-content lifecycle, photo-labeling guidance and complex multi-step voice cases. Do not infer verified photo identities from the illustrative test assignments.
