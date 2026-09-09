# Architecture

Studio turns publisher material into reviewed knowledge and media, then publishes a snapshot that the visitor runtime can arrange around the visitor's task. The host owns ingestion, persistence, identity, provider access and publication. The shared React package owns the semantic rendering vocabulary and interaction behavior. See [product philosophy](product-philosophy.md) for the product direction and [platform foundation](platform-foundation.md) for the current pilot scope.

```mermaid
flowchart LR
  Upload[Private uploads] --> Interpret[Extract and interpret]
  Interpret --> Review[Publisher review and correction]
  Review --> Draft[Draft revision references]
  Draft --> Publish[Validate and publish snapshot]
  Publish --> Runtime[Shared visitor runtime]
  Visitor[Visitor controls or request] --> Runtime
  Runtime --> Plan[Validated presentation plan]
  Plan --> OpenUI[Local OpenUI grammar and React components]
```

## Code map

| Boundary | Main files |
| --- | --- |
| Studio and review | [Dashboard](../components/Dashboard.tsx), [KnowledgeReview](../components/KnowledgeReview.tsx), [MediaPanel](../components/MediaPanel.tsx), [OpeningSettings](../components/OpeningSettings.tsx) |
| Source ingestion and corrections | [source-extractors](../lib/source-extractors.ts), [ingestion](../lib/ingestion.ts), [knowledge-model](../lib/knowledge-model.ts), [knowledge-store](../lib/knowledge-store.ts) |
| Photo preparation and review | [image-processing](../lib/image-processing.ts), [media-interpretation](../lib/media-interpretation.ts), [media-store](../lib/media-store.ts) |
| Site persistence and publication | [site-model](../lib/site-model.ts), [site-store](../lib/site-store.ts), [site-commands](../lib/site-commands.ts), [site API](../app/api/sites/[siteId]/route.ts) |
| Shared schemas and renderer | [contracts](../packages/platform-ui/src/contracts.ts), [media contract](../packages/platform-ui/src/media.ts), [Runtime](../packages/platform-ui/src/Runtime.tsx), [components](../packages/platform-ui/src/components.tsx), [MediaViews](../packages/platform-ui/src/MediaViews.tsx) |
| Visitor host and provider boundary | [SiteExperience](../components/SiteExperience.tsx), [VisitorAssistant](../components/VisitorAssistant.tsx), [visitor API](../app/api/visitor/[slug]/route.ts), [catalog-presentation](../lib/catalog-presentation.ts), [visitor-provider](../lib/visitor-provider.ts) |
| Access, usage and observations | [session](../lib/firebase/session.ts), [visitor-store](../lib/visitor-store.ts), [visitor-quota](../lib/visitor-quota.ts), [platform-events](../lib/platform-events.ts) |

## Knowledge: upload → review → publication

Uploads pass ownership, revision, byte-type and size checks in [file-validation](../lib/file-validation.ts) before becoming private site files. CSV and explicit key/value TXT records have deterministic parsers. PDFs are parsed locally with PDF.js; text extraction uses locally resolved worker/font assets and performs no OCR. Freeform prose requires the optional configured semantic interpreter. An unsupported or oversized source fails explicitly rather than becoming a partial successful catalog.

The reusable `KnowledgeCatalog` has versioned identity, typed attribute definitions, entities, collections, relationships and suggested visitor jobs. Attribute values are text, finite numbers, booleans or `null`, with money/date validation and optional units. Unknown values remain unknown. Source filenames, hashes, baselines and import notes belong to a separate private `KnowledgeArtifact`; they are absent from the public catalog projection.

An import creates a saved candidate with a review status, source hash, base draft hash and claim token. Reimporting identical source bytes creates no duplicate entities or model call. Changed sources with the same normalized filename and stable record IDs can preserve publisher corrections while updating untouched source values. This is bounded merge logic, not general semantic identity resolution across arbitrary documents.

Publishers can edit the candidate directly or use conversational corrections. Exact-name rename and attribute changes work locally; broader corrections require the connected interpreter. Corrections create new immutable candidate artifacts. Apply checks the current source, draft and claim before replacing only the draft's `knowledgeRevisionId`. Superseded work cannot overwrite a later correction or draft. The cloud transaction checks the claim with the site mutation; the local backend serializes that boundary. [Knowledge tests](../tests/knowledge-store.test.ts) and [mocked cloud tests](../tests/knowledge-cloud.test.ts) cover these paths.

Knowledge and media use independent revision references in `SiteContent`. Publish validates opening references and media associations, stages immutable public projections, then changes the published site snapshot under the site revision check. A staged projection is still inaccessible through public routes until it matches the current publication. Undo changes the draft; republishing is required to change visitor content.

Knowledge does not imply capabilities. The current catalog capability contract permits explicitly registered HTTPS navigation links with entity scope. Ingestion creates no capabilities, and model display plans can reference only registered IDs. There is no implemented inventory, reservation, checkout or other executable integration in this slice.

## Photos and albums

Photos remain within Studio's Files workflow and work before a catalog exists. A `MediaLibrary` holds assets, ordered albums and explicit site/entity/section associations, including actual-subject versus example roles. One photo can belong to multiple albums and targets. Dimensions come from stored image metadata; review requests cannot invent them.

New uploads are decoded, orientation-corrected and re-encoded into metadata-free WebP display and thumbnail variants. Originals remain private. Selected IPTC/XMP description and credit fields can become review metadata, and publishers control the final caption, alt text and credit. Local suggestions use supplied text and metadata. The separate **Suggest from photos** action optionally sends a bounded selected batch of sanitized thumbnails to the connected provider and returns a review proposal.

Apply creates an immutable private media revision and updates the draft. The current publication carries an image allowlist, so [public image requests](../app/api/public-files/[slug]/[fileId]/route.ts) serve only its approved images or chosen logo. Storage paths and original bytes do not enter model plans or the shared media contract. The host supplies an asset URL resolver to `MediaProvider`; the shared package renders galleries, contextual imagery and the keyboard-accessible viewer. See [Photos and albums](photo-library.md) for the complete workflow and deletion rules.

## Shared runtime and interaction

`@thevoice/platform-ui` is a portable ESM workspace package. React exports live at the package root; `/contracts`, `/catalog`, `/interaction` and `/media` expose pure contracts and helpers, and `/styles.css` supplies the design vocabulary. It has no dependency on Next.js, Firebase, Studio storage or provider credentials. Its [package manifest](../packages/platform-ui/package.json) and [separate-consumer check](../scripts/verify-platform-package.mjs) define and verify that boundary.

A `PresentationPlan` selects bounded components and compatible variants by catalog/media IDs: collection, criteria, detail, comparison, selection, relationships, actions and gallery. Its operation names describe discover, understand, narrow, compare, decide or act; these are available operations, not a required wizard. The plan also identifies the catalog snapshot and a semantic transition. Each component type has one stable slot, detail has one entity, and comparison requires two to six entities and at least one declared attribute. Provider instructions also request meaningful shared attributes; the structural validator does not establish the usefulness of a comparison.

The host validates provider envelopes and references. The browser validates again, then [compiles](../packages/platform-ui/src/compile.ts) the plan into local OpenUI statements, runs a bounded [preflight](../packages/platform-ui/src/preflight.ts), parses them with the real OpenUI parser and renders registered React components. OpenUI is the rendering grammar; it does not supply the platform's visual identity. The model generates neither arbitrary markup/styles nor executable callbacks. OpenUI Gateway is not a runtime dependency.

`CatalogExplorer` owns filters, selected IDs, focus, visible entity IDs and bounded view history. Manual filtering, selection, comparison, detail, restoration and photo viewing work without model calls. A pending response is cancelled or ignored after newer manual interaction; malformed, stale and unsupported plans preserve the accepted view. Unknown numeric values do not pass numeric filters. Explicit empty gallery selections cannot become all photos. Empty collection references have a distinct documented meaning: all members of the scoped collection or catalog.

The [motion vocabulary](../packages/platform-ui/src/motion.tsx) owns reveal/disclosure (480 ms), reflow (560 ms), workspace/focus/restore (620 ms) and exit (400 ms). Persistent components retain identity; disclosure height moves surrounding layout, and exiting controls become inert immediately. Reduced motion removes movement. Requested detail/comparison/action/gallery destinations wait for settled geometry, with a 900 ms guard, before scrolling only when offscreen; user input cancels that pending reveal. The runtime does not require focus transfer for this automatic scrolling. [Motion browser tests](../tests/browser/motion.spec.ts) inspect intermediate geometry and interruption behavior.

Sites without a catalog continue through [SitePresentation](../components/SitePresentation.tsx), which renders published intro, sections, hours, contact and approved photos. This legacy host path shares motion utilities but uses a smaller source-selection plan. New sites currently default to Voice only; publishers can choose chat or both, and ordinary visual browsing requires neither voice nor AI. See [visitor conversations](visitor-conversations.md) for lifecycle and fallback behavior.

## Optional direct model access

The default demo backend and Studio visitor preview use deterministic behavior and cannot call paid model APIs, even if a key exists in the environment. Connected generation requires Firebase workspace mode plus the explicit OpenAI mode and server configuration. Configuration availability is not proof of a working live connection. See the existing [Firebase setup](firebase-setup.md) and [AI editor setup](ai-editor-setup.md) guides.

Owner text edits, freeform knowledge interpretation/correction and optional photo interpretation use direct Responses requests. Visitor typed requests use direct Responses; voice uses a bounded server Realtime WebSocket. No browser receives provider credentials or an extensible provider session. Voice allows one display-planning response and one spoken response; greetings use one spoken response. There are no autonomous tool rounds or automatic paid repair/retry loops. All proposals and display plans must pass local validation before affecting a draft or rendered view.

Provider context is deliberately different by operation: the text editor receives selected TXT excerpts; the semantic interpreter receives the selected extracted source or candidate; photo interpretation receives the selected sanitized thumbnails and reviewed context; visitors receive only published content/catalog/media descriptions and bounded in-memory request state. Source material is treated as data, and photo descriptions do not establish live availability or exact identity. Responses calls use `store:false`, which is not a zero-retention guarantee.

## Persistence, isolation and limits

[site-store](../lib/site-store.ts) selects [local-store](../lib/local-store.ts) or [cloud-store](../lib/cloud-store.ts). Local demo state uses a serialized JSON-file queue, with knowledge/media artifacts and image variants in separate private data directories. It is a single demo owner, not a multi-user production backend. Firebase routes derive the owner UID from the verified session; server checks enforce site ownership and revisions. Browser Firestore/Storage access is denied by the included rules. Public pages receive the approved projection, not private source artifacts, editor messages or file storage credentials.

The current bounds are pilot constraints, not subscription entitlements:

| Area | Implemented bound / source |
| --- | --- |
| Uploads | 10 MB per photo, 2 MB per PDF, 256 KB per CSV/TXT; 100 photos + 20 other files; 100 MB total including photo originals and variants. [Validation](../lib/file-validation.ts) |
| Extraction | 40 PDF pages and 60,000 extracted characters; no OCR. [Extractor](../lib/source-extractors.ts) |
| Catalog | 100 entities, 24 attributes, 24 collections, 200 relationships, 12 jobs, 20 registered links; additional payload/depth/reference checks. [Contracts](../packages/platform-ui/src/contracts.ts) |
| Media | 100 assets, 24 albums, 300 associations; 40 million decoded pixels per upload. [Media schema](../packages/platform-ui/src/media.ts), [image processing](../lib/image-processing.ts) |
| Review and storage | 50 import/review jobs per site; 700,000-byte knowledge artifacts; 750,000-byte serialized cloud site state; up to 20 draft-history entries. [Knowledge store](../lib/knowledge-store.ts), [cloud store](../lib/cloud-store.ts), [local store](../lib/local-store.ts) |
| Connected owner generations | Shared across text edits, semantic interpretation/correction and photo interpretation: 10 attempts per owner and 100 globally per UTC day, plus owner cooldown and replay protection. [AI setup](ai-editor-setup.md) |
| Visitor attempts | Default 25 chat / 5 voice per site daily; deployment-wide 100 chat / 20 voice daily. Separate from owner generations. [Visitor guide](visitor-conversations.md) |
| Observations | Latest 200 events per site, with bounded IDs, timing, counts and provider-reported usage when present. [Event store](../lib/platform-events.ts) |

Recent activity distinguishes preview from public observations. Selections, photo opens and link clicks are observations, not verified business outcomes. Knowledge, media and visitor provider paths report measured tokens when available; the legacy text editor does not yet report its per-call token usage. Missing usage remains unknown. Monetary hard limits, billing reconciliation and the complete acquisition-to-retention funnel are not implemented. Manual browsing remains available when AI is unavailable or exhausted.

Uploads and immutable projections can be staged before the final revision-checked mutation. An ambiguous transport result can therefore leave a private orphan; the implementation avoids destructive cleanup of a potentially committed object. It has no automatic orphan cleanup worker. Published/draft/retained-history media references block deletion of images still in use.

## Verification and extension

Use Node 24 and the scripts in [package.json](../package.json). `npm run check` runs lint, types, persistent offline tests, the packed-package consumer and the production build. `npm run test:browser` then starts an isolated local demo server on port 3225 with disposable data and a fresh headless Playwright context; it does not use a signed-in browser profile. See [Playwright configuration](../playwright.config.ts).

The [synthetic fixture catalogs](../fixtures/README.md) cover structurally different domains. Keep fixtures, direct-provider mocks, storage/publication tests and browser interaction tests aligned when extending a contract. Offline checks cover real local extraction, image processing, OpenUI parsing and browser layout; mocked Firebase/provider transports do not establish live service configuration or model quality.
