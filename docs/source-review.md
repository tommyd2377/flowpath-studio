# Source review and updates

Studio keeps source material private while helping publishers correct the knowledge visitors will use. Source locations are review aids, not a public editorial policy or proof that a model's interpretation is correct.

## Review an interpretation

1. Upload a CSV, labeled TXT file or text-bearing PDF in **Files**, then choose **Knowledge → Interpret source**.
2. Open an item and **Source for…** beside a field to see its saved source excerpt. CSV references identify the record and physical lines, TXT references identify lines, and PDF references identify extracted pages.
3. Use **Source material** for broader context. Excerpts over the display limit are marked as shortened. Free-form model interpretations currently have source-level context only; Studio explicitly says when a field has no exact source link.
4. Correct the proposed fields, save corrections, then **Apply to draft**. Publishing remains a separate approval. Source excerpts remain available after deleting an original upload.

The deterministic parser records references only for supplied fields it can trace to the displayed excerpt. It does not cite generated defaults, missing values or model guesses as source statements. PDF locations refer to extracted text, not an OCR or visual reading of the page. Older saved interpretations without provenance remain editable and show that excerpts are unavailable.

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

Conflicting attribute types or currencies still stop the import with an explanation; this release does not guess conversions. Different sources stay separate. There is no fuzzy matching or automatic consolidation across documents. Exact duplicate sources do not trigger another interpretation request.

The source baseline tracks the latest imported version. A kept item that disappears from that source may lose its older field links in later reviews; Studio reports unavailable support instead of attaching it to unrelated new text. An identical-byte upload is a no-op, including a renamed copy; choose the previous source again when importing changed content under that new filename.

## Photos, opening selections and publication

Field corrections and explicit source replacement retain item IDs, so existing photo connections continue to work. If a publisher removes an item, Apply removes only its item connections from a new media revision; photo assets, captions and albums remain in the library. It also removes invalid opening selections. Knowledge, media connections and opening selections change in one draft update, so one **Undo** restores them together.

Unapplied proposals and later draft changes cannot alter the current publication. Public catalogs contain no import baselines, source filenames, excerpts or review choices. The server derives accepted values from its saved proposal; a client submits only a recorded choice and the candidate revision. Stale choices and superseded Apply requests are rejected.

## Limits and verification

This remains the bounded pilot: up to 100 catalog items, 24 comparable attributes, 40 PDF pages, 60,000 extracted characters and 50 knowledge operations per site. Private artifacts retain the existing 700,000-byte storage limit; oversized imports fail explicitly. Review metadata is pooled to avoid repeating an entire excerpt for every changed field.

The [evaluation packs](../fixtures/evaluation-packs/README.md) contain synthetic tequila, bookstore and class material, source revisions, expected facts and visitor journeys. Automated checks exercise local extraction, review decisions, persistence, photo preservation and visitor controls. Prose interpretation expectations are evaluation targets; no live model quality is claimed. Run `npm run check`, then `npm run test:browser` after the production build, using the isolated demo harness described in [Contributing](../CONTRIBUTING.md).

Still separate work: DOCX/XLSX/website/OCR ingestion, field-level grounding for model-interpreted prose, cross-source entity consolidation, longer-running imports and separately authorized live interpretation evaluation.
