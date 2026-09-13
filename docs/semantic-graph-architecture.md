# Semantic knowledge: ingestion through retrieval

Implemented locally for Assignment 1. This extends the existing catalog, private artifact and immutable publication machinery, using the existing ingestion system. Its consumer is now the adaptive visitor workspace. See [the executable handoff](semantic-workspace-handoff.md) for consumers and acceptance evidence.

## Data flow and authority

```text
private upload / one public HTTPS page
  → bounded extraction → addressable fragments
  → deterministic interpretation OR one schema-bound model attempt
  → validated candidate + private provenance and assertion reviews
  → publisher corrections, identity and source-update decisions
  → Apply (one draft revision, including media/opening remaps)
  → Publish (immutable source-free, publication-authorized snapshot)
  → bounded retrieval → legacy projection / existing visitor planner
```

All source, OCR, model and tool content is untrusted data. It never supplies system instructions, credentials or capabilities. Public capabilities remain separately registered publisher links: documents, photos, prices and graph associations cannot enable inventory, reservations, payments, checkout or arbitrary navigation.

## Contracts and compatibility

`KnowledgeCatalog.schemaVersion` remains **1**. New fields are optional; old saved catalogs/publications need no destructive migration. Old attributes receive synthetic retrieval facts without rewriting the publication. Old private artifacts without assertion reviews retain their previous approved behavior; no evidence or certainty is invented.

- Entities retain stable IDs, name/type, optional aliases and scoped identifiers. Comparable fields still use shared typed attribute definitions.
- Individual facts target `name`, `kind`, `summary`, `attributes.<id>` or `properties.<predicate>`. Singleton properties require their own matching typed `definition`: an address, email, prerequisite or policy need not become a comparison column or be buried in prose.
- Values are text, finite numbers, booleans or explicit `null`. Types, dates, units and money currencies are validated; no currency/unit conversions are guessed. Formula facts have `value: null` and an unevaluated `expression`, never cached calculated answers.
- Facts and directed relationships support optional `validFrom`, `validTo`, `observedAt`, `polarity` and bounded predicate/value `qualifiers`. Relationships retain kind, label and optional inverse label. Conditions and denied assertions are not flattened into unconditional claims.
- The legacy public `confidence` key means **source-stated certainty**, not model accuracy. The interpreter must omit it unless explicitly supported. Private optional `extractionConfidence` is uncalibrated, never public. Identity scores are labelled deterministic scores, not probabilities.
- Valid time is distinct from source observation time. Import/decision time remains in the private job ledger/history, not substituted for validity. Dates must be real calendar dates or UTC timestamps. A date-only end includes the entire UTC day.

The provider uses strict Zod and JSON Schema: every object property is required on the wire, optionals are nullable, unknown fields fail, and normalization preserves meaningful `value: null`. Local validation additionally enforces references, types, budgets and completeness. This follows [Structured Outputs requirements](https://developers.openai.com/api/docs/guides/structured-outputs#all-fields-must-be-required); wire compatibility is not a live quality result.

The interpretation envelope reuses shared catalog constraints for identifiers, labels, kinds, values, collections, relationships and jobs. Its typed definitions use stricter unions: numeric units are nullable, money requires a supplied uppercase currency, and nonnumeric definitions require null unit/currency. Local graph validation remains authoritative for reference existence, dates, uniqueness, completeness and cumulative limits.

### Model facts compile into the public graph

The model response is an extraction format, not the persisted `CatalogFact` shape. Every generated fact has `id`, `entityId`, optional assertion metadata, and one required `target`:

| Extraction target | Deterministic stored result |
| --- | --- |
| `{field: "name" / "kind" / "summary", value: text-or-null}` | Corresponding entity-field assertion with no inline definition |
| `{scope: "property", definition, value}` | `properties.<definition.id>` with that complete inline definition |
| `{scope: "attribute", definition, value}` | `attributes.<definition.id>` and one registered shared definition; no inline definition on the stored fact |

Each typed target is a strict union coupling definition type and value: text/string, number/number, money/number plus currency, date/ISO text, or boolean/boolean. Every type permits explicit unknown `null`. There is no second generated field identifier to disagree with the definition, and a typed target cannot omit its definition or attach one to an entity-field assertion. Nullable definition metadata is handled explicitly within these unions; `value: null` is never removed. Formula expressions still require null values and valid/observation time remains distinct.

`compileSemanticFacts` registers an explicitly supplied attribute definition if absent, reuses compatible existing definitions, and rejects conflicting types, units or currencies. Existing shared display labels are retained. It never guesses a missing type, currency or relationship. Newly registered dimensions still count toward the existing 24-attribute limit. A fact-backed attribute absent from an entity receives a null slot so existing card/comparison projection can later resolve approved facts; compilation does not prematurely select a fact value. Multiple assertions, conditions, denials, conflicts and provenance retain their identities.

This compiler runs for file interpretation, public-page interpretation and model-assisted corrections through the same provider path. The stored graph remains schema version 1, so publisher review, immutable publication, retrieval and React components need no migration. Ordinary draft edits and deterministic source readers keep the existing public schemas. Filenames, subjects, locations and specific publisher predicates do not select special conversion rules.

For example, a model fact with `target: {scope: "property", definition: {id: "opening-date", label: "Opening date", type: "date", unit: null, currency: null}, value: "2026-10-05"}` compiles to `field: "properties.opening-date"`, the same value and its matching date definition. Metadata such as `validFrom`, `observedAt`, qualifiers and polarity stays on the assertion. This is deterministic structural conversion, not a claim that the source entails the model's interpretation.

Before validation, redundant model aliases matching the canonical name or another alias are removed using the catalog's existing label normalization. Separate citations for the same exact target are combined, preserving every distinct source anchor. This does not merge entities, infer evidence, drop overflow, or relax source validation: unavailable, shortened, ambiguous and excessive citations still fail. These normalizations apply to interpreter output; publisher identity decisions keep their existing validation.

## Evidence and publisher review

Model evidence targets an exact entity field, fact ID or relationship ID with at most eight supplied private source-anchor IDs. Unknown, empty, shortened or mis-scoped anchors fail. **An allowed anchor identifies a location; it does not prove entailment.** Studio says so and displays the excerpts.

Citation targets use a strict union in both the local validator and the generated JSON Schema: `{entityId, field, anchorIds}`, `{factId, anchorIds}`, or `{relationshipId, anchorIds}`. Each branch requires all of its fields and forbids all other keys, including unused null target keys. This nested `anyOf` encodes exclusivity before generation; a Zod `superRefine` alone does not. Property assertions cite their fact ID. Saved provenance still uses the existing separate fields/facts/relationships arrays, so this interpreter-envelope change needs no artifact or publication migration. See [supported nested Structured Outputs unions](https://developers.openai.com/api/docs/guides/structured-outputs#for-anyof-the-nested-schemas-must-each-be-a-valid-json-schema-per-this-subset).

Each new candidate has hash-bound private assertion coverage for fields, aliases/identifiers, catalog description, facts and relationships. Reviews distinguish deterministic source reading, model interpretation, publisher correction, missing values, anchored/unsupported support and pending/approved/rejected decisions. Unsupported pending claims block Apply until explicitly approved or rejected. Apply approves visible anchored proposals; this is a human boundary, not an automatic fact checker.

Direct edits are publisher decisions, not fabricated citations; old excerpts are historical context. Model corrections still require review. Rejected assertions are removed from publication, including mirrored attribute values. Rejected required identity fields require correcting/removing the entity. Aliases/identifiers without supported mappings also require an explicit decision. Originals, prompts, excerpts, assertion review state, origins and correction history never enter public output.

## Identity, replacement and history

Same-source IDs use the original source namespace and stable input ID. Explicit replacement of a renamed file preserves that namespace. `SourceOrigin.entityMap` remembers a consolidated canonical ID across renamed source labels; names do not recover identity. Without a stable input ID, a rename may still appear as a new item plus a missing item.

Automatic cross-source matching requires a **unique** normalized name/type match, identical scoped identifier (`registration`, `isbn`, `gtin` or `publisher-id`), an equal nonempty typed attribute, and no contradictory shared attributes. Model-interpreted identifiers do not authorize automatic matching. CSV record IDs are source-local, not global identity proof. Names, aliases, similarity and document size alone are review-only.

Studio can approve a suggestion, keep entities separate, or add/edit explicit aliases. Rejections persist across imports and cannot become automatic merges. Alias overflow fails, rather than dropping labels. Approval remaps collections, facts, relationships, capabilities, origins and provenance; Apply remaps reviewed media and opening selections, deduplicates associations and removes self-edges. Cumulative `identityRemaps` resolve historical IDs. History snapshots themselves stay immutable. Identity approval preserves the evidentiary status of copied claims; it does not approve unsupported model facts as a side effect.

Three-way replacement compares previous source/current publisher/incoming values. Untouched changes default to incoming, publisher conflicts to keep, missing entities **and assertions** to keep. Changed or overlapping temporal assertions expose saved keep/use-source alternatives. A decision does not replay unrelated old choices; repeated choices have unique history IDs and remain reversible before Apply. Simple mirrored field/fact choices stay aligned. Publisher edits supersede affected suggestions and append before/after history with retained historical anchors.

Candidate revision, claim, draft hash and current-source checks protect edits/Apply. Identical bytes create no duplicate interpretation, including renamed copies. URL jobs reserve before fetching, reject replay before network work and recheck extracted source text at Apply. Removed items do not resurrect unless explicitly restored.

One **Undo** restores the applied knowledge/media/opening draft update together. Visitors change only after another Publish. There is no arbitrary post-publication split editor: discard before Apply, or Undo the relevant draft revision and re-review/reimport. The existing bounded draft-history window applies.

## Formats, completeness and failure behavior

One job shares the existing 60,000-character extraction budget and makes at most one interpretation attempt: no recursive chunk fan-out or paid retry. Free prose and PDF page text are segmented into exact fragments up to 1,600 characters with offset ranges. Shortened deterministic record excerpts cannot support hidden fields. Studio reports extracted character/location counts, shortened excerpts and format limitations. Provider `complete: false`, overflow and unreadable pages/packages fail explicitly. Text completeness is not semantic coverage.

`parseSemanticProviderReply` is shared by the provider path and offline regression tests. Failed imports identify catalog versus source-evidence validation and a fixed reason category, rather than returning only a generic validation message. Raw validator messages, dynamic identifiers, unknown keys and source values are not copied into these diagnostics. Explicit incompleteness explanations and output-budget errors retain their existing meanings. No failed result changes the draft or triggers an automatic retry.

The September 12 local PDF test exposed the old generic error. Its rejected provider response was not retained, so the exact rule that rejected that attempt cannot be recovered. Schema mismatches and rejection of redundant aliases/citations were independently reproduced with synthetic data and corrected; this is not confirmation that the Pacific Northwest PDF now imports successfully. A new manual live attempt is still needed to establish that result.

The subsequent manual attempt reported “a citation must identify exactly one field, fact or relationship.” This confirmed a target-shape violation, although the discarded response cannot establish which keys were populated or missing. The generation schema still allowed all four independently nullable target fields; only the local refinement enforced exclusivity. The strict union above closes that gap. An offline regression reconstructs a validator solely from the JSON Schema sent to the provider and checks all 81 absent/null/populated combinations of target fields, plus unknown keys. It reproduced the old schema accepting mixed targets and passes with only the three complete target forms accepted. This is contract verification; a successful live PDF interpretation remains unverified.

Follow-up validation on September 12: `npm run lint`, `npm run typecheck` and `VOICE_BACKEND=demo VOICE_AI_MODE=demo npm test` passed (286 server tests and 21 rendering tests). The existing local server remained running and `/sign-in` returned HTTP 200. No paid interpretation retry was triggered by these checks.

The next manual attempt exposed a fact-definition mismatch. The former response shape let `field`, inline `definition.id`, definition presence and global attribute declarations disagree. The fact compiler above removes those duplicated decisions instead of adding a PDF-specific repair. The displayed message identifies this failure class but cannot recover the exact discarded assertion. Structural fixes are tested against all five scalar types, both field scopes, conflicts, missing definitions, forbidden inline definitions, nulls, formulas, metadata and cumulative limits.

`tests/semantic-ingestion-formats.test.ts` exercises 25 combinations: five unrelated synthetic subjects (trail, menu item, course, event policy and technical instrument) across PDF, TXT, HTML, DOCX and XLSX. It uses real local source readers and source anchors, hand-authored model-response oracles, the generated JSON Schema, the compiler, model-origin assertion review, simulated publisher approval, public retrieval and existing display projection. Filenames are topic-neutral. These are offline format/contract regressions, not live semantic extraction measurements; they do not prove arbitrary PDFs or model outputs will succeed. No assertions are dropped to make an import pass.

After the fact-compiler change, `npm run lint`, `npm run typecheck` and the demo-mode `npm test` suite passed (315 server tests and 21 rendering tests). The existing live-configured local server remained running and its sign-in route returned HTTP 200. No paid model request was triggered during this fix. Live extraction quality and the user's PDF import still require a new manually initiated interpretation.

| Format | Supported behavior and explicit limits |
| --- | --- |
| TXT / CSV | UTF-8 text, labelled blocks and typed tables; BOM/CRLF, quoted multiline records, physical line/record locations, explicit missing values. 256 KB upload. |
| Text PDF | Local PDF.js, text from every page, page/range anchors, 40 pages and 15-second extraction deadline. Empty/scanned pages specifically report unsupported PDF OCR. No raster OCR, layout or embedded-image interpretation. |
| DOCX | Paragraphs, heading markers, table row/cell context, headers/footers. No image/drawing-layout reading. Nested tables, tracked changes, referenced notes, drawings, dynamic fields, embedded objects/altChunk and XML entity declarations fail explicitly instead of silently dropping their meaning. |
| XLSX | Escaped sheet names, workbook relationships, physical row gaps, exact cells, rich/inline/shared strings, booleans/numbers. Compatible labelled tables across sheets parse deterministically with sheet-namespaced IDs. Missing declared sheets or incompatible schemas fail. At most 2,700 represented cells and 28 allocated columns prevent huge sparse allocations. |
| XLSX formulas / merges | Never evaluated; cached values ignored; formulas cannot supply identity columns. Shared-formula followers without a local expression remain an unknown formula marker. Only a merge's top-left cell supplies its value; the exact merged range stays on the anchor. Conflicting/overlapping merges fail. Date-styled numeric cells require ISO-date text export rather than guessed serial dates/timezones. |
| HTML / website | Excludes script/style/comment content, retains headings/table text and contact text in headers/navigation/footers. Not browser rendering, visibility validation or crawling. One page only. |
| Image OCR | Existing upload pipeline and `OcrProvider`; reads the sanitized display image, not original full-resolution pixels. Fixed-command local Tesseract or explicitly configured HTTP worker. No automatic installation; recognition quality remains review work. |

Office uploads share the existing 2 MB limit. ZIP validates entry/local metadata consistency, CRC32, compression, bounds and safe unique paths; encrypted/multidisk/unsupported packages fail. Caps are 2,000 entries and 12 MB expanded bytes. These bounded readers are not general Office renderers or full XML schema validators; complex layouts should be exported to supported text/tables.

Website safety includes HTTPS/normal port/no credentials, private/literal/special-host rejection, validation of **all DNS addresses**, pinning one public IP for HTTPS, hostname certificate verification/SNI and verification of the actual connected socket address. There are no caller headers, cookies, proxy, redirects or retries. DNS, headers and body share 15 seconds; non-HTML, compressed/encoded responses and more than 2 MB fail. UTF-8 decoding is strict. Transport tests mock DNS and the connected destination without live network requests.

Managed OCR requires HTTPS (or an explicitly configured loopback HTTP worker), one request, 30-second default/60-second maximum deadline, 10 MB input, 250 KB response and strict `{ text, complete: true }` output capped at 60,000 characters. Incomplete, extra-field, oversized and unavailable responses fail. Local Tesseract uses fixed arguments and process/output limits, no retry. Demo mode ignores remote OCR configuration. An adapter is **not a deployed worker**; no service, credentials, installation or deployment configuration was added.

Existing quotas remain 100 entities, 24 shared attributes, 2,000 explicit facts, 200 relationships, 12 aliases/entity, eight qualifiers/assertion, 50 import/review jobs, 500 correction-history entries and 700,000-byte artifacts. Review metadata is bounded/pooled. Limit failures leave the draft unchanged, not a complete-looking partial import.

## Retrieval and legacy projection

The pure `@thevoice/platform-ui/knowledge` export provides `knowledgeQuerySchema`, `retrieveKnowledge`, `projectKnowledgeCatalog`, `selectFactValue`, `knowledgeFacts` and limits. The host's `retrievePublishedKnowledge` reads the full, source-free, currently authorized snapshot **before** applying query time; a current-only legacy relationship projection cannot answer historical queries.

Requests include revision, query/intent, entity/fact/photo IDs, typed filters, optional as-of time and zero to two relationship hops. Deterministic lexical ranking, a small synonym map, typed filtering and graph traversal return at most **12 entities, 40 facts, 20 relationships, 12 assets and 32,000 serialized bytes**, with references, revision identity, typed display strings, conditions, resolution and omitted counts. Relationship labels/kinds participate in retrieval ranking. Conditional or denied neighbors may be included as qualified context, but do not authorize onward traversal. Exact fact queries include all competing assertions in the selected fields and omit unrelated attribute values. Unknown references yield empty unresolved output; stale revisions fail. Oversized context fails with a narrowing instruction. All assertions in a returned field group are evaluated before truncation so hidden alternatives cannot conceal conflict.

Selection uses approved assertions active at the requested time. Different active values or an unconditional affirmation/denial disagreement produce `conflict`, never latest/highest-confidence wins. Conditions/negation yield `qualified`, missing/formula values `unknown`, and no active assertion `out-of-time`. Only an unqualified non-conflicting known value populates a legacy attribute. Unknown numeric values cannot pass numeric filters. Legacy views omit inactive/denied/qualified relationships; full retrieval retains explicit semantics. Attribute-only snapshots get synthetic `legacy-*` fact references stable within their immutable revision.

`catalogPresentationContext` now sends a bounded retrieved subset plus validated focus/selection context through the existing visitor provider path, not raw sources or the full growing graph. `catalogKnowledgeSummary` lets an existing typed reply answer matched singleton properties without a new runtime. Provider reference allowlists and final validation still use the authorized publication. Registered components, actions and shared-package independence remain intact. The packed consumer tests the new pure export.

Visitor planners set `includeBlocks:false` on structured retrieval. This still ranks against full published text and preserves the same fact/qualification resolution, but excludes long prose blocks from the 32,000-byte structured projection and reports their count in `omitted.blocks`. The default retrieval behavior remains unchanged. `lib/visitor-published-content.ts` supplies a separate, bounded public-text projection and shared `read_published_content` tool for chat and voice. It searches published section/entity text and pages an exact publication-scoped reference without fetching private source artifacts or making external requests. See [published text questions](visitor-task-execution.md#answering-questions-from-published-text) for the failure reproduction, limits and verification.

No graph/vector database, ontology framework or retrieval service was warranted: fixture checks exercise the existing 100-entity bound, omissions and deterministic relevance without them. This is not general natural-language understanding. The visitor page and typing/voice routes consume the full authorized snapshot; legacy projections are applied only where unconditional attribute values are needed. The workspace registers `knowledgeFacts` references, including revision-scoped legacy attributes, for individual display and ordinary browsing. See [independent integration evidence](astra-integration-review.md). Maps remain unknown without approved coordinates; address/email values do not become executable actions.

## Exact code and test map

| Responsibility | Actual files / entry points |
| --- | --- |
| Public graph and calendar/type/reference validation | `packages/platform-ui/src/contracts.ts` |
| Pure retrieval, temporal selection, legacy projection | `packages/platform-ui/src/knowledge.ts`; export in `packages/platform-ui/package.json` |
| Publication authorization/retrieval | `lib/knowledge-retrieval.ts`; `getPublishedKnowledgeSnapshot`, `getPublishedKnowledge`, `stagePublicKnowledge` in `lib/knowledge-store.ts` |
| Existing visitor integration and singleton answer | `lib/catalog-presentation.ts`, `lib/visitor-provider.ts` |
| Private anchors, offsets and assertion references | `lib/source-provenance.ts` |
| Extraction, deterministic parsing and segmentation | `lib/source-extractors.ts` |
| ZIP/DOCX/XLSX/HTML readers | `lib/source-adapters.ts` |
| Pinned public website transport | `lib/website-fetch.ts` |
| Local/managed OCR | `lib/ocr.ts` |
| Nullable strict provider schema / byte-bounded body | `lib/strict-json-schema.ts`, `lib/http.ts` |
| Interpretation, corrections, URL jobs, Apply | `lib/ingestion.ts`; owner actions in `app/api/sites/[siteId]/knowledge/route.ts` |
| Assertion review and rejection-safe publication | `lib/knowledge-assertions.ts` |
| Identity, source merge, saved choices, history | `lib/knowledge-model.ts` |
| Media/opening remaps and one Undo | `prepareKnowledgeMedia` in `lib/media-store.ts`; `applyKnowledge` in `lib/ingestion.ts`; existing site command/history stores |
| Studio review, aliases, focus return and history | `components/KnowledgeReview.tsx`, `components/KnowledgeAssertions.tsx` |
| Independent corpus/oracle and consumer examples | `fixtures/semantic-knowledge/`, `tests/knowledge-retrieval.test.ts` |
| Identity/evidence/schema/rejection regressions | `tests/semantic-graph.test.ts` |
| Interpreter contract, typed targets, deterministic fact/definition compilation, citation exclusivity and private-safe failure categories | `tests/semantic-provider.test.ts`; `semanticReplyJsonSchema`, `compileSemanticFacts` and `parseSemanticProviderReply` in `lib/ingestion.ts` |
| Source-format and subject matrix through review, retrieval and legacy display projection | `tests/semantic-ingestion-formats.test.ts` |
| Real local publication/reimport/Undo/time checks | `tests/semantic-lifecycle.test.ts`; existing knowledge review/store/cloud tests |
| Format/safety/locations/budget tests | `tests/source-adapters.test.ts`, `tests/source-provenance.test.ts`; existing extraction/evaluation tests |
| Actual provider path with a mocked model plan | `tests/catalog-presentation.test.ts` |
| Isolated keyboard/mobile/public-private coverage | `tests/browser/semantic-ingestion.spec.ts`, `tests/browser/source-review.spec.ts`; existing platform/media/voice suites |
| Independent packed export | `scripts/verify-platform-package.mjs` |

## Remaining production and quality boundaries

Automated model/OCR/network validation uses mocks or synthetic local fixtures. The manual live PDF failures and their limits are recorded above; automated checks do not establish live success. No external website or managed OCR service was exercised by those checks, and no Firebase deployment or production settings were changed. Parsing/retrieval passes do not establish free-prose entailment, OCR accuracy, semantic recall or production readiness. Scanned PDFs, complex Office layout and date-serial conversion remain explicit unsupported cases. The handoff records commands actually run and what a later workspace must not assume.
