# PDF coverage warnings and Roberta's frozen-menu review

This bounded offline follow-up uses the nine-page Roberta's capture and three official linked PDFs from the 2026-10-02 evaluation. Product changes are based on `7573b6b`, including its existing wide-gap preservation and the earlier zero-value gift-card fix. No restaurant contact, order, account, paid provider call, OCR, cloud change or deployment occurred.

## Defect and change

Successful text extraction previously exposed a generic PDF limitation only after a successful interpretation. All three real menus require semantic interpretation, so their offline failed-file reports omitted the text-coverage limitation entirely. A reader could see a processing failure without learning that graphical names and page order were also unverified.

The host now records a bounded `pdf-text-only` warning after successful PDF extraction. It survives failed interpretation, successful review, same-batch duplicates and previously reviewed identical-file skips. File progress and failed-file review display the warning; successful proposals retain it in private notes. The related-source request carries the fixed host message separately as `sourceLimitations`. Existing reports remain valid because the field is optional. No additional model call or retry is introduced.

This warning describes the PDF text extractor's limits. It does not detect missing words, claim that a particular PDF contains images, recover reading order, or certify coverage. The source extractor, text, page ranges, source anchors, original-file bytes, model policy, price interpretation and location assignments are unchanged. Apply and Publish remain separate.

## Independently verified source findings

- Culver's scripted **jacaranda** and stylized **1986** are embedded raster images, not extractable text. Local Poppler image extraction identifies image objects 341 (413 × 71 pixels, with a soft mask) and 339 (208 × 109 pixels). Visual inspection confirms the names. Both PDF.js and independent Poppler text extraction omit them, leaving incomplete names beside the retained prices. No OCR was performed.
- Bushwick retains `23/23.69` for Margherita and `26/26.78` for Bee Sting, together with its explicit 3% payment-method qualification. Penn's Salumi Plate `8/22` has no cash/card explanation: a slash pair alone cannot establish payment meaning. Source notation and qualifications must remain intact.
- The frozen location page links the selected menus to Full Service → Bushwick → Dinner, Penn District → Lunch/Dinner, and Culver City → Dinner. R Slice Penn is a separate Outposts listing. Printed location headers and filenames alone are insufficient to recreate those relationships.
- The PDFs use full-width headings and multiple item columns. Stream order can place headings and footers far from their visual sections. A global coordinate sort would risk interleaving neighboring dishes' ingredients and values; no sorting was added.
- Culver's Thursday margarita-plus-Margherita promotion, allergen-contact/no-guarantee warnings and six-person gratuity qualifications require their original scope. This work makes no dish-specific allergen, current-price, availability or complete-menu claim. Three PDFs represent only three of the seventeen observed menu links.

## Verification

- Five new offline regression tests exercise warning validation, legacy records, exact source/anchor preservation in a captured provider callback, success/failure/duplicate persistence, previously reviewed skips, and unchanged draft/publication state. Synthetic fixtures include ordinary slash-separated values. The original ingestion pipeline fails the lifecycle negative control precisely because the warning is absent.
- Sixty existing PDF extraction, format, provenance and provider-request tests and fifteen source lifecycle/storage compatibility tests passed (eighty focused tests including the five new cases). Cloud transports were mocked. Targeted ESLint and the production Webpack build, including TypeScript, passed.
- Fresh extraction of all three frozen PDFs matches the archived `7573b6b` baseline byte-for-byte, including text, full extracted-source objects, page ranges and provenance. Per-menu original/candidate SHA-256 values are recorded. One intercepted local related-source callback confirms unchanged text/anchors and the added host limitation; it is not a semantic model result.
- The actual built app ran on isolated loopback port 3247 with an empty environment, demo mode and disposable storage. All three real PDFs were uploaded through HTTP, downloaded with identical hashes, and analyzed together. Each explicitly failed offline semantic interpretation with its new persistent warning; no menu candidate was fabricated. The warning reports were checked at 1440 and 390 pixels without report overflow.
- A separate synthetic structured PDF produced a review candidate whose warning was visible in the compiled UI. Nothing was applied or published. The browser used a new context, blocked external requests and reported no external request or page error in the completed run. Earlier harness failures from using the desktop navigation at mobile width and not reselecting the site after reload are retained, not counted as product failures.

Evidence is retained locally in `/tmp/flowpath-roberta-pdf-20261003-evidence`: `source-audit/REPORT.md`, `source-audit/audit.json`, `extraction-invariants.json`, `built-app-report.json`, screenshots, runnable audit scripts and check logs. Frozen source files remain in `data/evaluations/website-generator-20261002/private/robertaspizza`; no source material was copied into tracked fixtures.

## Remaining acceptance gaps

Graphical lettering, block-aware reading order, automatic menu interpretation and actual visitor answers remain unverified or unresolved. A useful future authorized semantic evaluation should separately test location-specific prices; Bushwick's two payment amounts and qualification; Penn's unexplained `8/22`; Culver's missing name components and Thursday bundle; and preservation of allergen/gratuity scope. This slice supplies no live chat score or OCR success claim.
