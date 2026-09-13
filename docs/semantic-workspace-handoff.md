# Semantic knowledge → workspace handoff

Assignment 1 implementation, 2026-09-12. This is a local, uncommitted handoff on the existing checkout, not a deployment or live-model evaluation. The [semantic architecture](semantic-graph-architecture.md) contains the decisions, failure modes and exact code/test map. Assignment 2 should consume this boundary, not reinterpret private uploads or fork ingestion.

## Independent integration review

Assignment 3 independently reran the combined implementation and fixed the structured-attribute/workspace disconnect, public relationship loss, relationship-query ranking, map ambiguity, clipped-child context, DOCX completeness and oversized-detail handling. See [the integration report](astra-integration-review.md) for current evidence and the final requirement ledger. The original assignment evidence below is retained as history.

Fresh verification: `npm run check` passed with **278 server + 21 rendering tests**, packed-consumer verification and production build; the complete isolated browser suite passed **94 tests**. Scoped fixes also cover deictic collection references, current-period labels and phone typing while focused. Ready for hands-on local evaluation; real model/audio quality and production use remain unverified.

## Actual consumer API

The portable `@thevoice/platform-ui/knowledge` export is pure TypeScript/ESM, with no Next.js, Firebase, host aliases, network access or credentials:

```ts
import {
  knowledgeFacts, retrieveKnowledge, projectKnowledgeCatalog, knowledgeQuerySchema,
  KNOWLEDGE_LIMITS, type KnowledgeQuery,
} from '@thevoice/platform-ui/knowledge';

// Only pass an already authorized, source-free, approved snapshot here.
const request: KnowledgeQuery = knowledgeQuerySchema.parse({
  revisionId: publishedCatalog.id,
  query: 'Where is this class held?',
  intent: 'answer',
  entityIds: ['clay'],
  asOf: '2026-09-12',
  expansion: 1,
});
const context = retrieveKnowledge(publishedCatalog, request, publishedMedia);
const legacyCatalog = projectKnowledgeCatalog(publishedCatalog, request.asOf);
```

These names are actual exports; `publishedCatalog`/`publishedMedia` above are host-supplied authorized values, not browser-supplied artifacts. The server integration is `retrievePublishedKnowledge(siteId, query, mediaRevisionId?)` in `lib/knowledge-retrieval.ts`. It authorizes both revisions against their current publication stores. It reads `getPublishedKnowledgeSnapshot`, not a current-time relationship projection, before applying an as-of query. Do not expose private `KnowledgeArtifact` to a consumer. No new public HTTP route is required by this slice.

Request fields:

| Field | Contract |
| --- | --- |
| `revisionId` | Required current knowledge snapshot ID; wrong revision fails. |
| `query`, `intent` | Optional text up to 2,000 characters; intent is `discover`, `answer`, `compare`, `photos` or `relationships`. Deterministic lexical retrieval, not a general language interpreter. |
| `entityIds`, `factIds`, `assetIds` | Optional exact references, at most 12/40/12. Unknown IDs yield empty `unresolved` output; they never grant access to another publication. |
| `filters` | At most 24 existing typed catalog filters; numeric unknowns/conflicts do not pass numeric filters. |
| `asOf` | Optional actual ISO calendar date or UTC timestamp. Default is the current UTC instant. Import time is not validity. |
| `expansion` | Zero, one (default), or two relationship hops, always within the entity cap. Denied/conditional edges do not imply unconditional traversal. |

Result fields are `schemaVersion: 1`, `revisionId`, `asOf`, `status`, `reason`, `entities`, `facts`, `values`, `relationships`, optional `media`, `limits` and `omitted`. Status is `resolved`, `ambiguous` or `unresolved`; resolved is not a truth/entailment guarantee. Each selected value has `entityId`, `field`, `status`, `value`, active `factIds` and a display string. Returned facts also expose `active` and typed display strings, retaining qualifiers, polarity and validity. Relationships preserve their original direction. Reviewed media includes its revision, selected assets and explicit associations.

Hard result bounds are 12 entities, 40 facts, 20 relationships, 12 assets, two hops and 32,000 serialized bytes. Omitted counts are explicit, not evidence of absence. Conflict selection evaluates all assertions for a returned field before bounding the returned fact list; `values[].factIds` may therefore reference approved alternatives omitted from that list. Narrow or issue another bounded query to inspect them. Oversized payloads fail with a narrowing instruction instead of silently dropping qualifications. A narrowed follow-up must keep the publication revision.

## Versioning and display rules

`KnowledgeCatalog.schemaVersion` remains 1 with additive optional fields. Existing catalogs without facts/reviews keep their prior compatibility behavior. Publications are immutable; projections clone them. Stable entity IDs use source namespaces/input IDs and retained canonical remaps. Explicit source fact/relationship IDs are namespaced deterministically. Attribute-only legacy facts receive collision-safe `legacy-*` references stable **within their revision**; do not reuse such references across publication IDs.

`properties.*` facts are independent typed assertions with a matching inline `definition`. They do not have to appear as comparison attributes. Unknown is `null`, not false/zero/empty invented text. `false` is a real boolean assertion. Money requires an explicit currency; units and qualifiers remain attached. Formula expressions stay unevaluated and unknown unless a publisher explicitly supplies a correction.

Current/as-of projection does not select “latest import” or “highest confidence.” One active, unqualified, non-conflicting value is `known`. Different active values or affirmative/negative disagreement are `conflict`; conditions/negation yield `qualified`; absent/formula values are `unknown`; no active assertion is `out-of-time`. Display conditions rather than flattening them. Date-only validity endpoints include that UTC day. Public `confidence` means source-stated certainty; private model extraction scores are not public probabilities.

The current visitor page, typing route and voice-session route load `getPublishedKnowledgeSnapshot`, preserving all approved relationships for query-time interpretation. `knowledgeFacts(catalog)` gives retrieval and the workspace the same revision-scoped references for attribute-only imports. Exact `factIds` queries retain all competing assertions for the selected fields and omit unrelated attribute values, so a single fact remains usable when a whole detail exceeds the context budget. Existing visitors exercise `retrieveKnowledge` through workspace instructions and the compatible `catalogPresentationContext` provider path. `catalogKnowledgeSummary` returns matched singleton property values in the existing text answer after a valid plan. Legacy cards continue using `projectKnowledgeCatalog`. The adaptive workspace now renders these fact references individually; legacy catalog projection remains available. The shared GPT-Live transport core remains unchanged.

## Three executable fixture examples

The independently specified oracle is `fixtures/semantic-knowledge/expected.json`. `graph.ts` is synthetic publisher-reviewed knowledge, not output claimed to have been extracted by a live model. `business.txt`, `classes.csv`, `items.csv` and `prose.txt` provide overlapping source/negation/unknown/malicious-instruction fixtures; binary Office/PDF/image fixtures are built deterministically in tests.

From the repository root under Node 24, first run `npm run build:platform`. Each command below executes its named fixture example with real assertions. These same tests run in `npm test`.

### 1. One business, separate address/email/map questions

```sh
node --conditions=react-server --import tsx --test --test-name-pattern='handoff example 1:' tests/knowledge-retrieval.test.ts
```

The test calls `retrieveKnowledge(semanticFixture, { revisionId: semanticFixture.id, entityIds: ['harbor'], query: 'address', asOf: '2026-09-12', expansion: 0 })`, then asks independently for email, then references `factIds: ['latitude', 'longitude']`.

Expected: address `12 Example Lane, Brooklyn, NY`; email `hello@harbor.example`; latitude/longitude `null` and `unknown`. All three questions reuse one approved graph. The address is not geocoded automatically. A map UI must say location/coordinates are not provided, not invent a pin or call a geocoder. Email/address strings are knowledge, not executable capability URLs.

### 2. Compare classes at a date, preserving policy exceptions

```sh
node --conditions=react-server --import tsx --test --test-name-pattern='handoff example 2:' tests/knowledge-retrieval.test.ts
```

The test requests `entityIds: ['clay', 'summer'], query: 'price'` first as of `2026-09-12`, then `2026-10-15`. Clay Basics is USD 45 through September 30 and USD 50 from October 1. Summer Workshop price stays unknown. A typed maximum-price filter excludes unknown and above-limit offerings.

The same result preserves `requires-own-kiln: false` and a children-attendance condition requiring adult accompaniment. It does not turn that condition into unconditional permission or claim bookable capacity. Separate conflict regressions add an overlapping USD 55 assertion and require `ambiguous`/`conflict` with no numeric card value.

### 3. A reviewed photo, its subject and the associated location

```sh
node --conditions=react-server --import tsx --test --test-name-pattern='handoff example 3:' tests/knowledge-retrieval.test.ts
```

The test passes `intent: 'photos', assetIds: ['blue-photo'], expansion: 1` plus `semanticMediaFixture`. The exact reviewed association identifies Blue Bowl; its directed `displayed-at` edge reaches Harbor Studio and its address. White Bowl is not returned as an identity lookalike. A second query for Mira verifies person → business affiliation direction using the same graph. A map remains unknown for the same reason as example 1.

## Publication and validation rules for Assignment 2

- Pure retrieval assumes the host already authorized its input. Server entry points must validate the current knowledge/media publication before reading it. Never use a candidate, owner-only revision or private provenance as a public retrieval source.
- Keep proposal → publisher correction/review → Apply → Publish. Unsupported pending assertions block Apply. Exact anchors are location allowlists, not entailment checks. Direct publisher edits are decisions; identity approval must not implicitly approve copied unsupported model claims.
- Keep references bound to `revisionId`; final `PresentationPlan` validation and registered component/variant/capability routing remain required. Retrieval results do not authorize arbitrary HTML, CSS, URLs or actions.
- Public output may contain approved facts, typed values, qualifiers, dates, relationships and reviewed media. It must not contain raw sources, filenames, anchors, hashes, baselines, prompts, correction history, identity review explanations or private extraction scores. Synthetic tests explicitly check these boundaries and unapplied/rejected values.
- Preserve reviewed photo associations and example labels. Similar appearance is not identity. Imported facts cannot enable payments, inventory or bookings.
- Identity/source edits remain revision-checked and immutable. Undo affects the draft; republish to change visitors. A merge reversal uses discard/Undo and re-review within the existing history window, not silent historical rewriting.

## Original assignment 1 evidence and reproduction (historical)

Validation uses Node 24, isolated local data and existing test harnesses. No paid or live network/provider call was authorized or performed.

| Check | Evidence |
| --- | --- |
| Focused extraction/evidence/retrieval/provider/lifecycle suites | Passed, including the three executable examples, exact cell/page/line anchors, unknowns, temporal conflicts, same-name separation, replay, rejection-safe projection and actual mocked visitor answer. |
| Identity review preservation and source-choice regression suites | Passed: identity decisions do not approve unsupported copied claims; Undo restores media/opening alongside knowledge. |
| Final isolated ingestion browsers | 4 passed against the final build: real local PDF/DOCX/XLSX/HTML upload/parse, OCR failure, mocked URL handoff/private URL rejection, keyboard focus return, aliases, singleton rejection, replacement/photo preservation and public/private boundaries. |
| Full repository checks | `npm run check` passed: lint, typecheck, 253 server tests, 21 rendering tests, packed independent consumer (including `/knowledge`) and production build. |
| Full browser runner | Not green. Initial core-group run: 12 passed, 12 failed, 11 skipped; runner stopped before later groups. Failures include current focus/reveal/preview behavior and shared test-data exhaustion, detailed below. |
| Separate voice browser regressions | 26 passed, 7 failed across `visitor-quality.spec.ts` and `visitor-realtime.spec.ts`; all sessions mocked. No live voice quality claim. |

Reproduction commands:

```sh
npm run typecheck
node --conditions=react-server --import tsx --test tests/semantic-graph.test.ts tests/source-adapters.test.ts tests/source-provenance.test.ts tests/knowledge-retrieval.test.ts tests/semantic-lifecycle.test.ts tests/catalog-presentation.test.ts
npm run check
npm run test:browser
```

The final focused browser pass used:

```sh
npm run test:browser -- tests/browser/semantic-ingestion.spec.ts tests/browser/source-review.spec.ts tests/browser/platform.spec.ts --grep 'DOCX/XLSX|publisher identity decisions|source excerpts and explicit replacement|production server extracts a real' --output=test-results/platform/semantic-final
```

`git diff --check` and the browser-runner syntax check also passed. The final port check found no listener on 3225. A SHA-256 comparison of the captured 290-file baseline found changes only in the scoped knowledge/adapter/retrieval/review/test/documentation files; unrelated existing runtime and branding changes were preserved. New semantic files and fixtures remain uncommitted alongside that existing work.

The browser runner needs a production build (included in `check`), installed Playwright Chromium and permission to bind `127.0.0.1:3225`. The sandbox initially rejected binding with `EPERM`; the same runner succeeded with scoped execution approval. It uses fresh synthetic contexts, not personal signed-in browser profiles. Each group starts its own server and temporary data directory; Playwright stops its server, and local test artifacts remain available for review. Browser URL import is a mocked UI handoff; the real URL job/store flow is independently tested using a mocked DNS/connection transport, including replay and changed source at Apply. This is not a live website test.

### Requirement ledger

| Assignment 1 requirement | Implementation | Verification / remaining boundary |
| --- | --- | --- |
| Audit evidence, revisions, replacement/deletion and Undo | `knowledge-model`, `knowledge-store`, `ingestion`, private assertion reviews | Source update/review/store/cloud/lifecycle regressions passed offline. No actual Firebase deployment exercised. |
| Presentation-independent knowledge | Shared contracts and `/knowledge` | Independent business/class/item oracle, units/currency, null/false, time, qualifiers and direction tests passed. No universal ontology or calibrated model confidence claimed. |
| Grounded proposals and corrections | Strict schema adapter, provenance validator, `KnowledgeAssertions` | Forged/truncated anchors rejected, unsupported claims gated, publisher decisions distinguished, identity remaps preserve review status. Live entailment remains unmeasured. |
| Reliable declared formats and SSRF/OCR bounds | Source adapters/extractors, pinned website transport, `OcrProvider` | Real synthetic parsers; mocked DNS, socket address, deadline, redirect, size and OCR completeness checks. Complex Office/scanned PDF and real OCR quality remain limited. |
| Honest larger-source behavior | Shared extraction budget, exact bounded fragments, complete/failed job status | Long-source, wide-table, byte/package/cell and artifact-limit tests pass. No larger quota, durable worker or fan-out. |
| Conservative identities and reversible remaps | `entityMap`, `identityRemaps`, publisher identity UI, media/opening Apply | Same-name false-merge, identifiers, aliases, rejection/reimport, historical IDs, media/opening and Undo tests pass. Reversal is discard/Undo/re-review, not a general split editor. |
| Real retrieval/projection boundary | Shared `/knowledge`, server authorized helper, actual visitor provider context | Three executable examples, 100-entity bounds, temporal/publication rejection, packed consumer and mocked singleton answer pass. General-language/time parsing and broader workspace rendering belong to later work. |
| Publication and capability authority | Assertion-gated staging, current-publication stores, existing reference validators | Unapplied/rejected/private data excluded in unit and focused browser tests. No new capability authority or platform runtime rewrite. |

### Historical browser failures from assignment 1

The assignment 1 full browser result was **not** a pass. Subsequent integration runs independently passed the existing suite; see [current results](astra-integration-review.md). These earlier failures remain historical evidence:

- `media-runtime.spec.ts:92`: both class/bookstore mobile photo positions missed the expected viewport range.
- `media.spec.ts:109`: the preview gallery selector matched two rendered gallery instances.
- `platform.spec.ts:96`, `shared-reveal.spec.ts:194`, `motion.spec.ts:228`: the focus-stage scrim intercepted toolbar Back clicks.
- Other motion/shared-reveal checks failed expected scrolling/settled-state assertions. Serial follow-on tests were skipped.
- The original combined core group exhausted the unchanged **12-site** local cap, causing source-review and additional fixtures to fail before exercising their behavior. `scripts/test-browser.mjs` now isolates ingestion in its own fresh-data group; no production quota was raised. The focused source-review flow passes. The full combined runtime group was not rerun after this grouping-only adjustment.
- The separate voice run passed 26 cases but failed seven: invitation width checks at 390/1600px, mobile dock scrolling, microphone-denial typing fallback, pending-chat manual browsing, spotlight/reading/comparison, and page-navigation scroll acknowledgment. Several expect content already mounted while the current intro-only opening is dormant.

Artifacts are under `test-results/platform/core/` and `test-results/platform/semantic-voice/`. The relevant existing runtime files match this task's dirty-baseline hashes; their focus/geometry behavior was not rewritten. That does not prove failure causality against a clean baseline, which was not restored or rerun. These are explicit integration limitations to investigate in the workspace assignment. Search and billing browser groups were not reached by the stopped full runner and were not separately run here; their offline server tests passed in `check`.

Reproduce the related voice result separately with `npm run test:browser -- tests/browser/visitor-realtime.spec.ts tests/browser/visitor-quality.spec.ts`. Run an individual core spec to avoid conflating fixture-site exhaustion with its actual UI failure. Do not remove pointer/focus assertions or increase site quotas simply to obtain a green result.

## Remaining limitations

- Strict schemas and fixture expectations do not establish live semantic entailment, recall, negation accuracy or model confidence calibration. Free prose still requires a separately configured/authorized interpreter; there are no paid retries or new provider calls here.
- HTTP OCR is an adapter contract, not an installed/deployed service. Local Tesseract availability/languages and actual recognition quality are deployment concerns. OCR currently receives the sanitized display image, so small original text may be lost. No successful real OCR quality evaluation is claimed; failure and injected results are tested.
- Scanned PDFs explicitly require another supported source; embedded image reading, complex Office layout, general XML validation and XLSX serial-date conversion are not implemented. Formulas are never executed. Source text and graph completeness remain different claims.
- Extraction and storage quotas are unchanged; over-limit imports fail. There is no durable background ingestion worker, unbounded fan-out, vector service or graph database.
- Lexical retrieval is bounded and deterministic, with a small synonym map, not universal language understanding or automatic question-to-time parsing. Callers supply explicit `asOf`; keep omitted/ambiguous/qualified results visible. Broader retrieval/semantic quality and production load still need evaluation.
- No credentials, auth, billing, production configuration, deployment settings or platform-ui runtime were changed for this assignment. Existing concurrent work remains in the checkout. Nothing was committed or deployed.
