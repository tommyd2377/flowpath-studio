# Labeled photos, whole-state history and chat QA — September 19, 2026

## Scope and authorization

The publisher explicitly approved updating the Doc's Cake Shop draft **and publishing test photo labels**, including arbitrary assignments, and a **fresh $3 maximum** for chat QA in the Codex in-app browser at `127.0.0.1:3220`. This is separate from the earlier exhausted/uncertain testing allowance. No voice connection, external image search, real transaction, deployment or Git push was started during this run.

Runtime changes use shared publisher-independent code. Actual published content was exercised through chat in the in-app browser; additional product/service and media scenarios used synthetic content and mocked providers on the isolated browser server.

## Published test data

- All **57 non-logo photos** now have menu-based names, prices and approved record associations across **31 cake/slice offerings**: 52 retail photos and five whole-cake size photos.
- Assignments are intentionally illustrative: association role `example`, alt text ending in `— test image`, and short captions ending in `Test illustration`. Appearance does not establish the cake's identity. Starting-price qualifications remain on the corresponding published records.
- The existing logo and original 57-photo album order were preserved. Additional slice/whole-cake albums make the assignments inspectable.
- Only the media changes were published. An unrelated draft opening change remains a draft.
- Verified site revision: **160**. Published media revision: **`823d3e98-d797-4d08-bb38-6a5971c50e8e`**. Site: `doc-s-cake-shop` (`f35ef6c5-f9c0-472c-9e39-38db3548aab9`).

Local before/after backups and one-off mutation scripts are retained in the ignored `.visitor-recordings/photo-label-qa/` directory. They are revision-specific checkpoints, not scripts to rerun casually. The full published photo query contains 58 records because the unchanged logo remains included. Some imported images are decorative strips/icons; all were retained as requested and labeled as test illustrations.

## Shared implementation and defects fixed

1. **Back and Forward restore whole compositions.** Both controls and typed commands restore the query, ordered results, answer, selected content, supporting media and reading position. New committed information branches history; no-ops and cancelled requests preserve Forward. History is bounded across both directions. Server restoration retains later receipts without replaying searches, calculations or business actions.
2. **Cancellation and observation races no longer create phantom history.** Back owns its restoration while aborted requests unwind. Rapid navigation waits for an active restoration. Refresh/interrupt observations preserve the current task bookmark. Display acknowledgments wait for settled motion and restored task observations.
3. **Collections and galleries use responsive Motion grids.** Excluded entries leave downward and remaining entries reflow into place; Back reverses the travel. Stable keys preserve retained content. Departing entries are inert and excluded from visible-state observations. Desktop collections can use 80% of the viewport; mobile photo grids use two columns, with compact counts and readable record layouts. Image frames have consistent proportions. Exact redundant importer summaries/prices are compacted while authored descriptions and qualified price terms remain.
4. **Explicit all-photo requests clear obsolete offering filters.** Live QA found that “Show me all the photos” inherited a price constraint from cake filtering, excluding photos without price fields. Explicit all-members scope changes now reset the old criteria, ordering and preferences. Ordinary refinements preserve constraints. This implements the requested scope; it is not an automatic gallery fallback.
5. **Typing after Home and the first mobile Send click work.** Live QA found that a wrapped message grew beyond a fixed-height dock, allowing the Chat toggle to cover Send. The dock now grows with its content. Editing a focus-restored composer reopens the assistant layer. A regression checks the actual hit target and one submitted request at mobile and desktop widths.

The [information-surface guide](information-surface.md) describes history limits, authority, media continuity, motion and recovery behavior.

## Manual in-app browser results

Recording: **`5e5a5425-c21d-4749-929b-2184385acb78`** — [local timeline](http://127.0.0.1:3220/dev/recordings?id=5e5a5425-c21d-4749-929b-2184385acb78). The recorder retained transcripts, model requests/results, tool calls and surface receipts; it stopped with zero dropped events. The session includes the initial reproduction, development refreshes and subsequent retests.

| Chain | Observed result |
| --- | --- |
| Show the cake menu → only those under $10 | 31 menu records, then 13 qualifying records. Desktop grid and compact price layout inspected. |
| Keep only blue velvet, excluding red velvet and nuts | One Blue Velvet offering at $9 per slice; the earlier under-$10 constraint remained. |
| Back → Forward → open details → typed Go back → typed Go forward | Restored the 13-item view, one-item view and the same Blue Velvet details with its price. |
| Show all photos after filtering cake prices | Reproduced the empty result, fixed the shared scope reset, then verified all 58 published photo records. |
| Only photos labeled Blue Velvet, without nuts or red velvet | Two matching labeled test photos. Mobile two-column grid and example labels inspected. |
| Hypothetical 8% tax on two $9 slices | Subtotal $18, tax $1.44, total **$19.44**. |
| Take me home → use the same tax on a $75 whole cake | Home dismissed the assistant. After the composer fix, the first Send click worked. The answer reused **8%**, with $6 tax and **$81 total**, retaining the starting-price qualification. No new tax search was made. |
| Ask for the shop's phone number → Back → Forward | Displayed published **347.413.8438**. Back restored the whole $81 calculation composition; Forward restored contact information without another model request. |

Live filtering and answers used the real configured model where the request required it; basic deterministic navigation/query operations did not require a model call. No microphone acceptance is claimed. The 8% rate was explicitly hypothetical test input, not a verified Brooklyn tax determination. Retaining a hypothetical rate does not establish whether a researched real rule applies to every item.

## Verification

All final checks passed with Node 24.6.0:

- **44 focused offline tests:** information-surface history, record summaries, conversation history/memory/recall and query commands.
- **16 isolated browser scenarios:** the complete `tests/browser/ai-carousel.spec.ts`, covering desktop/mobile geometry, Back/Forward, branching, pending cancellation, product/service filtering, retained video/chart/photo/map views, mocked voice navigation, Home/Start over, reduced motion, focus and the unobstructed first Send click.
- Scoped ESLint and `tsc --noEmit --incremental false`.
- `npm run build`.
- `npm run test:package`: independently packed platform consumer retrieves knowledge and renders catalog/media/controls/CSS.

The existing aggregate-check sibling-runtime byte-parity failure in `tests/gpt-live.test.ts:191` is outside this change. This report does not claim a new successful whole-project `npm run check` or whole browser suite.

The recorder's two failed HTTP observations were aborted development lifecycle requests, not additional paid model calls. All ten recorded model requests completed with measured usage. No automatic paid retry loop was observed.

## Cost and handoff

- **10 model requests; $0.410915 conservative token-cost estimate**, based on recorded usage and the local guard's rate bounds, not a provider invoice.
- The additional **$0.15 hold** kept total conservative accounting at **$0.560915**, below the approved $3 maximum. No unsettled model reservations remained.
- Recording is stopped. The temporary active guard configuration was archived as `qa-budget-completed-5e5a5425-c21d-4749-929b-2184385acb78.json`; the ledger and recording remain in the ignored recordings directory. This avoids blocking the publisher's later manual recording while preserving this run's accounting.
- The original local server remains running on port 3220. The tested in-app tab remains open and its temporary mobile viewport override is cleared.

Remaining acceptance: actual microphone turn-taking, audible factual accuracy and interruption; real external research reuse with applicability checks; broader publisher data and physical devices. Future agent-triggered paid tests need their own applicable authorization rather than resetting or silently extending this run.
