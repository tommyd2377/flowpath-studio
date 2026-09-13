# Assignment 1: strengthen semantic knowledge from ingestion through retrieval

Work in `/Users/thomasdevito/Projects/theVoice` using Astra. Continue the existing semantic-graph implementation and independently review the earlier work before extending it. This is authorization to design, implement, integrate, test, and document the complete scope below now. Earlier research-only or handoff-only stopping points do not apply to this assignment.

Read `docs/astra-implementation-plan/README.md`, `AGENTS.md`, the repository README, `docs/product-philosophy.md`, `docs/architecture.md`, `docs/semantic-graph-architecture.md`, and `docs/source-review.md`. Inspect the actual checkout and existing tests. Follow relevant local Next.js guides before changing Next behavior. Record the dirty baseline and preserve unrelated work. Give a concise implementation plan and proceed.

## Outcome

Supported publisher material should become reusable semantic knowledge that can answer different visitor questions and support different interfaces. A document is not a page template, and the graph must not be limited to facts shared by multiple product cards.

For example, a business's single address, an instructor's affiliation, an event's location, a course prerequisite, a policy exception, and a photo's reviewed association should remain individually addressable facts or relationships. Later, the visitor should be able to ask for a photo and the associated location, or compare two offerings, without reinterpreting the original uploads.

Build on the current graph, storage, provenance, and review machinery. Choose the smallest coherent architecture supported by the evidence. A graph database, vector database, universal ontology, or new provider is not required merely to call this a semantic graph.

## Required implementation

1. **Audit and repair the existing foundation.** Check field/fact/relationship evidence, strict provider schemas, source locations, identity consolidation, temporal conflicts, corrections, revision checks, reimport, deletion, and Undo. Confirm that source IDs existing in an allowlist does not get presented as proof that their text entails a claim. Fix concrete correctness defects, with regression tests. Existing test passes do not settle extraction quality or browser usability.

2. **Define knowledge independently of presentation.** Evolve the current contracts to represent stable entities, typed assertions and relationships, collections, and reviewed media associations. Preserve useful singleton facts, qualifiers, units, currency, missing values, and domain-specific predicates without turning all prose into arbitrary attributes. Distinguish source-stated facts, model interpretations awaiting review, publisher corrections, unknown values, and conflicts. Separate source-stated certainty from extraction confidence; do not invent calibrated confidence numbers. Represent valid time separately from import/observation time where needed. Document how a current display value is selected from approved assertions, including explicit as-of queries and conflicting values.

3. **Make ingestion produce grounded candidate knowledge.** Preserve the stages of source extraction, anchored fragments, model/deterministic interpretation, validation, and review. Update prompts, response schemas, parsing, validators, correction UI, and persistence together. Each interpreted assertion should either retain usable source support or have an explicit unsupported/review state. A publisher-authored correction is a publisher decision, not fabricated source evidence. Preserve meaningful relationships and link media only through supported metadata or publisher review; visual resemblance alone is not identity.

4. **Finish reliable format handling within declared bounds.** Cover text, CSV, text PDFs, DOCX, XLSX, HTML/website import, and image OCR through the existing adapters. Preserve document hierarchy and table/cell context when it affects meaning, including exact workbook row/cell locations, merged cells, and formulas as unevaluated source expressions. Test binary/package limits and malformed inputs. Audit website fetches beyond literal private-IP checks, including DNS resolution, connection destination, redirects, timeouts, content limits, and credential isolation; fix exploitable gaps without live network tests. For scanned PDFs, either wire a bounded OCR path through the existing provider abstraction or return a specific unsupported result; do not call an empty text extraction a successful import. An HTTP OCR adapter is not a deployed OCR service. Make unavailable runtime and incomplete extraction explicit in Studio.

5. **Handle larger sources honestly.** Use bounded, source-addressable segmentation where it improves supported coverage. Keep a shared job budget and completeness accounting; no recursive retries or unbounded fan-out. If a source exceeds supported limits, report the omitted pages/sections or fail clearly rather than silently publishing a complete-looking partial graph. Keep deterministic ingestion and mocked interpretation useful without paid services. Do not silently raise current quotas or resource limits.

6. **Consolidate identities conservatively across sources.** Preserve stable IDs and reversible aliases/remaps over reimports and corrections. Use reliable identifiers and corroborating attributes for automatic matches. A matching name/type or a larger document alone must not establish identity. Ambiguous or contradictory candidates need a useful publisher decision, and rejected matches must not reappear as automatic merges. Apply consolidation consistently to facts, relations, collections, media associations, opening selections, private provenance, and retained history. Preserve publisher edits during replacement; test removals, splits/unmerge or the documented reversal path, and Undo.

7. **Deliver a real retrieval and projection boundary.** Implement a bounded, publication-scoped API/helper that the visitor planner can call with an intent/query and optional referenced entity/fact IDs or time context. Retrieve useful entities, individual facts, relationships, and approved media context, with limits on expansion and clear unresolved/ambiguous outcomes. Start with deterministic indexing, typed filters, lexical matching, and graph traversal where sufficient; document measured reasons before adding infrastructure. Do not send every raw source or the full growing graph on every turn. Results must include stable references, revision identity, display-ready typed values and relevant qualifications. Private excerpts, uploads, model prompts, correction history, and unpublished assertions must not enter public output. Wire this boundary into the existing visitor provider path where compatible, so it is exercised rather than an unused utility. Keep legacy catalog consumers working through explicit projections/adapters.

8. **Preserve publication and capability authority.** Proposal → review → Apply → Publish remains intact. Add compatibility/defaulting or a versioned migration for existing saved catalogs and published snapshots; never mutate old publications in place. Validate all references at the publication used by the request. Imported text must not create live inventory, bookable capacity, executable actions, payment ability, or arbitrary URLs. Public capabilities remain separately registered. New graph/UI contracts must preserve the shared package's independence from Next.js, Firebase, and credentials.

## Starting code map

- Extraction and evidence: `lib/file-validation.ts`, `lib/source-extractors.ts`, `lib/source-adapters.ts`, `lib/ocr.ts`, `lib/source-provenance.ts`.
- Interpretation and review: `lib/ingestion.ts`, `lib/knowledge-model.ts`, `lib/knowledge-store.ts`, `app/api/sites/[siteId]/knowledge/route.ts`, `components/KnowledgeReview.tsx`.
- Draft/publication: `lib/site-model.ts`, `lib/site-commands.ts`, existing local/cloud stores and public projection routes.
- Shared data and current planning: `packages/platform-ui/src/contracts.ts`, `lib/catalog-presentation.ts`, `lib/visitor-provider.ts`.
- Verification: `tests/semantic-graph.test.ts`, `tests/source-adapters.test.ts`, `tests/source-provenance.test.ts`, `tests/knowledge-evaluations.test.ts`, the knowledge/review/store suites, and `tests/browser/semantic-ingestion.spec.ts`.

These are starting points, not a prescribed new file layout. Name new contracts to match the repository and document actual code locations after implementation.

## Acceptance and evaluation

Build a small synthetic, cross-format corpus covering at least a business with contact/location information, a class/event publisher, and an item collection with photos. Include overlapping sources, same-name distinct entities, aliases, conflicting dates/prices, negation or policy exceptions, unsupported claims, missing values, malicious document instructions, and repeated imports. Expected facts and answers should be written independently of the implementation.

Verify exact source locations, assertion coverage, false merges, relation direction, conflict handling, temporal selection, public/private separation, idempotency, review/apply/publish, Undo, and retrieval relevance. Have multiple questions use the same approved graph in different ways. Separate parser/retrieval results using fixtures from semantic interpretation quality using a live model; mocked outputs cannot establish real model accuracy.

Run the relevant focused checks, then `npm run check` under Node 24 and the relevant isolated browser coverage using the repository's browser runner. Complete the previously unfinished ingestion browser checks if the environment permits. If local binding or another tool is blocked, report the exact unrun check and the command to reproduce it; do not claim browser verification. Do not make live paid calls or use private files.

## Documentation and handoff

Update `docs/semantic-graph-architecture.md` and relevant architecture/source-review docs with decisions, alternatives considered, implemented data flow, schemas, ID/identity policy, evidence/confidence/time semantics, compatibility, limits, failure behavior, and exact code/test map. Fix outdated claims in the README if this work changes them.

Create `docs/semantic-workspace-handoff.md` with the actual graph-to-presentation API, versioning, three executable fixture examples, validation rules, public data boundary, unresolved limitations, and acceptance evidence. Assignment 2 must be able to consume this without reverse-engineering your task history. Explain how the address/email/photo/map example is supported at the knowledge layer, including when a map location is unknown.

End with a concise account of implemented behavior, checks actually run, and remaining live-service or quality verification. Continue until the local implementation and handoff are complete; do not stop after writing the architecture.
