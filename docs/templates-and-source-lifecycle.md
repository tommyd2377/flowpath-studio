# Templates, Branding and source lifecycle

For the September 18 typography, composition, website motion control and scrolling refinement, see [regular website design and motion](website-design-and-motion.md) and the [current screenshot gallery](screenshots/website-design/README.md). The original captures below remain a historical baseline.

Implemented in the current working checkout on 2026-09-16. This extends the existing knowledge, media, website and assistant architecture. It does not introduce another knowledge store or a second browsing catalog. Existing uncommitted work was the baseline; deployment and live paid testing were outside this implementation.

The baseline already included the current assistant layer and related voice/media work. Changes observed during this task in `lib/visitor-active-image.ts`, `tests/browser/ai-carousel.spec.ts`, `tests/media-storage.test.ts` and `docs/voice-chat-speed-implementation-2026-09-16.md` were preserved; they are not claimed as part of this template implementation.

## Publisher guide

1. Open **Branding** and choose **Editorial**, **Showcase** or **Clarity**. The chooser uses your actual draft information and reviewed photographs. Nothing from a sample is inserted into your site.
2. Set the name, logo and short tagline. Choose a palette and font pairing, then text size and spacing. Optional custom accents fall back to readable palette colors when necessary. Use the desktop/mobile preview, then **Save draft**. **Reset styling to template defaults** changes styling only.
3. Upload related files in **Files**. In **Knowledge**, choose the main source and expand **Include related files in this review** to select up to five others. Choose **Interpret related sources**. For a public website, use the existing **Import a website** flow and review selected pages and photos.
4. Review the per-file report, impact summary, source excerpts, possible duplicates, conflicting values and retained corrections. Resolve pending assertions and save corrections. If a batch is incomplete, explicitly acknowledge its failed-file report before **Apply to draft**. Apply never publishes.
5. For updates, upload a replacement. The same normalized filename updates its previous source; for a renamed file choose **Replace [source]** and review it individually. To withdraw old information, use **Manage contributing sources → Review removal**, inspect the proposal, then Apply. Deleting an original file in Files is a separate operation.
6. Review the saved draft in desktop and mobile modes and choose **Publish**. Existing sites need **no migration or reimport**: the regular website now uses the refined renderer even when an older snapshot has no template selection, preserving saved colors and content. Explicit template/style changes still require Save draft and Publish.

## Three original design directions

| Template | Composition | Defaults |
| --- | --- | --- |
| Editorial | Ruled masthead; asymmetric opening with arched optional image; expressive serif headings; spacious, numbered lists; parallel headings and reading columns; ruled footer and details | Linen, Literary, spacious |
| Showcase | Compact capsule navigation; large headline beside supporting copy; wide opening image; stepped image collections; restrained square edges; prominent expanded headings | Ink, Modern, comfortable |
| Clarity | Clear navigation; contained introduction; useful page directory when there is no opening image; approachable cards; practical information and clear calls to action | Cloud, Familiar, comfortable |

All three support text-only sites. Empty sections disappear. Offerings, collections, substantive reading, practical information, FAQs, reviewed albums, contact and hours appear only when supplied. The templates contain no industry-specific business claims, testimonials, statistics, operating hours, stock, booking or checkout actions. The footer preserves the existing **Made with FlowPath Studio** attribution; Studio's own identity/footer remains separate.

Design research used Squarespace's [Paloma example](https://www.squarespace.com/templates/paloma-fluid-demo), [Waverly example](https://www.squarespace.com/templates/waverly-fluid-demo), [web design basics](https://www.squarespace.com/blog/the-squarespace-guide-to-web-design-basics) and [design principles](https://www.squarespace.com/blog/top-principles-of-web-design). The applied principles are a clear first impression, readable typographic hierarchy, deliberate whitespace, balanced imagery and visible navigation. Layouts, styling and implementation here are original; source templates, code and business content were not copied.

Navigation uses stable local anchors, a native mobile disclosure, a keyboard skip link, visible focus and at least 44px primary controls. Container-based composition and percentage-based outer gutters support standalone pages and narrow Studio frames. The existing Motion library supplies reveal and disclosure; reduced motion retains navigation without movement. Native detail dialogs close with Escape and return focus to the opener.

## Style contract and compatibility

The portable `@thevoice/platform-ui/site-design` export owns `siteDesignSchema`, `WEBSITE_TEMPLATES`, `FONT_PAIRINGS`, `SITE_PALETTES`, template selection/reset and CSS token generation. `SiteContent.style` uses that schema. Additions are optional for saved snapshots:

```json
{
  "version": 1,
  "template": "editorial",
  "layout": "editorial",
  "palette": "linen",
  "paletteVersion": 2,
  "typography": "literary",
  "textSize": "standard",
  "spacing": "spacious",
  "websiteMotion": "subtle",
  "customAccent": false,
  "entry": "website",
  "customized": ["spacing"]
}
```

- `template`: editorial / showcase / clarity. Absent means legacy presentation.
- `layout`: the existing balanced / editorial / compact compatibility value.
- `palette`: linen / ink / cloud / sage / cobalt / coral / orchid / sunshine, plus retained midnight / forest / parchment.
- `paletteVersion`: optional `2`, selected with a palette or fresh template defaults. Saved styles without it keep the original Linen/Ink/Cloud/Sage colors. Unrelated style edits and an explicitly retained palette across template changes preserve that choice. Choosing a palette or resetting styling opts the draft into the refreshed colors; publication remains separate.
- `typography`: literary / modern / humanist (shown as **Familiar**).
- `textSize`: standard / larger; larger scales relevant text by 1.125.
- `spacing`: compact / comfortable / spacious, with spacing multipliers 0.75 / 1 / 1.3.
- `websiteMotion`: optional off / subtle / expressive. Absent means Subtle. Branding's **Website motion → Scrolling & transitions** previews the current draft immediately. Expressive enables selected template effects; reduced motion overrides all animation choices. The setting affects only the regular website, preserves other branding, travels between templates, and resets to Subtle. Save draft does not update the publication.
- `customAccent`: opt-in use of the existing `SiteContent.accent`; invalid contrast uses the palette accent. Palette text, muted text, accent and button foreground pairings have contrast tests.
- `entry`: existing website / assistant preference, independent of every styling update and reset.
- `customized`: optional list of deliberate palette, typography, textSize, spacing, customAccent and websiteMotion choices (up to six). Explicit choices travel between templates; untouched defaults follow the new template. Earlier saved template styles infer customization from differences from their template defaults.

Identity stays in the existing content fields (`name`, `logoAssetId`) plus optional `tagline` (180 characters). Reset preserves content, accent input, logo, source corrections, media revisions, stable item IDs, capabilities, opening selections and the entry preference. Every individual control merges its style patch into the current object. The website-import design application likewise preserves a selected template, independent settings, opening selections and tone.

New sites start with Clarity and website preference. Existing content without `style.template` retains its legacy layout and palette path; it is never silently opted in. Explicitly disabled assistant settings remain disabled when the draft loads. Preview edits, saved drafts and published snapshots remain distinct.

### Eight distinct palettes

The color refresh adds four expressive choices and removes the shared green tint from the original neutral options. Large swatches show the page, section and accent colors. Every palette colors the ordinary website and shared assistant components without model calls.

| Palette | Direction |
| --- | --- |
| Linen | Warm cream, peach sections and terracotta |
| Ink | Cool charcoal, soft white and ice blue |
| Cloud | Crisp blue-white, pale blue sections and ultramarine |
| Sage | Fresh leaf green, light mint and deep green |
| Cobalt | Saturated royal-blue pages with lemon accents |
| Coral | Salmon pages, peach sections and raspberry accents |
| Orchid | Deep violet pages with pink accents |
| Sunshine | Golden-yellow pages with purple accents |

Text, muted text, accents and button foregrounds meet the existing 4.5:1 contrast checks on their paired backgrounds. The original four definitions remain available only for saved styles; publishers can select any refreshed swatch in Branding to update their draft. New palette and responsive chooser screenshots are in the [palette gallery](screenshots/palettes/README.md).

## Fonts and loading

Manrope and Newsreader are licensed under **SIL Open Font License 1.1**, which permits commercial use and redistribution under its conditions. Their original notices are included in [Manrope-OFL.txt](../public/fonts/Manrope-OFL.txt) and [Newsreader-OFL.txt](../public/fonts/Newsreader-OFL.txt). Upstream projects: [Manrope](https://github.com/googlefonts/manrope) and [Newsreader](https://github.com/productiontype/Newsreader).

The application serves three local TTF files through `app/site-fonts.css`: Manrope regular (94,972 bytes), Manrope semibold (95,096 bytes), Newsreader regular (109,472 bytes). Total font payload is 299,540 bytes before transport compression, about 293 KiB. `font-display: swap` and Georgia/Times, Arial/Helvetica or system-sans fallback stacks keep text visible. Semibold supplies the 500–800 styling range. Fonts load when their family/weight is used; the visual Studio chooser can load all three. There are no third-party font requests or model calls for styling. Shared consumers supply their own font loading; the package has no Next.js dependency.

## Source interpretation and composition

The three existing layers remain separate:

| Layer | Responsibility |
| --- | --- |
| Private source artifact | File hashes, source origins/baselines, excerpts, field/fact/relationship evidence, pending decisions and correction history |
| Canonical catalog | Stable entities, typed attributes and singleton properties, facts, meaningful variants, relationships, nested collections and explicit registered capabilities |
| Website/assistant presentation | Deterministic grouping and tokens; validated references to approved records and media |

`composeWebsiteSections` groups exact references, never similar names. Specific child collections lead; generic “All items” groups and document/crawler containers do not become repetitive initial-page sections. Substantive paragraphs remain reading content; policies, contact/location/hours and FAQs receive useful presentation. A source file does not become a section simply because it exists. Detailed approved prose remains in the catalog and in expanded views/retrieval. Initial reading previews show at most two blocks with bounded excerpts; collection sections initially show six entries (eight photos), with an explicit expansion control.

`detailedWebsiteEntry` and the assistant use the shared `knowledgeFacts`, `selectFactValue` and formatting rules. The ordinary website's full detail does not inherit the assistant's bounded context window. Qualifiers, conflicts, unknowns and validity remain visible. Qualified table amounts such as “from 18 per person, minimum 6, 48 hours notice” remain text rather than becoming an exact numeric price. Same-name offerings with different variants stay separate.

Only an explicit site lead association or opening image selection supplies the opening photograph. A menu screenshot used for OCR is evidence and is not automatically promoted to a hero. Reviewed album and entity associations control other image placement; illustrative example labels remain visible.

Public websites retain the existing DNS/private-network checks, HTTPS bounds, robots/discovery reports and no-script-execution boundary. DOCX, XLSX, PDF and OCR continue through their existing extractors. Unavailable OCR, scanned PDF pages, unsupported Office features, header-only tables and oversized/incomplete results produce errors. Completion of byte/text extraction is explicitly distinguished from semantic coverage and OCR recognition quality.

## Addition, replacement and withdrawal

Related-file review accepts one to six distinct uploads. Extraction is sequential and bounded, with per-file waiting/processing/ready/unchanged/failed states. Structured sources need no model. Prose sources share **one** bounded interpretation request with separate source IDs and separately validated evidence. This preserves the existing quota reservation and cooldown behavior: a batch does not reserve a new request for each file. Combined prose is limited to 60,000 extracted characters or 400 KB of private source evidence, checked before reservation; the existing 90-second request timeout, 10,000 output-token cap and response-size bound remain. Larger groups require explicit smaller reviews. No retry or hidden fan-out is introduced.

Exact-byte duplicates of previously reviewed sources skip extraction/interpretation; exact duplicates within one batch share the first result and never create another origin or duplicate records. Two files targeting the same normalized source name/replacement are rejected before processing. Each successful source produces an immutable checkpoint. A failed fetch, extraction or interpretation retains that source's previous contribution. A partially successful batch exposes its failed-file report and requires acknowledgement before Apply; all-failed batches offer no candidate.

Replacement reuses the current merge workflow. Stable source IDs or approved identity matches preserve item IDs and media connections. Name similarity alone proposes review. Untouched fields can accept incoming values, publisher corrections are retained by default, missing records remain for review, and deliberately removed records do not silently return. Conflicting definitions/currencies fail without guessed conversion.

**Review removal** uses the same candidate → correction → Apply pipeline. `removeSourceContribution` compares the source baseline, current canonical value and remaining source support:

- Matching support from another active source keeps the field/fact/relationship.
- One unambiguous remaining value can replace a withdrawn value; ambiguous remaining claims stay unknown with a review note.
- Deliberate publisher field corrections survive. Unsupported, unchanged values are cleared; an unchanged item supported only by the withdrawn source is retired.
- Retired origins remain private tombstones. Later changed imports still respect publisher removals, and an identical-byte replay is a no-op.
- Relationships, collection membership/hierarchy, scoped capability references, media associations and opening selections are reconciled through the existing Apply boundary. Removing the last source can create a valid empty revision; importing an empty source is still an error.

The impact panel identifies added/updated/removed information, duplicate/conflict review, retained corrections and affected collections, reading sections, photo associations and opening selections. Original uploaded files and photo assets are not deleted by contribution withdrawal. Existing **Files → Delete** removes an original upload, not approved knowledge. Reviewed identity/headline/contact/hours/manual sections are independent publisher copy; withdrawal preserves them rather than guessing their source ownership. The removal review calls this out so the publisher can revise that copy deliberately.

## Publication and assistant consistency

Styling changes reference the same canonical knowledge/media revisions; switching templates requires no extraction or model. Publish continues to validate and stage the immutable catalog and media projection before installing the site snapshot. Website, chat/voice authority and action validation resolve that published snapshot. Draft-only changes and source evidence remain private.

The ordinary website and the existing assistant layer inherit the same typography, spacing and detail tokens. [The Voice](the-voice.md) now offers an independent accent for the waveform and chat controls; publisher cards and expanded details retain the website palette. Sites without an explicit voice color retain their existing appearance. The current checkout's browsing/filtering/task behavior is retained; this implementation adds no detached catalog. Comparison rendering now passes the registered component ID while keeping its independent assistant-card identity. Clicking a compared item opens its validated detail while retaining the comparison for return.

Manual website actions cancel stale assistant work. Existing screen acknowledgement, clear, Home, close/reopen, return and cancellation paths remain. Large-catalog page/detail reads include their expected publication ID and reject changed publications with HTTP 409. Local remounts reset selected references when the content revision changes. An already open page requires reload to adopt a new publication; it cannot mix a stale requested record with the new publication. External research remains labeled separately and never enters the publisher's approved facts through template selection.

## File map

| Files | Change |
| --- | --- |
| `packages/platform-ui/src/site-design.ts`, package exports | Additive style schema, template defaults, customization/reset and contrast-aware tokens |
| `packages/platform-ui/src/PublishedWebsite.tsx`, `styles.css` | Three controlled compositions, mobile navigation, content sections, details/card typography and assistant tokens |
| `packages/platform-ui/src/knowledge.ts`, `contracts.ts` | Shared value formatting; allow empty catalog after deliberate withdrawal |
| `components/BrandingPanel.tsx`, its CSS, `EditorPanels.tsx` | Actual-content chooser, identity and independent styling controls |
| `components/Dashboard.tsx` with the existing `Workspace.tsx` preview host | Preview integration, template name, per-file upload progress and consistent size checks |
| `components/SiteExperience.tsx`, `WebsiteSurface.tsx` | Template host, full detail values, explicit hero policy, cancellation and publication-safe page reads |
| `components/VisitorAssistant.module.css`, `VisitorVoiceStage.module.css`, `Waveform.tsx`, `VisitorWorkspace.tsx` | Matching assistant appearance and validated comparison rendering |
| `lib/site-model.ts`, `site-style.ts`, `local-store.ts`, `visitor-model.ts`, `site-opening.ts` | Compatible persistence, new-site defaults and preservation of disabled assistant/opening behavior |
| `lib/website-presentation.ts`, `knowledge-display.ts`, `website-import-model.ts`, `components/WebsiteDesignReview.tsx` | Canonical composition, full qualified details and import/template coexistence |
| `lib/source-lifecycle.ts`, `knowledge-model.ts`, `knowledge-store.ts`, `knowledge-assertions.ts` | Withdrawal/support rules, retired origins, impact and per-file reports |
| `lib/ingestion.ts`, `source-extractors.ts`, `components/KnowledgeReview.tsx` | Related-source requests, duplicate handling, partial review and qualified values |
| `app/api/sites/[siteId]/knowledge/route.ts`, `app/api/visitor/[slug]/catalog/route.ts` | Validated batch/withdrawal actions and publication-bound catalog reads |
| `app/site-fonts.css`, `app/layout.tsx`, `public/fonts/` | Local licensed fonts; no external font dependency |
| `fixtures/template-sites.ts`, `tests/template-design.test.ts`, `tests/source-lifecycle.test.ts`, `tests/semantic-provider.test.ts`, `tests/browser/templates.spec.ts` | Synthetic design matrix, style invariants, source lifecycle and bounded provider-envelope regressions |

## Verification and limits

The initial template/source delivery passed `npm run check`: lint, typecheck, **536 server tests**, **21 rendering tests**, packed standalone package consumer verification and production build. Related-source provider behavior is tested through a synthetic request callback, including one-call accounting, preflight limits, partial/missing results, foreign anchors and duplicate source references. The response schema follows the official [Structured Outputs constraints](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas). No live model or OCR quality is claimed.

Browser verification uses the existing isolated Chromium/demo harness on `127.0.0.1:3225`, with synthetic files, original synthetic illustrations, blocked external requests and mocked model/audio flows. It covers the nine content/template combinations (menu business, freelancer/services, informational guide), desktop, mobile, embedded previews, full details, sparse 320px layouts, 100-item collections, long labels, keyboard/focus/reduced motion, independent styling persistence/reset, multi-file partial review/withdrawal, and publication-scoped large-catalog details. Screenshots are collected and visually reviewed in the [visual evidence gallery](screenshots/templates/README.md).

Focused commands, run as separate invocations to respect the demo's 12-site limit:

```sh
npm run check
npm run test:browser -- tests/browser/templates.spec.ts --output=test-results/platform/templates-final
npm run test:browser -- tests/browser/source-review.spec.ts tests/browser/semantic-ingestion.spec.ts tests/browser/brochure-review.spec.ts --output=test-results/platform/source-regression
npm run test:browser -- tests/browser/ai-carousel.spec.ts --output=test-results/platform/assistant-regression
```

The initial delivery passed **23 focused browser scenarios**: eight template scenarios, four source/prose/identity review scenarios and eleven existing assistant regressions. The assistant regressions cover desktop/mobile filtering, close/reopen/Back/Home/clear, mocked voice screen acknowledgement, cancellation, stale answers, paged 10,000-record browsing and mocked video playback. Inspected captures are recorded in the gallery. These are focused acceptance/regression runs, not a claim that every browser test in the repository ran.

The subsequent eight-palette refresh passed `npm run check` with **537 server tests** and **21 rendering tests**, plus **all nine template browser scenarios** (the original eight and a new palette persistence/preview scenario). The [palette gallery](screenshots/palettes/README.md) records the final colors, desktop/mobile captures, compatibility and contrast coverage.

Bounds remain 100 entities/24 comparable attributes in semantic catalogs, 40 pages per PDF, 60,000 extracted characters per source, 700,000-byte private knowledge artifacts and 50 knowledge operations per site. Separately compiled large collections retain their paged path. Complex Office layouts, scanned-PDF OCR, deployed OCR workers and real-world semantic/OCR accuracy remain outside the verified implementation. Multi-file interpretation may require smaller groups when detailed output cannot fit the shared cap; it reports this instead of truncating silently.

Performance expectations, not benchmarks: deterministic template switching avoids model latency/cost; one prose-batch request avoids repeated prompt/quota overhead; shared composition reuses one fact projection per page. Font loading adds the bounded payload above. No new dependencies, production configuration, deployment, GitHub push or customer publication were performed.
