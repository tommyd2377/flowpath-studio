# Knowledge and shared interface foundation

This implementation joins two platform capabilities: reusable publisher knowledge and controlled visitor interfaces. The separate news app in FlowPath remains an independent test publisher. Its editorial rules and product logic are not imported here.

## Try it locally

Use Node 24 and the existing application setup. `npm run dev` builds the shared package and starts Studio on its normal port, 3220. No environment changes are needed for the local demo.

1. Create a site with **Start from my content**.
2. Upload one of the synthetic CSV or TXT files in `fixtures/source-packs` through **Files**.
3. Open **Knowledge → Interpret source**. Review the inferred items, attributes, collections, relationships and likely visitor needs.
4. Edit fields, or try `Rename "Example Blanco" to "House Blanco"`. Save corrections and apply the proposal to the draft.
5. In **Content → Opening experience**, choose highlights, tone and featured items. Configure chat or voice using the existing controls. Existing voice-only defaults remain intact.
6. Review the draft preview, then publish locally. The public view supports filtering, selection, comparison, details and relationship navigation without any AI request.

**Review draft knowledge** starts a new correction proposal from an applied catalog, including after the original upload has been deleted. Publisher links are explicit HTTPS destinations. They are navigation links, not inventory, checkout or booking integrations.

`/lab` demonstrates the same package with three intentionally different synthetic catalogs: agave products, books/editions/authors, and classes/experiences. Its typed planner is deterministic and makes no model calls.

## Boundaries

- CSV and labeled TXT blocks are interpreted locally. Text-bearing PDF pages are extracted locally with installed PDF.js assets. Free-form prose uses the configured direct model connection when available; the offline demo reports when it cannot interpret it.
- Originals, import jobs and provenance remain private. Immutable catalogs are stored separately from the site's small content document. A separately staged public projection contains only the catalog; it is served only while referenced by the current publication.
- Correction produces a new candidate. Apply checks the current draft and import claim; publication is separate. Cloud Apply commits the site and job state in one transaction. Local Apply holds the job lock across the site write. Recovery fences older claims instead of replaying provider calls.
- Reimport uses the same filename plus stable item IDs. Publisher field corrections and explicit removals survive. Unchanged imported fields update; missing source items remain flagged for review. Unchanged removed source relationships/collections are removed in the proposed merge. Cross-source identity merging is deliberately not automatic.
- The model returns a schema-bound plan containing existing IDs, component types, variants and semantic transitions. The runtime validates references, compiles local OpenUI, preflights its real parser, and renders registered React components. It supplies no arbitrary generated HTML, CSS, URLs or executable actions. Invalid or stale plans retain the current useful view.
- Filtering, selection and navigation remain local. Manual interaction cancels pending model requests. A shared snapshot contract is used by text and voice; no voice is required for browsing.
- Controlled motion honors reduced-motion preferences. OpenUI's remote developer inspector is disabled before the rendering library loads.

The shared motion vocabulary uses 480 ms reveals/disclosures, 560 ms layout rearrangement, 620 ms larger workspace changes and 400 ms exits. Runtime-owned timing applies to surrounding layout too, even when only one component receives semantic emphasis. Height changes use measured content rather than scaling text; disappearing controls become inactive immediately. A requested detail or comparison is brought into view after its geometry settles, with pending scrolling cancelled by manual interaction. Small button feedback remains quick and reduced motion removes the transitions.

## Shared package

`packages/platform-ui` builds into a portable ESM package with JavaScript, type declarations and scoped CSS. It has no Studio aliases, Firebase connection, application models or provider credentials. Publishers share this component/motion vocabulary while supplying their own catalog and identity.

Import `@thevoice/platform-ui` for React components, `/contracts` and `/catalog` for pure schema/data utilities, `/interaction` for deterministic interaction helpers, `/media` for media contracts and lookups, and `/styles.css` for styling. Rebuild the package after editing its source during development. The [architecture guide](architecture.md) maps these boundaries to source files.

`npm run test:package` packs the artifact and renders it from a separate temporary consumer. It verifies emitted JavaScript, declarations, CSS and real OpenUI parsing without relying on Studio source imports. It does not modify the independent news app.

## Operational visibility and cost

Upload, extraction, interpretation, correction, preview, approval, publication, visitor intent and presentation results have bounded event records. Observed selections and link clicks are distinct from a verified external outcome. Events contain IDs, status, timing and counts; source text and conversations are excluded. Studio's Usage & billing panel shows recent activity, with preview and public activity separated.

The current event store retains the latest 200 records per site. It is an operational window, not complete acquisition, conversion or retention analytics. Provider-reported token counts are recorded when present. Missing or interrupted usage remains unknown. Attempt limits are not invoices or monetary spending limits.

Existing daily request limits remain in force. Direct generation has a single bounded attempt; there are no automatic paid repair loops. Browsing remains available when AI is unavailable or exhausted.

## Current pilot limits

- Upload: 10 MB photos, 2 MB PDFs, 256 KB CSV/TXT; 100 photos plus 20 other sources, with a 100 MB site cap including photo originals and display variants.
- Extraction: 40 PDF pages and 60,000 extracted characters. Empty/unreadable pages, encrypted or damaged PDFs and unsupported OCR paths fail explicitly. Embedded PDF images are not interpreted.
- Catalog: 100 entities, 24 attributes and bounded collections/relationships/jobs. Oversized records fail rather than silently truncating.
- Import/review activity: 50 explicit attempts per site in this pilot. No unattended worker or automatic paid retry. Ambiguous interruptions require an explicit new attempt after checking saved state.
- The demo correction grammar supports exact-name rename and attribute changes; broader conversational corrections require the configured interpreter.

The first photo and album release adds publisher-reviewed media, contextual card imagery and shared galleries. See [Photos and albums](photo-library.md) for the workflow, current image limits, publication boundaries and connected-interpretation scope.

Remaining milestones include DOCX/XLSX/website/OCR ingestion, larger durable processing, richer source-location provenance, broader correction coverage, longitudinal funnel analytics, monetary reservation/reconciliation and hard spending limits, and self-serve launch onboarding. Live model quality, Firebase integration and deployment behavior need separately authorized verification; offline results do not establish those.

## Verification

- `npm run check`: lint, typecheck, persistent offline contract/storage/provider tests (including mocked Firebase transactions), real local OpenUI/SSR tests, separate packed consumer, production build.
- `npm run test:browser`: fresh headless Playwright context and isolated demo data on port 3225. External browser requests and microphone access are blocked; no signed-in browser profile is used. Build the app first.

The browser suite exercises actual Studio upload/review/publish and visitor controls, unpublished snapshot isolation, malformed/stale/late mocked plans, mobile reduced motion and all three fixture catalogs. Provider and Firebase transaction tests are mocked; PDF parsing, local persistence and production browser rendering are real.
