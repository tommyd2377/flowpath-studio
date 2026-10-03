# Source review and updates

Studio keeps source material private while helping publishers correct the knowledge visitors will use. Source locations are review aids, not a public editorial policy or proof that a model's interpretation is correct.

## Review an interpretation

1. Upload CSV, TXT, text PDF, DOCX, XLSX, HTML or an OCR-capable image in **Files**, then choose **Knowledge → Interpret source**. **Import a website** discovers public HTML pages and sitemaps, then imports selected pages with a reviewable native design. See [website import](website-import.md) for limits and exclusions. The legacy single-page API remains available.
2. Open an item and **Source for…** beside a field. CSV references identify records/physical lines, text and DOCX identify extracted lines, PDF identifies pages, and XLSX identifies exact sheets/cells and merged ranges. Formulas are unevaluated, not calculated values.
3. Use **Source material** and **Assertion review** for broader context and fact/relationship support. Model evidence can link exact supplied anchors; a link is a location, not proof of the claim. Shortened excerpts cannot support hidden content. Unsupported pending assertions require explicit approval/rejection before Apply.
4. Use **Edit individual facts and relationships** for singleton properties, typed values, units/currency, source-stated certainty, validity/observation dates, conditions and negation. Publisher corrections are labelled decisions, not source evidence. Unknown values stay unknown.
5. Save corrections, then **Apply to draft**. Apply approves visible anchored proposals, not unsupported claims. Rejected facts and mirrored values are excluded. Publishing is separate; private excerpts remain available after deleting an original upload.

The deterministic parser records references only for supplied fields it can trace to the displayed excerpt. It does not cite generated defaults, missing values or model guesses as source statements. PDF locations refer to extracted text, not an OCR or visual reading of the page. Older saved interpretations without provenance remain editable and show that excerpts are unavailable.

PDF extraction preserves large horizontal gaps between text runs on the same line as tabs. These are spatial hints, not inferred table cells or item/price relationships. Original text order, line breaks and page references remain intact; rotated or ambiguous geometry keeps the existing spacing. This does not reconstruct page layout or recover lettering drawn as graphics. Review missing names, location-specific prices and qualifications against the original PDF.

## Review related files together

Upload multiple related files in **Files**, select a source in Knowledge, then expand **Include related files in this review**. Up to six distinct files share one proposal, while retaining separate hashes, origins and source excerpts. Per-file progress distinguishes processing, successful extraction, unchanged sources and failures. Exact-byte duplicates share their result. Two files targeting the same source name are rejected before processing; renamed replacements are reviewed individually.

Structured sources use deterministic extraction. Related prose uses one bounded connected request, preserving the existing quota and cooldown. The combined prose limit is 60,000 extracted characters or 400 KB of source evidence; oversized groups fail before an AI request and require smaller reviews. Each file result is validated against its own anchors. No retry occurs automatically.

The impact summary identifies new/updated/removed information, conflicts, retained corrections and affected collections, reading sections, images and opening selections. Failed files keep their previous contribution. A partially successful proposal requires acknowledgement of its failed-file report before Apply. Extraction success does not establish complete semantic coverage or OCR accuracy.

## Replace an updated source

Upload the new version and select it in Knowledge. Studio automatically matches the same normalized filename. If the file was renamed, choose **Replace [previous source]** under **How should this file be used?** This explicit choice preserves the original identity namespace. Stable `ID` columns keep items and their photos connected; without IDs, renaming an item in the source can appear as an addition and a missing item.

**Changes from this source** summarizes the proposed merge. Open **Review source updates** to compare the previous source value, the publisher's current value and the incoming value, with source excerpts where available.

| Situation | Default | Optional choice |
| --- | --- | --- |
| Source changes an untouched field | Include the source update | Keep the current value |
| Source changes a field the publisher also corrected | Keep the publisher correction | Use the incoming source value |
| Item is missing from the new version | Keep the item | Remove it |
| New item appears | Add it | Do not add it |
| A publisher-removed item changes in the source | Keep it removed | Restore it |

An unchanged source value does not demand a new decision about an existing publisher correction. **Apply to draft** accepts the visible defaults, so publishers do not need to approve every unchanged field. Saved choices can be changed before Apply. Direct field edits replace matching source suggestions; unrelated field choices remain available. Structural edits may close whole-item suggestions whose saved relationships are no longer safe to restore.

Conflicting attribute types or currencies stop the import; conversions are not guessed. Cross-source names/aliases and fuzzy similarity suggest review, never identity by themselves. Automatic matching needs a unique scoped identifier plus corroborating fields without contradictions; model-supplied identifiers remain review-only. **Approve match** consolidates, **Keep separate** retains separate records across later imports, and explicit aliases are editable. Unsaved edits disable competing decisions. Exact duplicate sources do not trigger another interpretation request.

Fact and relationship changes have saved keep/use-source choices, including missing assertions and overlapping temporal conflicts. **Correction history** retains immutable before/after assertions and historical excerpts. Saved choices can be reversed before Apply without replaying unrelated decisions. Conditional, conflicting or out-of-time facts do not become unconditional current card values; current and explicit as-of retrieval use the same selection rules.

The source baseline tracks the latest imported version. A kept item that disappears from that source may lose its older field links in later reviews; Studio reports unavailable support instead of attaching it to unrelated new text. An identical-byte upload is a no-op, including a renamed copy; choose the previous source again when importing changed content under that new filename.

## Withdraw a source contribution

In **Manage contributing sources**, choose **Review removal**. This prepares a normal interpretation proposal. Information still supported by another source remains; unsupported unchanged fields are cleared, and unchanged items with no remaining support are retired. Publisher corrections remain. Retired source records act as private tombstones, so a later import cannot silently resurrect removed items. Review ambiguous remaining values before applying.

Contribution withdrawal does not delete the uploaded file or its photos. Deleting an original in **Files** does not erase approved knowledge. Reviewed site identity, headline, contact, hours and manually written sections are independent publisher copy and remain; the removal review prompts the publisher to check them. Review → Apply to draft → Publish remains the only route to changing visitors' information. See the [template/source implementation guide](templates-and-source-lifecycle.md) for details and screenshots.

## Photos, opening selections and publication

Field corrections and explicit replacement retain item IDs. Identity approval remaps facts, relationships, collections, source references, photos and opening selections to the canonical entity. If an item is removed, Apply removes only its item connections, not photo assets, captions or albums, and prunes invalid opening selections. These changes share one draft history entry, so one **Undo** restores them together. To reverse consolidation, discard before Apply or Undo the relevant draft revision and re-review; there is no arbitrary historical split editor. A published change needs another Publish to reverse it for visitors.

Unapplied proposals and later draft changes cannot alter the current publication. Public catalogs contain no import baselines, source filenames, excerpts or review choices. The server derives accepted values from its saved proposal; a client submits only a recorded choice and the candidate revision. Stale choices and superseded Apply requests are rejected.

## Limits and verification

This remains the bounded pilot: up to 100 catalog items, 24 comparable attributes, 40 PDF pages, 60,000 extracted characters and 50 knowledge operations per site. Private artifacts retain the existing 700,000-byte storage limit; oversized imports fail explicitly. Review metadata is pooled to avoid repeating an entire excerpt for every changed field.

The [evaluation packs](../fixtures/evaluation-packs/README.md) contain synthetic tequila, bookstore and class material, source revisions, expected facts and visitor journeys. Automated checks exercise local extraction, review decisions, persistence, photo preservation and visitor controls. Prose interpretation expectations are evaluation targets; no live model quality is claimed. Run `npm run check`, then `npm run test:browser` after the production build, using the isolated demo harness described in [Contributing](../CONTRIBUTING.md).

The [semantic architecture](semantic-graph-architecture.md) declares adapter and retrieval bounds, identity rules and the exact code map. The [workspace handoff](semantic-workspace-handoff.md) includes executable synthetic examples. Still separate: deployed OCR workers, scanned-PDF OCR, complex Office layout/date-serial support, longer-running imports and authorized live interpretation evaluation. A failed/unavailable OCR runtime is an explicit Studio error, not a successful empty import.

DOCX tracked edits, referenced footnotes/endnotes, drawings and dynamic fields now fail explicitly. Accept revisions and export all relevant content to text before importing. This avoids combining deleted/new claims or silently dropping referenced material. See [independent integration review](astra-integration-review.md) for the regression evidence.

## Brochures and prose: content-first review

Prose interpretation asks for substantial topic/section entities with heading and paragraph blocks, with places, people and offerings retained as separately addressable related records. The model must cite basic names/types/summaries separately from typed facts. Exact, whole-label occurrences can supply missing **name locations** deterministically from complete source excerpts; they do not verify type, identity, alias, summary or fact claims.

For model-interpreted PDF, DOCX, text and OCR sources, `lib/document-reading.ts` preserves the extracted text as one bounded document-reading entity alongside the graph. Paragraph blocks reassemble the exact extraction; this does not preserve visual layout or extract photographs. Shared size limits still fail explicitly. Publisher review sees that reading content before Apply; private filenames, anchor IDs and evidence are not added to the public component props. OCR errors remain source errors needing review.

`KnowledgeAssertions` groups the proposal around recognizable items instead of opening a field-by-field approval wall. The publisher can inspect each item's individual fields/evidence, or explicitly acknowledge reviewed content and approve the remaining unsupported fields in one version-bound request. That is a recorded publisher choice, never an automatic evidence upgrade. Rejected/unknown/previously approved fields are excluded from that batch. Apply is visibly disabled until pending unsupported decisions are resolved. Editing and applying are still separate, and Publish remains separate from Apply.

`websiteSections` places paragraph-rich topic records in reading sections, uses child collections before broad parent collections, and keeps a complete-document entry at the end. The same entity/collection references remain in the visitor workspace for chat/voice navigation. `PublishedWebsite` renders approved topic blocks as headings and paragraphs rather than truncating them to a summary card. Photos still require the approved media library.

Code map: `lib/document-reading.ts`, `lib/knowledge-review-groups.ts`, `lib/ingestion.ts`, `components/KnowledgeAssertions.tsx`, `components/KnowledgeReview.tsx`, `lib/website-presentation.ts`, and `packages/platform-ui/src/PublishedWebsite.tsx`. Tests: `tests/brochure-website.test.ts`, `tests/semantic-provider.test.ts`, and `tests/browser/brochure-review.spec.ts`. New interpretation instructions and complete-reading records apply to future imports; saved old proposals are not silently regenerated. Live interpretation quality has not been verified in this pass. Embedded PDF image extraction and faithful reproduction of brochure layouts are not implemented.

Validation: `npm run check` passed (417 server tests, 21 rendering tests, package-consumer verification and production build). The isolated brochure browser test passed with synthetic heading-based text and paid services disabled, covering explicit approval, Apply versus Publish, full topic text on desktop/mobile, opening a topic and Home. This confirms the workflow and rendering, not live PDF interpretation quality.
