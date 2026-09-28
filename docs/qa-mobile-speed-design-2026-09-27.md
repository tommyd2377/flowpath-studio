# Mobile handoff, display speed and website design — September 27, 2026

This is the implementation follow-through to [the research and phone triage](next-product-research-2026-09-27.md). Changes are in shared publisher/runtime code. No customer content, publication settings, production deployment or dependency upgrade was made in this pass. The large pre-existing working-tree changes were preserved.

## Implemented

- **Fresh spoken requests:** the existing semantic backend receives the latest complete request with a bounded set of earlier unfinished requests for interpreting references and refinements. They are context, never a queue to replay. A quiet-input recovery can hand off an explicit new request after 1.8 seconds even while old work runs. Normal provider delegation remains primary; status questions, backchannels, incomplete speech and duplicate delegations do not start duplicate work. Cancellation, revision fences and quotas remain in force.
- **Phone capture:** explicit, development-only HTTPS pairing binds one recording to one publisher and exact local origin. A one-use, ten-minute invitation becomes a thirty-minute capture grant only after the visitor starts recording. The phone can append, attach its existing voice connection and stop that recording; it cannot list/read/export/delete recordings. Requests reject redirects, grants expire, observations retain redaction/size bounds, and production rejects the route. No actual pairing invitation was generated during this pass.
- **Display acknowledgments:** receipt/scene operations check the current publication without hydrating its catalog or reading an unnecessary viewport document. Exact operation/result references, current generations and conditional writes still determine whether a receipt is accepted. Acknowledgment is not permission to use stale visible-item ordinals.
- **Animation completion:** the information surface observes registered Motion completion and stable rendered geometry instead of always paying a resettable 560 ms quiet period. Interrupted layout projections have a bounded stillness-based recovery. Height/region/grid transitions and retained media remain intact. See the remaining extension limitation in `docs/gpt-live.md`.
- **Website design:** content structure recommends an existing template during import/review, preserving the publisher's choice. Editorial, Showcase and Clarity have different composition and entrance treatments, including mobile image motion, while Off/reduced motion stays still. The review selector now consistently selects the template used by its preview. [Detailed design changes](website-design-update-2026-09-27.md).
- **Diagnostics:** failures retain their underlying classification; model payload metrics include actual instruction framing. Recording does not add model requests or change model inputs.

The phone handoff change is covered with mocked transport and synthetic transcripts. Real chat exercises the shared backend, data, memory and display paths; it cannot establish iPhone microphone capture, spoken turn detection, audible interruption or physical-device performance.

## Live local chat QA

The user approved a fresh **$5 maximum** for today's local chat tests. Only the coordinator sent paid requests, through the Codex in-app browser at `http://127.0.0.1:3220/s/cuts-slicescuts-and-slices-qa`. The normal configured provider was used, with an active local recorder and a fail-closed budget ledger. Worker/browser fixture suites use mocked providers and no paid calls.

Recording: `34d476b6-0c63-48e4-a71a-b14c6e57d948`. The local JSONL and cost ledger are ignored/private runtime artifacts, not committed evidence. Cost values are conservative development estimates, not billing totals.

| Request / chain | Observed result |
| --- | --- |
| Complete menu | 62 published items in the structured grid. |
| Vegan slices under $8, highest price first | Vegan Speciality $7.50, Vegan Veggie $6.75, Vegan Cheese $6.75 in the requested order. |
| Two of the first result and one of the second, before tax | Exact displayed-item references became a $21.75 estimate. |
| Keep quantities; switch both items to whole pies | Two $50.95 pies plus one $47.25 pie: **$149.15**, before tax. |
| Home → bring back the same estimate | Home closed the assistant surface; recall restored $149.15 with the same items, variants and quantities. |
| All photos → only the vegan pizza photo | Ten published media items became the one labeled Vegan Speciality photo. |
| Mobile Back → Forward | Restored the ten-photo grid, then the single-photo result, without rerunning the model task. |
| Vegan slices below $1 | An honest empty result, with no invented match. |
| Complex comparison while working → “Actually, show me all your photos instead” | The old provider work was aborted, its partial presentation was rolled back, and the photo request became the committed state. The comparison never returned afterward. |

One development hot-reload reset the browser recorder module while the mounted recorder UI still appeared active. The budget guard rejected that request before any paid API call. Testing paused until the module was frozen, then the page was reloaded and capture resumed. The successful whole-pie retest above was recorded after that reload; the rejected attempt is not a semantic-model failure.

### Measured latency, not an instant-response claim

Individual observations from this development-server run, measured from submission unless otherwise noted:

| Case | First visible result | Final committed state |
| --- | ---: | ---: |
| Initial complete menu, including cold task setup | 3.14 s | 3.41 s |
| Natural-language vegan filter/sort | 7.89 s | 12.05 s |
| Estimate from displayed ordinals | 5.24 s | 8.65 s |
| Explicit slice estimate after development reload | 4.71 s | 8.68 s |
| Whole-pie variant change | 5.28 s | 10.19 s |
| Estimate recall after Home | 4.36 s | 7.99 s |
| All photos on the mobile viewport | 1.94 s | 2.19 s |
| Contextual photo filter | 5.88 s | 9.68 s |
| Empty vegan-price filter | 5.99 s | 8.56 s |
| New photo request replacing unfinished comparison | 6.81 s | 9.11 s |

These are single-run samples, not controlled before/after benchmarks. Display-to-receipt measurements in the initial grid/estimate samples range from 221–521 ms; the photo-filter sample was 213 ms. Complex provider-mediated requests remain too slow for the intended experience. The confirmed grid/estimate can appear before the closing model narration, but that does not establish that every requested step has finished.

The actual publisher site was also inspected at mobile and 1440px desktop sizes, including returning from the assistant to the hero and scrolling into ordinary website sections. Synthetic publishers separately test the three design families; no customer layout selection was changed to manufacture a visual difference.

## Follow-up priorities

1. **Prompt assembly:** the bridge's 48 KB ceiling does not cover the workspace/carousel context appended afterward. Measured live instruction strings were roughly 112–124 KB. Serialize display state once and factor exact repeated evidence, preserving assertion groups, source conflicts, conditions, units, provenance and actual active-image input. Do not drop workspace facts merely because the same entity ID appears in a budgeted bridge projection.
2. **Avoid mechanical model rounds:** evaluate a bounded query-to-summary operation using exact server result handles. It must preserve semantic interpretation and validation rather than hard-code a restaurant or replace complex intent with keyword rules.
3. **Physical iPhone acceptance:** at the user's next convenient test, use the paired recorder for one short sequence covering speech during an introduction, a correction while work runs, a new subject, background/resume and audio interruption. No user microphone test was needed to finish this coding pass.
4. **Design acceptance:** inspect the different templates with actual publisher content. Synthetic browser checks prove layout/motion behavior, not that users judge the design better than Squarespace.
5. **Cross-repository parity:** the existing assertion comparing Studio's Live implementation byte-for-byte with the separate FlowPath checkout still fails. This pass does not silently modify or deploy the other product.

Note 15's existing-website overlay remains a product decision and researched prototype proposal; no embed distribution or external-site integration was implemented.

## Verification and shutdown

- **Final production build and full ESLint:** passed. The build includes the final phone redirect/HTTPS-loopback corrections and integrated shared-package changes.
- **Focused coordinator suite:** 181 passed; one failed existing byte-parity assertion against the separate FlowPath checkout. This is not reported as a green aggregate suite. The test's current first mismatch is the shared instructions file; the two repositories require an intentional reconciliation rather than silently copying files outside this project.
- **Phone recorder:** all 25 paired/local recorder cases passed, including origin/publisher isolation, one-use/restart/replay, expiration, production rejection, redirected fetch rejection and on/off provider-request parity.
- **Website source/render checks:** 26 recommendation/import/template checks and six rendering checks passed. Existing review/apply/publish boundaries remain covered.
- **Final browser cases:** nine choreography/hero cases and seven existing Motion scenarios passed (one opt-in actual cake-site case intentionally skipped). The Motion matrix includes 24 publisher/template/viewport combinations. Ten speed/display cases passed, including actual transition/geometry settlement, interruption, resize, history, streaming status and gallery receipts. Eight earlier website-design cases passed before the final wide-image guard, which has its own final regression. Providers and audio in these isolated suites are mocked.
- **Independent packed package consumer:** passed using the current built artifact. Whitespace checks passed.
- **Visual evidence:** [desktop/mobile screenshots and sampled motion](screenshots/website-design-20260927/README.md), including the compact [synthetic Showcase example](screenshots/website-design-20260927/showcase-desktop-hero-synthetic.png).

The live run made **18 model requests**, with conservative request charges of **$0.768511**. Seventeen have returned usage; one cancelled request retains its entire **$0.184439** reservation. The ledger also holds **$0.150000** separately, so its full accounted amount is **$0.918511**, leaving **$4.081489** of today's approved $5 maximum. This corrects the earlier remainder, which omitted that hold. These are upper-bound development estimates, not an invoice. The subsequent context/round-count QA carries the full accounted amount forward instead of resetting the allowance.

Recording was stopped at **12:21:29 p.m. EDT**. Its active guard configuration was archived so it does not prevent the user's next recording; the ledger and recording remain intact. Browser viewport overrides were reset. The loopback QA app, temporary certificate setup server and isolated browser servers were stopped; ports **3220, 3221 and 3225** were confirmed without listeners. No voice session was started, no certificate/private key was read or changed, and no commit, push, publication or deployment occurred in this pass.
