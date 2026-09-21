# Chained-task and information-surface QA — September 19, 2026

## Authorization and limits

This loop uses the user's fresh **$3 maximum** from the September 19 request beginning at 1:13 p.m. It is separate from the completed labeled-photo run. Testing is confined to the local Doc's Cake Shop in the Codex in-app browser. No microphone connection, real transaction, production deployment, account change or Git push is authorized by this work.

The user also asked the coordinator to stop when Codex weekly **remaining** allowance falls below 70%. The initial account check showed 80% remaining. Progress checks use the account's weekly used percentage to calculate remaining allowance.

Recording: `7d721b68-a7af-4197-a92c-e224612e22b1` — [local timeline](http://127.0.0.1:3220/dev/recordings?id=7d721b68-a7af-4197-a92c-e224612e22b1). It stopped at the recorder's one-hour limit. Continuation: `55d4acf0-cb8d-4afe-bfc9-b01669efea9a` — [continuation timeline](http://127.0.0.1:3220/dev/recordings?id=55d4acf0-cb8d-4afe-bfc9-b01669efea9a). Its ceiling is $1.903157, the original $3 minus the first recording's $1.096843 charged reservations; this is not another budget. The ignored local budget guard reserves a conservative upper bound before each model request. A request with missing usage retains its entire reservation; the cost report is not a provider invoice.

After the publisher's daily chat limit stopped testing, the user explicitly requested a higher allowance. Only Doc's Cake Shop's draft and published `chatDailyLimit` changed from 25 to 50 (revision 161); unrelated content and billing/auth/provider settings were preserved. The $3 guard remains unchanged in aggregate.

## Live findings so far

| Scenario | Evidence and outcome |
| --- | --- |
| Show all cakes | 31 published offerings; actual desktop grid reviewed. |
| Whole-cake scope + comparison | Correctly narrowed to five sizes, then mistakenly bound a `query` handle as `records`. Trace `00a852d5-82da-484b-af64-59d399155f56`. This exposed the validation/recovery defect below. |
| Narrow five cakes to prices below $60; Back | One 6-inch cake, then the saved five-item result. Desktop width contracts for one item and expands for the collection. |
| Retest whole-cake comparison | Correct exact-ID `records.lookup` now selected. The next upstream model connection closed (`UND_ERR_SOCKET`). Trace `b98b6f6d-3062-4a18-bbb0-11480cffe9a2`. No automatic retry. Its full uncertain reservation remains charged against this allowance. |
| General pound-cake/cheesecake explanation | Answered from general knowledge, preserving the cake context. No unnecessary web lookup or repeated source-category narration. |
| Look up the name's origin and synthesize two sentences | Used `research.lookup`, then `present_answer`; kept the useful cake context, produced a concise answer with a clickable Smithsonian source, and opened no search-results panel. Trace `d36839b6-8de9-4955-8f2b-790b0d0dc643`. |
| Home → calculate half the original recipe in ounces | Reused the earlier recipe proportions, returning 8 ounces of each of four ingredients, 32 ounces total. One model request, no new research. Trace `4dfbfb6d-37a8-4222-b060-fcff4460a7c2`. Also exposed a mismatched pagination control after Home. |
| Compare 6-inch and 8-inch whole cakes | Completed: starting prices $50/$75, up to 4/20 people, difference $25 and 16 listed servings, with starting-price qualifications. Initial comparison included unrelated all-unknown columns; UI/backend improvements below remove those. |
| Explicit web image search | Seven relevant Blue Velvet images displayed. Opening image 2, Back to its grid and Forward to the selected image worked. Revealed unnecessarily narrow grid and oversized introductory text; shared sizing/count presentation corrected. Trace `a968bf4a-a119-450d-a541-222efccd20e5`. |
| Published detail + hypothetical calculation | The model calculated three $9 slices plus 12% correctly ($30.24), but omitted `present_answer`; its ordinary final text disappeared after the detail display. Trace `92f8475c-ff3a-490e-a4d1-20de84f9e2b5`. Fixed with the supporting-answer fallback below. |
| Same assumption → changed quantity → Home → different item → correction | Two slices with the same 12% returned $20.16; after Home the $50 starting whole-cake price became $56; replacing the assumption with 10% produced $55. No repeated lookup was needed. These are explicitly hypothetical surcharges, not tax guidance. |
| Final live compound request after the fixes | “Show Blue Velvet and calculate the total for two slices with a hypothetical 12% surcharge” displayed the published detail and $20.16 calculation together. The ordinary final answer appeared as supporting prose in the existing card. Request completed with no pending work. |

The cake images remain explicitly labeled test illustrations, including arbitrary assignments previously authorized by the publisher. These tests do not establish visual identity, live inventory, actual tax applicability or real speech accuracy.

## Shared changes under verification

- Background research feeds the next synthesis round with complete evidence and citations. General explanations do not require announcing a change of source. Requested visible web/image/map results still use their existing display path.
- Answer cards render validated public HTTPS citations. Raw HTML, scripts, private URLs and generated image loading remain inert.
- Fresh result-handle type mistakes, undeclared/duplicate bindings and malformed capability inputs return bounded `invalid_input` feedback before execution. A model can correct the arguments within the existing task ceiling. Stale publication/session/generation/expiry/dependency evidence remains a hard failure.
- Recognized model transport failures receive truthful connection wording while preserving confirmed views. No automatic paid retry or budget-limit change.
- Shared conversation history retains 32 messages, 2,000 characters/message and 24,000 serialized UTF-8 bytes, evicting oldest whole entries. User assumptions retain their scope and corrections; prior answers never become verified publisher facts. Long messages can hit the byte limit earlier. No summarization calls.
- Desktop collections expand to 90vw with space for history controls; one/two results contract to 600/880px. Supporting grids use denser columns. Images have bounded frames and compact illustrative labels. Mobile gutters and touch targets remain.
- Comparisons exclude only fields unknown for every selected item. One-sided, zero/false, conditional, conflicting and stale values remain. Responsive comparison rendering aligns desktop columns and shows compact records on narrow surfaces.
- Retained cards render their own controls and pagination. Chat/manual requests restore the matching saved query before execution; new voice connections do so during preflight. Continuous voice now waits for a revision-scoped preparation acknowledgment before reserving backend work. Five-second timeout, cancellation and stale acknowledgments fail safely without automatic retries.
- Mobile card position follows the dock until its Motion transform settles. The live 393px viewport previously retained a transient 133.5px control boundary despite controls ending at 104px; after reloading the change, the card correctly starts at 116px, reclaiming about 30px.
- The desktop chat dock no longer inherits an empty waveform-height band. Its height stays consistent when the assistant opens/closes, preserving website scroll position. Browser regression covers both spacing and return-to-website scroll.
- A completed ordinary model answer after an acknowledged view appears as supporting prose within that view. This preserves correct calculations even when `present_answer` is omitted, without adding a mostly empty second column. Explicit rich answer layouts retain their existing behavior; no text heuristics or extra model calls.
- External image grids use up to 90vw on desktop, compact counts and two columns on mobile. Number/code guidance remains accessible; attribution and supporting explanations follow the pictures. The live seven-image result was visually verified at 1440px and 393px: four desktop columns and two mobile columns, with the count beside Back/Close.
- Compound query shortcuts defer extra calculation/explanation/research steps to the model instead of silently completing only the filter. Fifteen focused product/service and voice-owner regressions passed; ordinary filter conjunctions are preserved.

## Verification status

The latest combined production build and all **21 information-surface/retained-view browser tests passed**. These use real local state, synthetic publishers, mocked providers/media and desktop/mobile layouts. The supporting-answer change passed 105 focused server regressions, including chat and continuous-voice display acknowledgments. TypeScript and scoped lint passed. Earlier all 28 rendering tests and packed-consumer verification passed; the new external-image rendering tests also passed.

The full server run passed 643 of 645 tests: one stale history-bound assertion was updated and its 15 focused tests passed; the other is the previously documented sibling GPT-Live byte-parity discrepancy. The legacy full voice browser suite does **not** pass: see [triage](qa-voice-suite-triage-2026-09-19.md). Obsolete selectors and additive-panel assumptions caused failures; worker restarts subsequently exhausted the synthetic site cap. All **eight current voice safeguard browser tests passed** in a fresh workspace: microphone readiness through the greeting, streaming/interruption/Stop, permission cancellation, disconnect without retry, media/control readiness, failed updates and cold preparation cancellation. Actual microphone turn-taking, audible factual accuracy and interruption remain separate manual acceptance.

## Follow-up work

- Compose configured greeting points into the current information surface; the old greeting callback selects an index but does not populate approved points. Preserve immediate user interruption.
- Broaden adversarial compound-request coverage beyond the corrected calculation/explanation/research cases; preserve the complete requested chain across unfamiliar publisher domains.
- Migrate obsolete voice browser cases to the current information surface and whole-state history, then run the full suite with isolated fixtures.
- Make the recorder distinguish its one-hour limit from a saving failure. The first recording retained its stop reason, but the UI reported a saving failure and two later dropped events.
- Revisit representative photos: some authorized test assignments point to decorative assets, not useful product photographs. Do not treat arbitrary labels as verified visual identities.

## Closeout and continuation

Stopped new work when the weekly allowance reached **69% remaining**, as requested. The in-flight request and final production build completed successfully, both agents finished, the recorder was stopped, and the temporary viewport was reset. The localhost server was subsequently shut down at the user's request; port 3220 was verified to have no listener. The visitor tab is retained. Changes remain in the existing working checkout; this loop did not commit, push or deploy.

Across both recordings there were **33 reserved model/search requests**, conservatively charged **$1.549694 of $3**. This includes the full **$0.198844** reservation for the earlier failed connection whose actual usage is unknown. The unused $0.15 voice hold was never spent; no microphone connection was started. Budget configurations and ledgers were archived locally without resetting charges. This is a conservative test ledger, not a provider invoice.

Verification at close: final production build passed; **21 surface/retained-view** and **8 voice-safeguard** browser scenarios passed with mocked providers; the final compound-clause patch passed 15 focused offline cases and its live chat retest. Supporting-answer delivery passed 105 focused cases. The known sibling parity failure and legacy full voice-suite gaps remain explicit above. Start the next session from the greeting composition and voice-suite migration items, then perform recorded real-speech acceptance; establish any next paid-test allowance before resuming live calls.
