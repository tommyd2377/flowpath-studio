# Website detail reading order — 2 October 2026

Website details now show existing approved values and their qualifications before long reading blocks. The group is called **Details and conditions**; it does not label unknown or conflicting information as verified. Narrow screens stack each label above its value. The full source blocks remain below, unchanged.

The change is limited to the website detail dialog. It neither changes ingestion nor rewrites facts, creates capabilities, applies content or republishes a site. Prose-only and summary-only entries retain their existing content. Photo/video rendering, example labels, credits and dialog interaction remain in `WebsiteSurface`.

## Verification

- Fourteen focused rendering tests passed: existing website and composition tests plus four detail tests covering long content, tail qualifications, literal fee conflicts, unknown/denied values, text escaping, unchanged input objects, entries without values and intact long source tokens/URLs.
- Targeted ESLint passed. A production build passed in an isolated snapshot using explicit demo mode and no provider credentials.
- Matched actual visitor pages were captured at 1440×1000 and 390×844. Before used the unchanged existing localhost publication; after used the same publication copied into a separate demo data directory with only the renderer change. The harness deep-compared publication state, every displayed value and all reading blocks. Browsing was GET-only; no provider calls or publication writes occurred.
- Both tested manually curated controls and the automatic-parser product retained keyboard Escape dismissal and focus return. No page errors occurred in any of the twelve before/after captures.

At 390px, the first T. Schreiber qualified value moved from about 5,633px down the dialog to 264px. Its fee conflict, source-year uncertainty and captured-capacity qualification now fit together in the opening dialog. Arms Acres' insurance/admission condition moved from about 9,114px to 237px. These are renderer improvements on explicitly manual structuring controls, not evidence of improved automatic interpretation.

The separate automatic-parser comparison also passed on Roberta's **Official Racing Hat** at both widths. Its literal `$29.99` price, **currency unconfirmed** label, source category, size/price terms and complete availability-qualified summary remain unchanged. At 390px the price label now fits on one line above its value, rather than occupying three lines in a narrow side column; facts precede the repeated imported summary. First value position moved from about 244px to 202px within the dialog. The original dialog already fit those facts, so this is a modest readability improvement rather than the large visibility recovery seen in the long curated details.

Roberta's fixture was produced by the deterministic website parser, with separately disclosed removal of a zero-value gift-card record and qualification of introductory vegan wording. It is not a wholly AI-generated site, and this renderer comparison did not alter that content. Twelve screenshots across three publishers × two viewports × before/after were checked. The immutable publications, literal values and complete reading content matched in every pair.

Scratch evidence: `/tmp/flowpath-real-source-polish-20261002/evidence/curated-comparison.json`, `automatic-comparison.json`, paired `*-before.png` / `*-after.png`, renderer hashes, and the snapshot's build/render-test logs. These public-source evaluation artifacts are not committed with the product.

## Long source token wrapping

The Arms Acres mobile detail initially overflowed in both ordering captures. A DOM text-range inspection identified the exact source token `PaymentAdmissionsInpatientOutpatientServicesLeave`: its unbroken width was 403.6px inside a 302px reading area. The preserved source paragraph caused a 428px scroll width inside the dialog's 350px client width (352px outer width).

A single inherited `overflow-wrap: anywhere` rule on `.website-detail-content` lets long reading tokens, labels and URLs wrap without changing or truncating their text. Existing paragraph whitespace and desktop layout rules remain intact. A render regression preserves the source token, a long URL, tail conditions and the unchanged input object, with no inserted soft hyphens or zero-width characters.

Fresh matched captures of the same copied publication pass at 390×844 and 1440×1000. Mobile dialog scroll width is now 350px, matching its client width, with no overflowing descendants. The offending token wraps into two lines. The complete detail text and every literal fact and fact position match the pre-fix capture. Desktop long-token geometry and total dialog scroll height are identical. Keyboard dismissal/focus return pass; no page errors occurred. These four additional captures used GET-only browsing on isolated loopback port 3237; no publication, provider or original workspace state was changed. Evidence is `overflow-before.json`, `overflow-after.json`, `armsacres-overflow-*-before.png` / `*-after.png`, `renderer-overflow-file-hashes.json`, and `build-overflow.log` in the same scratch directory.

## Remaining limits

Raw extraction residue and heading markers remain in existing long source blocks; the renderer deliberately does not guess which text to remove. Cleaning them requires a reviewed semantic-content proposal with provenance. This change does not validate factual correctness, add block-level assertion review, rank fields by inferred importance, or update the separate assistant detail renderer. Long values can still require scrolling, and source images may precede this facts group. Conditions present only in a summary remain in that unchanged summary; they are not heuristically promoted.

The measured Arms Acres source-token overflow is fixed. This does not remove the underlying imported navigation residue or establish a blanket overflow pass for all publications. General accessibility, additional viewports and screen-reader testing remain separate acceptance work.
