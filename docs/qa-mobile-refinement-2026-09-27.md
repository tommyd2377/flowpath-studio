# Mobile composition and recovery refinement — September 27, 2026

This continues the [context and round-count pass](qa-context-rounds-speed-2026-09-27.md) under the same $5 daily allowance. The coordinator owns live browser testing and budget accounting. Delegated workers used synthetic data and mocked providers. Existing unrelated changes remain intact; this is a local implementation, not a deployment or customer publication.

## Mobile design

- The information surface uses 8px outer gutters and 16px reading insets on narrow phones, with safe-area protection. At a 393px viewport this makes 20px more content width available than the earlier geometry. Controls retain their 44px targets.
- Two-item comparisons align the two values under each attribute, so a visitor can compare without scrolling past the entire first item. Explicit header associations preserve table meaning. Three-or-more-item mobile comparisons keep the existing record presentation; desktop tables remain unchanged.
- Estimates keep amounts beside item names and total labels, including at 320px. Source terms and tax assumptions remain accessible in disclosures. Large amounts and enlarged text reflow instead of overflowing.
- In an item list, a supporting photo becomes a compact thumbnail beside the item. A request for photos still gets a paired image grid, and opening a photo retains its full visual treatment. Example/illustration labels are preserved.
- Video proportions, rich-answer spacing and local table scrolling use the available width without tall empty placeholders. Input text stays at least 16px on phones. Existing Motion transitions, history and reduced-motion behavior remain in place.
- Keyboard review found the assistant's focus trap skipped native `summary` controls. They are now included, with hidden/inert/disabled/`aria-hidden` content excluded. The integrated regression uses actual Tab and Enter, not programmatic disclosure focus.
- An exhausted voice allowance no longer occupies the active chat's progress area. The disabled Voice control retains an accessible explanation.

The design follows Apple's [layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout) and [interaction tips](https://developer.apple.com/design/tips/), with [320px reflow](https://www.w3.org/WAI/WCAG21/Understanding/reflow) and [adequate target spacing](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) checked explicitly. Removing space must not remove qualifications, shrink controls or hide overflow.

## Speed and recovery

Fresh local publication and availability reads no longer rewrite the entire saved workspace. Reads still wait behind queued writes and reload the current file; they are not a stale authorization cache. First-read initialization preserves stable demo identities, and reservations still use serialized mutations. Independent immutable inputs for a cold catalog build load together, followed by the fresh-publication check.

A controlled 8.01MB synthetic-workspace microbenchmark, 18 samples per path, measured median **44.88ms with a rewrite** versus **18.32ms read-only**, eliminating 18 unnecessary writes. The 59.2% reduction applies to that helper only. It is not a 59.2% end-to-end improvement and does not measure Firebase production performance.

Live filtering exposed an avoidable correction round: shortened field IDs were rejected, but the response had no candidates, so the model asked for the schema again. Rejections now include bounded exact published field candidates, including fields in nested constraints, preferences and sorts. Ambiguous and unknown IDs remain rejected. The server never silently rewrites a model query. Mocked chat and voice can correct the query directly within the existing round limit.

Another live request supplied both a photo and its related entity to a component that accepts one photo reference. Chat and voice now return bounded component/reference guidance for this repairable argument error, allowing the model to correct its proposal within the existing tool limit. The failed batch applies nothing. A full-batch reference preflight ensures that an earlier malformed operation cannot conceal a later private, ambiguous or stale reference; authorization, publication, scene and revision failures remain hard failures. There is no automatic reference substitution, gallery fallback or paid retry.

Browser QA also exposed an older routing defect: a bare “Show contact information” request became an empty literal keyword filter. The final bare-show shortcut now requires a published name/alias match when no collection or typed criterion was resolved. Other informational requests pass to the model without changing the current query. Exact records/aliases/collections, partial published names, explicit searches and legitimate empty typed filters keep their existing behavior. This is a generic ownership check, not a blacklist of contact/menu/business terms. A browser regression uses the real command route and confirms that the gallery remains intact while the modeled answer is pending; the answer stream itself is mocked.

The local QA budget guard now supports the active-photo adapter's explicit low-detail JPEG input for the configured model. It reserves 309 additional image tokens per supported image, retains the conservative encoded-byte bound, and rejects unknown models, formats and detail levels before sending. This follows the official [image sizing and tokenization documentation](https://developers.openai.com/api/docs/guides/images-vision). The guard stays enabled and no active image is removed from model input to avoid accounting for it.

## Live findings and verification

Recording `fc89a3bb-52bd-48ec-b8c6-c4950731d306` uses the normal local paid chat interface in the Codex in-app browser. The JSONL and ledgers remain private ignored runtime artifacts. Times include development-server preparation and display acknowledgment; they are individual observations rather than controlled latency comparisons.

| Request | Observed result | First visible | Committed | Model requests |
| --- | --- | ---: | ---: | ---: |
| Complete menu | 62 published items | 3.79 s | 4.12 s | 0 |
| Vegan slices below $8, most expensive first, before field feedback | Correct ordering after field correction and an extra schema lookup | 13.12 s | 15.12 s | 3 |
| Two Speciality slices and one Veggie slice, before tax | Correct $21.75 estimate | 8.27 s | 11.43 s | 2 |
| Same quantities as whole pies | Correct $149.15 estimate | 5.62 s | 9.55 s | 2 |
| Photo plus identity question, first attempt | Incompatible photo/entity references; no successful display | — | Failed | 1 |
| Vegan slices below $7, cheapest first, after field feedback | Correct two $6.75 options, no correction or schema round | 6.07 s | 7.10 s | 1 |
| Compare those options' slice and whole-pie prices | Correct aligned comparison on a 393px viewport | 8.92 s | 13.34 s | 3 |
| Photo plus identity question, retest | Photo displayed; final image-bearing request lost its provider connection | 5.14 s | Incomplete | 2 attempted |

The post-fix filter needed one model request, but that successful request did not exercise rejection recovery; the direct correction path is verified with mocked two-round chat/voice tests. Comparison still used an avoidable record lookup and a closing synthesis round. These observations do **not** establish uniformly faster responses: several first results still take roughly 5–9 seconds, and final completion can take longer.

The last photo request passed the new image accounting guard and displayed its photo. The subsequent provider call failed with `UND_ERR_SOCKET` / `other side closed`, surfaced as a connection error while retaining the confirmed photo. Paid testing stopped without retrying. Its unreturned usage remains reserved in full; the final image-aware answer is **not** live-verified.

Manual live Back/Forward restored the prior estimate and filtered items without another model call. The mobile layout was inspected in the in-app browser. Physical iPhone keyboard behavior, microphone input, audible interruptions, live voice recovery and production performance are separate acceptance work.

## Budget and follow-up

This pass attempted 14 paid model requests: 13 returned usage and one retains its full $0.202708 reservation. The pass conservatively accounts for **$0.707421**. Carrying forward the earlier **$1.445950**, today's total is **$2.153371 of $5**, leaving **$2.846629**. These are conservative local accounting figures, not provider billing totals. The recording is stopped and the budget guard remains enabled; do not reset the allowance when resuming.

The next speed work should focus on eliminating the extra lookup for an already-visible comparison and unnecessary final synthesis, without discarding useful explanations or changing published facts. The next authorized live photo test should verify the completed image-aware answer; the provider connection failure is separate from the corrected reference and budget-input problems.

## Visual evidence

These screenshots use synthetic fixtures and the real shared components/styles; they are not physical-iPhone captures.

- [Aligned mobile comparison](screenshots/mobile-refinement-20260927/mobile-comparison.png)
- [Compact mobile estimate](screenshots/mobile-refinement-20260927/mobile-estimate.png)
- [Integrated mobile gallery and composer](screenshots/mobile-refinement-20260927/mobile-gallery.png)

## Verification

- **58 isolated browser checks pass:** 15 mobile/rich-answer component cases, 23 information-surface cases, 8 retained-view/keyboard cases and 12 speed/status/handoff cases. Providers are mocked; these cover multiple synthetic publisher types, 320–430px widths, enlarged text, history, reduced motion, persistent video, empty/error states and unchanged background-site scroll. Logs: `/tmp/flowpath-mobile-refinement-browser-{components,surface-final,retained,speed}-20260927.log`.
- The initial wider surface run failed because its mock still intercepted an older command transport; worker restarts then exhausted the synthetic workspace's site allowance. The harness now intercepts the actual command transport while preserving real state/cancellation handling. Contact, old-content removal, receipt and history assertions remain intact. Only comparison/geometry expectations changed to match the intentional design. The independent real-command browser case verifies the separate routing fix rather than hiding it behind that harness.
- **182/182 core server checks pass**, covering publication preparation, budget bounds, field/reference correction, stale authority, cancellation, connection failures, task context and adapters. **52/52 parser/binding/integration checks pass** after the final generic routing change, including seven publisher vocabularies. These suites overlap and should not be added as unique test counts. Logs: `/tmp/flowpath-mobile-refinement-final-server-tests-20260927.log` and `/tmp/flowpath-mobile-refinement-final-routing-tests-20260927.log`.
- **15/15 rendering checks pass** for comparisons, published estimates and rich answers, using the renderer's appropriate non-server React condition. Log: `/tmp/flowpath-mobile-refinement-render-tests-20260927.log`.
- Full lint, TypeScript no-emit, production build and `git diff --check` pass. The final build includes the routing safeguard; its speed browser suite ran afterward. Logs: `/tmp/flowpath-mobile-refinement-final-{lint,types,build}-20260927.log` and the final routing lint log. This is targeted verification, not a claim that every repository suite was rerun.
- The live recorder and local/test servers are stopped; ports 3220, 3221 and 3225 have no listeners. The temporary viewport override was reset. The original private recordings and conservative usage reservations are retained.

No deployment, customer publication, commit or push occurred in this pass. The changes apply to shared publisher code; the restaurant supplied live test content only. Physical-iPhone speech and the final photo answer remain unverified as described above.
