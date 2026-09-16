# FlowPath visitor task system: architecture

Design date: 2026-09-13. Status: chosen architecture; M0–M6 now have a local implementation. See the [implementation and evidence report](implementation-report.md) for the actual code map, migration, measured limits, technical adjustments and live authorization boundary. Read with [implementation plan](implementation-plan.md) and [implementation prompt](codex-prompt.md).

The [whole-website filtering implementation](whole-website-filtering.md) supersedes the detached collection-surface design below. It documents the authoritative confirmed visitor view, integrated native renderer, Home/Back/reset semantics and current verification.

## 1. Decision and product contract

Extend the existing website assistant into a general task system. Keep fast navigation, the semantic graph, controlled React components and Motion. Add hierarchical publication spaces, a first-class query layer and reusable capability execution beneath voice, chat and direct manipulation.

A publisher supplies reviewed knowledge, a browsable hierarchy, identity, presentation preferences and explicitly enabled capabilities. A visitor supplies a goal and constraints. The platform maintains their choices, retrieves evidence, executes permitted steps and composes useful surfaces. The model interprets meaning and proposes steps; deterministic code owns query truth, arithmetic, permissions, state changes and completion evidence.

Generalizable means new domains can contribute field definitions, relationship meanings, data adapters, actions and registered components without changing the executor. It does not mean every imaginable business operation works without an integration. Unknown capabilities are unavailable, and unsupported queries return a reason instead of invented results.

Filtering is central: “outdoors, at least 50 people, under $3,000” becomes persistent, visible criteria, not a one-off text answer. “Include indoors too” changes only that criterion. A later comparison, map, brief or cart uses the resulting selection.

Simple navigation remains a direct semantic command when the target is unambiguous. Compound requests must reach the task system intact; a phrase detector must never consume the first verb and discard the rest.

## 2. Current implementation and gaps

The following are source observations, not a new comprehensive test report.

| Existing code | What exists | Design implication |
| --- | --- | --- |
| ../../lib/visitor-task-runner.ts | Shared chat/voice loop, dynamic instructions, at most four tool executions plus final response, cancellation, no automatic paid retries | Extend this executor; do not introduce a second general agent framework |
| ../../lib/visitor-chat-task.ts and ../../lib/visitor-realtime-control.ts | Separate transport adapters using shared validators/search and browser acknowledgments | Extract reusable handlers and a task context; keep audio transport separate |
| ../../packages/platform-ui/src/catalog.ts | Typed attribute predicates combined with AND, null handling, client-side filtering | Add a versioned query model supporting scoped Boolean expressions and patches |
| ../../packages/platform-ui/src/workspace.ts | Twelve surfaces, atomic batches, revision checks, per-object filters, focus/return and measured scene references | Preserve these invariants; a surface can represent thousands of results without thousands of workspace objects |
| ../../packages/platform-ui/src/contracts.ts | Catalog v1: 100 entities, 24 attributes, 24 collections, 200 relationships; scalar fields; capability kind is link only | Large catalogs, typed lists and executable actions require explicit new contracts and migration |
| ../../packages/platform-ui/src/knowledge.ts | Bounded lexical/graph retrieval, time-aware assertions and published references | Build query evaluation on the assertion projection, not raw summaries or only legacy attributes |
| ../../lib/knowledge-store.ts | Reviewed artifacts, separately staged immutable public projection, current-publication authorization; cloud projection is presently one document | Introduce bounded publication manifests/chunks for scale; never just increase a JSON array limit |
| ../../components/VisitorWorkspace.tsx, ../../lib/workspace-screen.ts | Shared visible objects, actual scene capture, ordinary browsing | Integrate query-backed collections into both browse and assistant modes |
| ../../lib/explore-service.ts | Publisher-enabled external results, quotas and temporary evidence | Keep external evidence distinct from publisher facts even when presented together |
| ../../lib/visitor-model.ts | Publisher assistant purpose | Extend purpose with reviewed task/field settings; purpose text is never permission |

The earlier address-to-map chat succeeded live, as recorded in [task execution notes](../visitor-task-execution.md). It establishes one working sequence. It does not prove arbitrary composition, exact address geocoding, microphone quality, large-catalog support or commerce readiness.

## 3. Components and ownership

~~~mermaid
flowchart TD
  A[Reviewed publisher sources] --> B[Immutable publication and schema registry]
  B --> C[Query repository and evidence projection]
  U[Voice / chat / clicks] --> I[Intent or explicit command]
  I --> T[Task service and session state]
  T --> Q[Query / selection capabilities]
  Q --> C
  T --> K[Registered business and search capabilities]
  K --> X[Configured adapters]
  C --> E[Typed result and evidence handles]
  X --> E
  E --> T
  T --> P[Validated presentation operations]
  P --> V[React surfaces and Motion]
  V --> S[Scene and applied acknowledgments]
  S --> T
  T --> R[Completion receipts or clarification]
~~~

| Layer | Owns | Must not own |
| --- | --- | --- |
| Pure shared contracts | Field/query types, reducers, result references, UI operation validation | Credentials, database clients, vendor APIs |
| Publication/query service | Authorized schema discovery, projections, filtering, ranking, facets, result sets | Draft/private-source access for visitors |
| Session/task service | Current choices, dependencies, budgets, action receipts, evidence handles | Inferring successful side effects from prose |
| Capability registry | Versioned action schemas, preconditions, adapter binding, result semantics | Arbitrary model-generated endpoints or executable code |
| Transport adapters | Typed text/voice events, interruption, browser acknowledgments | Different filtering or business rules by modality |
| Shared UI | Registered surfaces, state rendering, accessible controls and animation | Deciding business facts, prices or authorization |
| Publisher Studio | Field review, synonyms, enabled actions, purpose, presentation and test preview | Creating live capabilities merely by uploading a PDF |

## 4. Canonical state: separate meaning from the screen

Use one session context with separate, versioned records. Do not replace workspace state with one enormous conversation transcript.

- PublicationRef: server-derived tenant/site and current content, knowledge, media and query-index revisions.
- VisitorSession: opaque session handle, expiration and task/query references. Anonymous is sufficient for browsing; private resources require a separately authorized visitor identity.
- TaskState: taskId, revision, requested outcome, bounded step records, pending clarification/confirmation, receipts, status and budget consumption.
- QueryState: queryId, revision, scope, typed expression, preferences, sort, asOf/time zone, page/cursor and evaluation state.
- ResultSet: immutable query revision plus stable ordered references, count/coverage metadata, evidence and cursor handles.
- SelectionState: explicit selected references plus the result set they came from. A shortlist survives view changes; removed/unavailable members are labeled, not silently substituted.
- WorkspaceState: existing surfaces, focus/return, per-surface query/result references and presentation state.
- SceneState: browser-observed visible order, item labels, focus, loading and view revision. It is evidence of display only.
- ActionDraft/Receipt: server-owned quote/cart/booking/brief draft and authoritative adapter outcomes, independent of whether its surface is open.

The task service assigns revisions. Models propose operations against known revisions; clients cannot grant access through claimed site IDs or external evidence. Each request reloads/revalidates the publication and effective capabilities.

A query belongs to a collection or dataset scope, not globally to every surface. “Make it cheaper” targets the active query or an explicitly named comparison. If two queries are equally plausible, ask which one. Changing to an unrelated collection preserves the first query separately and does not transfer incompatible fields.

Home aborts pending work and returns to the publisher's opening view. It does not empty a cart or delete an explicitly saved brief. Unsaved browsing queries can be retained in bounded session history for Back/Undo but are inactive at Home; full reset is a distinct action. Undo affects reversible local/query changes, not an already committed external transaction.

## 4A. Hierarchical collections over a shared semantic graph

The visitor should not face one flat list of everything extracted. Adopt a browsable hierarchy above canonical records, with semantic relationships crossing its branches. Firestore's collections/documents are a useful analogy for navigation; its physical storage hierarchy is not the public content model.

### Content concepts

| Concept | Meaning | Example |
| --- | --- | --- |
| Publication space | A publisher's current approved root and schema/index revisions | Hudson Valley Guide |
| Collection | Named, queryable scope, optionally with child collections | Places / Counties / Dutchess |
| Record | Canonical item with typed fields, relationships and composable content blocks | One museum, article, service, photo or event |
| Membership | A reference placing a record in a collection; facts remain on the record | Museum in Dutchess and Family Activities |
| Collection edge | Approved parent/child navigation relationship, separate from a semantic edge | Places contains Counties |
| Record relationship | Typed meaning between records | Article mentions museum; event held at museum |
| Source fragment | Private extraction/provenance unit, not automatically a visitor record | PDF page or spreadsheet row |

One underlying record may have several memberships and appear in multiple views. Ordinary overlap is not duplication. Identity merging remains a reviewed, source-backed operation; similar names alone do not collapse entities. Website URL paths and uploaded folder names may suggest organization but never establish identity or access rights.

Collection definitions distinguish:
- Explicit collections: publisher-approved membership references.
- Derived collections: a saved, validated query over a declared upstream scope, with membership materialized against the immutable publication/asOf projection. Key caches by that asOf projection; time-sensitive memberships cannot be reused for a different evaluation time.
- Navigation groups: organize child collections without requiring a grid of records.

The collection graph is a directed acyclic graph with a single site root. Cross-listing child collections is permitted, but each breadcrumb is the actual chosen path, not an arbitrary parent. Validate all edges, cycle freedom, reachability and same-publication references. Derived-collection scope dependencies must also be acyclic; reject a definition that directly or indirectly queries itself. Initial safety bounds: depth 8 and 1,000 collection nodes per v2 publication; larger limits need measured evidence, not infinite recursion. The knowledge graph itself can contain cycles and remains distinct from this navigation graph.

A record can own named detail blocks and relationships to other records; children do not have to be embedded document blobs. An article's paragraphs and images belong to its content blocks, while a referenced restaurant should be a canonical linked record. This avoids creating a card for every extracted sentence.

### Visitor behavior and filtering scope

Display a collection landing page with child collections, editorial introductions and relevant direct members. A leaf collection presents queryable records. A mixed collection can show both. Opening the root produces a designed website hierarchy rather than a grid containing every source artifact.

The default when a visitor selects a collection is to search that collection and its descendants; show “Including subcollections.” A direct-only toggle is available. Deduplicate canonical IDs when multiple paths reach the same record. Global “search everything” is explicit. Cross-collection queries are validated unions and keep category/source labels.

Show applicable facets for the current record types and field coverage. A parent containing photos, services and articles must not pretend every record has one comparable price/date. It can show type/topic facets and ask the visitor to narrow scope, or present grouped results. Cross-type comparison requires a reviewed semantic mapping (including unit and basis), not identical field labels.

Criteria are scoped to a query view. Going down to a child preserves compatible criteria and marks inherited ones visibly. Clicking a parent breadcrumb explicitly broadens scope while preserving compatible criteria; merely closing a detail does not broaden scope. Show which constraints continue to apply. Changing to an unrelated branch creates a new query or explicitly maps compatible criteria and reports removed ones. Publisher field defaults may inherit along one selected navigation path, but conflicting multi-parent defaults require resolution. Security permissions never inherit from this navigation tree.

Examples:
- Media: Publication -> Topics -> Food -> Restaurant reviews; articles link to people, places and images.
- Freelancer: Portfolio -> Service -> Project; each project links to deliverables, industry and approved outcomes.
- Commerce: Shop -> Category -> Subcategory; canonical products link to explicit variants and compatibility records.
- Travel: Region -> County -> Attractions; a place also belongs to Family Friendly without duplicating its address.
- Education: Courses -> Subject -> Course -> Modules; lessons can reference shared concepts or resources.

### Ingestion and publisher review

Extend extraction proposals to include candidate records, content blocks, collections, memberships, semantic relationships, field mappings, source anchors and uncertainty. Use PDF headings/table structure, DOCX outlines, spreadsheet sheets/tables, website navigation/breadcrumbs and publisher-supplied organization as signals. Do not assume a sheet is always a record type or a heading always deserves a collection.

Pass 1 preserves source structure. Pass 2 identifies canonical record boundaries and field meanings. Pass 3 proposes memberships and cross-record links. Pass 4 validates identity, cycles, field types and provenance. Models propose; validators enforce constraints and the publisher reviews the result. Bounded chunks share a candidate identity registry rather than producing unrelated miniature catalogs. Reuse existing extractors; unsupported formats/layouts remain explicit failures.

Studio offers a tree plus collection preview: rename, move, create a subcollection, cross-list a record, merge reviewed duplicates, split a mixed collection and inspect field coverage. Moving a membership does not mutate the record's facts. Deleting a collection removes organization only unless the publisher separately chooses to remove records; show impact before applying. Reimport matches stable IDs and preserves reviewed structure corrections, including an explicit record that a suggested membership was removed.

Legacy migration: each v1 catalog becomes one root with its existing collections as children; entities retain IDs, existing memberships become references, ungrouped entities appear in an “Other published items” view. Do not automatically reorganize existing published sites. A proposed richer hierarchy passes through review -> Apply -> Publish. Existing media albums adapt as collections with their own record type, retaining asset authorization and illustrative labels.

The assistant explores through describeScope/listChildren/resolveReference/query capabilities, receiving a bounded neighborhood and relevant field descriptors. Do not put the whole tree or graph into every prompt. Navigation history, query scope and visible breadcrumb must agree in voice, chat and click flows.

## 5. Query contracts and semantics

### 5.1 Field and relationship descriptors

Add an immutable published schema registry. Reuse existing stable IDs and assertion definitions; promote reviewed singleton properties into queryable fields where useful.

FieldDescriptor includes id, entity scope, label, aliases, value type, optional enum values, unit/currency/time zone, cardinality, supported operations, filter/sort/facet availability and evidence coverage. Aliases are publisher-reviewed mappings, not magic vocabulary embedded in the executor.

Types: text, enum, enum set, number with unit, money with currency, boolean, date/time, reference and geo point. Lists carry explicit any/all semantics. Range values do not become single numbers. Money conversion needs an explicit rate source; “under $100” is not meaningful across mixed currencies without a chosen currency.

RelationshipDescriptor includes stable predicate ID, forward/inverse labels, endpoint scopes, qualifiers, polarity and valid-time behavior. Relation queries use these IDs. “Compatible with” cannot be inferred from any generic edge or a shared keyword. Location proximity is distinct from travel duration; travel time needs routing data and a departure/mode context.

Each projected field resolves to known, unknown, conflicting, conditional or stale, with a source/authority category. Confidence is optional metadata, not proof or a calibrated probability unless measured as such. Private filenames/excerpts stay private; visitor explanations use approved public facts and citation-safe source records.

### 5.2 QuerySpec and incremental patches

Proposed versioned shape, to be implemented with strict schemas (illustrative type names below are not existing APIs):

~~~ts
type QuerySpec = {
  version: 2;
  queryId: string;
  revision: number;
  publication: PublicationRef;
  scope: { collectionId: string; traversal: "direct" | "descendants" | "explicitUnion"; include?: string[] };
  where: Expression;             // hard constraints
  preferences: Preference[];     // ranking, never hidden filters
  order: SortTerm[];
  asOf: string;
  timeZone: string;
};
type Expression =
  | { kind: "all" | "any"; id: string; children: Expression[] }
  | { kind: "not"; id: string; child: Expression }
  | { kind: "field"; id: string; fieldId: string; op: FieldOperator; value: TypedValue }
  | { kind: "relation"; id: string; predicateId: string; direction: "out" | "in"; target: Expression }
  | { kind: "state"; id: string; fieldId: string; state: "unknown" | "conflicting" | "stale" };
type QueryPatch = {
  queryId: string;
  baseRevision: number;
  operations: QueryPatchOperation[];
};
~~~

Patch operations are addConstraint, replaceConstraint, removeConstraint, setPreferences, setSort, clearScopeCriteria, undo and fork. Scope/time changes have explicit operations. Node IDs make “remove the budget” precise; a patch is atomic and reversible. The host assigns new query revisions and canonical hashes. Do not overwrite all filters from each utterance.

Initial bounds: depth 4, 24 leaf constraints, two relation hops, 8 preferences, 3 sort keys. Empty ALL is true, empty ANY is false. NOT on unknown remains unknown, not true. Exclude unknown/conflicting/conditional/stale values from a positive hard match unless the query explicitly requests their state or conditions are deterministically resolved. Explain counts separately.

Examples:

| Utterance | Meaning |
| --- | --- |
| Only outdoor venues for at least 50 people | Add space=outdoor AND capacity>=50 |
| Under $3,000 | Add budget with stated currency and pricing basis |
| Include indoors too | Replace the space clause with outdoor OR indoor; preserve capacity/budget |
| Prefer ones near a train station | Add a preference if relationship/location evidence exists; do not silently impose a radius |
| Actually I need 80 people | Replace capacity node, not add a contradictory second threshold |
| Anything except red | Known color is not red; unknown colors are not proven non-red |
| Show items without a published price | Explicit unknown-state predicate |
| Use the other collection but keep my budget | Map only compatible reviewed money fields; clarify if price basis differs |
| Undo that | Restore preceding query revision, recompute results, preserve independent selections |

Natural language maps to a bounded proposal using available descriptors and current criteria. Unsupported fields, ambiguous units, negation or scope produce a focused clarification. Deterministic filters never execute arbitrary SQL, JavaScript, a URL, or a model-written expression string.

### 5.3 Hard filtering, text retrieval and subjective preferences

Evaluate authorized scope and hard constraints first. Apply lexical matching and optional semantic ranking within eligible candidates. Soft preferences cannot reintroduce a hard-rejected item.

Published synonyms and lexical scoring form the first implementation. Subjective requests such as “cozy” map to a visible preference and known evidence; an optional embedding/reranker adapter may improve ordering later. Its absence must not make basic filters unavailable. A model score must not become a new publisher fact or a confidence claim.

If semantic candidate retrieval is bounded/top-k, label its coverage. Never present “no matches anywhere” based only on that subset. Keep exhaustive typed results and semantic suggestions distinguishable.

### 5.4 Results, facets and pagination

QueryResult contains query/revision/publication binding, stable resultSetId, page of references, nextCursor, evaluatedAt, count (exact/lowerBound/unknown), coverage (complete/partial), exclusions by information state, and per-item match explanations.

Default page size 24, maximum 48; provide exact hard-filter counts only after evaluating the whole authorized scope. Compound clauses share consistent query semantics. Facets count under all other hard constraints, with the queried facet's own clause omitted; label unavailable/partial facet counts. Bound this work and cache by canonical query and publication.

Stable ordering ends with an entity ID tiebreaker. Cursors bind query hash, sort, publication, scope and entitlement; validate expiry and reject tampering. A new filter/sort invalidates the old page cursor.

Implementation detail after acceptance review: ongoing viewport observations have their own CAS revision and do not replay completion receipts or increment task revisions. Scroll, resize and layout/visibility changes invalidate the previous scene before a debounced settled update. Visible references and their dependent evidence bind the exact current scene revision; the shared chat/voice bridge includes its bounded IDs and names.

Stable spoken codes belong to a result-set revision, independent of CSS columns. “Third visible card” uses acknowledged scene order; “result 23” uses a stable result-set ordinal. Sorting/filtering announces a new result set; stale codes do not retarget silently. Reflow and pagination do not reuse an existing code for another item. “Select all matching” creates a bounded server selection handle, not an unbounded ID list in a model prompt.

For zero results: explain which constraints eliminate candidates and offer the smallest useful relaxations with actual recomputed counts. Do not apply relaxations until the visitor chooses.

## 6. Catalog storage and scale

Keep Firebase/local stores as the source of truth. Do not start by purchasing or provisioning another database. Introduce CatalogRepository and QueryEngine interfaces so query semantics stay independent of physical storage.

Implementation progression:

1. A legacy adapter reads the existing <=100-entity authorized snapshot and uses the new evaluator. This validates semantics without changing publication storage.
2. A pure compiler produces normalized entity ordinals, collection membership/descendant indexes, typed columns, token postings, relationship adjacency, field coverage and content hashes. Cache immutable compiled indexes per site/revision with a byte-bounded LRU; never cache authorization.
3. A v2 publication manifest references immutable, size-bounded entity/assertion/media and index chunks. Local storage uses files; cloud storage uses existing server-owned persistence APIs behind a repository adapter, with chunks below the store's document limits. Chunks have deterministic IDs/checksums; staging must be complete before atomic publication-pointer change. No provider call occurs inside a retried transaction.
4. For the initial 10,000-record target, evaluate compact index data server-side and fetch only the requested page's public content. A worker may load a whole compact index within an explicit memory/I/O ceiling; this is bounded pilot scaling, not an unlimited search service.
5. Beyond measured ceilings, supply an indexed search/storage adapter with the same conformance suite. That is a separate operational decision with real workload measurements and authorization for infrastructure.

Do not compile arbitrary user expressions directly into Firestore compound queries. Current Firestore editions have different query capabilities and constraints; inspect the configured edition when selecting an adapter. The default design uses publication-index evaluation to avoid a combinatorial collection of per-publisher query indexes. [Firestore query documentation](https://firebase.google.com/docs/firestore/query-data/queries)

Large-catalog completion includes hierarchical ingestion/review/publication/storage/page rendering/provider context. It cannot be claimed by passing 10,000 synthetic objects directly to a helper while public routes still send the full v1 catalog. Keep per-file parsing bounds until chunked import/review is implemented. Aggregate multiple bounded import chunks into one reviewable candidate and publication; report truncation and omissions explicitly.

Browser initial props contain the site shell, schema summary, opening references and page data, not the entire catalog. Refactor publishedWorkspace/validateWorkspace so paged references are checked against server-issued result authority and bounded fetched records. A result token is not permission: reauthorize the current publication and visitor on every page/detail request. Legacy components continue via an adapter; v2 routes do not hydrate v1's full entity list.

Publish v2 only after all chunks and indexes validate. Failure leaves the previous publication usable. A publication change invalidates old result/cursor/evidence handles; show Reload results rather than silently mixing revisions. The manual website uses the same query service and offers paginated links/load more without AI.

No scale claim above 100 items is current implementation evidence. Required scale benchmarks and lifecycle tests appear in the plan.

## 7. Capabilities: the units of task composition

Define capabilities in reviewed server code; a publisher enables and configures available adapters. Keep catalog link capabilities compatible. Do not place executable URLs or handlers in extracted knowledge.

CapabilityDescriptor fields: id/version, human purpose, typed input/output schemas, applicable scopes, effect class, preconditions, result freshness policy, authorization policy, prepare/execute/status support, idempotency behavior, cost ceilings, cancellation semantics and approved presentation types.

Effect classes: read, localState, externalDraft, externalCommit. Calling a paid read still consumes budget; “read” does not mean free.

| Capability family | Examples | Output usable by later steps |
| --- | --- | --- |
| Schema/knowledge | describeScope, resolveReference, retrieveFacts | Reviewed descriptor/reference/evidence handles |
| Query | createQuery, patchQuery, getPage, explainMatches | Result set and criterion changes |
| Selection | select, remove, forkSelection, compare | Stable chosen references/comparison model |
| Research | searchWeb, searchImages, resolveLocation | Temporary attributed evidence/location handles |
| Presentation | open, focus, highlight, compose, close | Applied view receipt plus scene revision |
| Artifacts | composeBrief, itinerary, readingList, export | Editable structured artifact plus source references |
| Commerce | modifyCart, quoteCart, prepareCheckout | Cart revision, provider totals and expiring quote |
| Scheduling | availability, prepareBooking, confirmBooking | Offered slots, expiring draft and authoritative receipt |

Capability output includes status, typed data/handle, authority/source, observedAt/expiresAt, dependency revisions, completion evidence and optional presentation proposal. Retrieval and presentation are separate operations even if an adapter offers a convenience combination. Searching need not always force a fullscreen results card.

The shared executor reads available capabilities and updated context before every step. It creates explicit dependency records: outputs from earlier steps can bind typed inputs of later steps. Inputs referencing unsupported, expired, failed or mismatched outputs are rejected before provider execution. Domain examples are tests, not string switches.

Keep a bounded sequential execution policy initially; parallelism is unnecessary for dependent chains. A deterministic approved composite (e.g. query+render) can execute internal substeps without another model call, but every substep still counts against capability/cost limits.

## 8. Task lifecycle and interruption

Task states: interpreting, needsClarification, running, awaitingDisplay, awaitingConfirmation, completed, partiallyCompleted, failed, cancelled, reconciling. The model proposes requested outcomes; completion is derived from typed receipts satisfying those outcomes.

Each step records stepId, capability version, typed bindings, expected input/query/resource revisions, status and receipt. The host owns identifiers and budgets. Do not expose hidden reasoning; show human-readable progress such as “Finding matching venues” or “Calculating total.”

For every step: validate permission and revisions -> reserve budget -> execute once -> validate output -> save receipt -> apply/ack display if requested -> supply updated state/evidence to the next model round. Browser ACK includes operation ID, publication, workspace/query/result revision and applied/failed/cancelled status. It confirms the requested data was rendered, not just that a POST returned 200.

A provider receipt establishes a business effect; browser ACK cannot establish a booking or payment. A displayed quote is not checkout completion. If a write times out, preserve an unknown/reconciling state and inspect provider status using the same idempotency identity. Do not retry with a new key or tell the visitor it failed definitively.

Manual query changes, navigation, newer utterances and Home increment a task interaction generation and cancel stale pending work. Check generation before and after every async call and before applying a result. Already completed external effects are not undone by cancellation; reconcile and show their status. Ordinary clicks and speech use the same reducers.

An interjection such as “actually under $100” updates the task's criteria and invalidates only dependent uncommitted results. It must not accidentally start a second cart or replay a completed action. Keep versions of stable completed selections/receipts; explain invalidated quotes.

Budget defaults for first implementation: retain the current four model-directed tool rounds and final model response; 120-second overall task ceiling; one explicit execution per step. Quota admission must reserve a bounded aggregate across model, search and adapter work, then reconcile observed usage; missing usage is unknown. If the task cannot fit, offer Continue with a new bounded budget rather than silently abandoning requested steps or raising limits. No autonomous background jobs or paid retries.

## 9. Evidence, authority and cross-turn memory

Keep an expiring server evidence store keyed by site, publication, visitor session and evidence ID. Browser result IDs select already stored evidence; browser-supplied snippets, URLs and model prose are not authority. Revalidate retained evidence references on subsequent requests and never allow a result handle from another visitor or site.

Published facts, external research, calculated values, live provider values and general explanation can share a surface but retain provenance labels. General background may explain a known subject; it cannot establish stock, a publisher's policy, current price, a location pin or successful action.

Defaults: server session/evidence TTL 30 minutes idle with a two-hour absolute lifetime; task execution remains two minutes. Retention is a new design default, not the existing mailbox TTL. Explicit saved artifacts require an approved save action and appropriate visitor access; anonymous cross-device resume is not implied. Logs contain operation metadata and bounded reason codes, never raw transcripts, full query values, credentials, source excerpts or personal contact details.

## 10. Business action preparation

Example: “Add these three items and tell me the total with tax.”

Resolve selection/variants -> build or update a server cart draft -> request missing destination details -> call the configured quoting adapter -> show quantities, prices, shipping/tax breakdown and estimate status. The quote binds cart revision, currency, destination and expiration. The model does not calculate tax or invent shipping rules. Cart/provider totals can be estimates and may change at checkout. [Shopify CartCost](https://shopify.dev/docs/api/storefront/latest/objects/CartCost)

Changing quantity or destination invalidates the quote. Checkout is a separate explicit reviewed action. A confirmation is a server-owned pending action referencing the exact payload hash, price/terms/resource versions, expiry and current visitor identity. A bare “yes” is insufficient if more than one action is pending or its details changed.

Use a durable operation record and adapter idempotency key for all external effects. Reusing an operation ID with different parameters is rejected. On an ambiguous timeout, status reconciliation is distinct from a new attempt. This follows the idempotency pattern documented by payment providers; it is not a guarantee of end-to-end exactly-once delivery. [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)

The first build supplies synthetic commerce and scheduling adapters to prove composition, arithmetic display and stale-confirmation behavior. Vendor connectors are separate scoped additions. No live financial actions, credentials or dashboard changes are authorized by this design. Publisher subscription billing is a different subsystem from a publisher's visitor cart.

## 11. Visitor interface

Preserve the existing visual language and Motion runtime. Components reflect the task rather than a compulsory grid.

- CriteriaBar: editable chips with remove/undo, hard versus preferred distinction, active scope and match count.
- QueryCollection: grid/list/gallery with stable result codes, paging, meaningful card summaries and image associations.
- ComparisonBoard: selected objects with matching definitions/units, unknown fields retained.
- SelectionTray: a stable shortlist that persists across filters and can feed later capabilities.
- TaskProgress: short current activity, cancel, and explicit partial/error state; keep existing content useful while waiting.
- ClarificationCard: one necessary decision with actual options, also answerable by voice/chat.
- ActionReview: concrete draft/quote, expiry, editable inputs and explicit confirmation.
- ArtifactSurface: structured brief, itinerary or reading list; edit and export through registered actions.

First composition reuses the current catalog/card components through adapters. Do not redesign branding, waveform, greetings or every card at once. Filter reflow uses stable keys and controlled layout/presence transitions. Keep the focused item anchored; if a change excludes it, explain and offer return while retaining an intentional selection.

Desktop can show results, criteria and a comparison side by side. Mobile uses a results surface, reachable filter sheet and compact selection tray. All criteria and actions have touch/keyboard equivalents. Do not require users to learn voice syntax. Expose sort/filter through ordinary browsing so AI exhaustion does not disable them.

Mark the affected region busy, announce a concise result-count change, preserve keyboard focus, and avoid moving focus after every spoken update. Bound mounted cards (initially <=48) and use explicit pagination before complex virtualization. Choose list/card semantics by default; a visual grid does not automatically need ARIA grid. If an actual feed pattern is used, implement its keyboard/focus contract and busy-state behavior. [WAI-ARIA feed guidance](https://www.w3.org/WAI/ARIA/apg/patterns/feed/)

## 12. Publisher configuration and extension

Studio should show “What visitors can do” with enabled capabilities and missing requirements, “Filters and terminology” with field coverage/aliases/units, and “Try a visitor task” using synthetic or preview data.

Ingestion proposes useful filters, relationship labels and display hints alongside existing knowledge review. A publisher reviews them before Apply/Publish. Preserve corrections on reimport; capability discovery from source prose produces a setup suggestion only. Do not expose an editable workflow programming language as the default product.

A new domain extension supplies descriptor mappings, relationship semantics, optional adapters/components, and a fixture pack. The same query/compiler/executor tests must run unchanged. Examples: services with deliverables, media with topics/date/reading time, products with variants/compatibility, events with times/capacity, places with location/accessibility, portfolios with role/skills. Specialized clinical, financial or legal decision systems need additional scope; the general website engine does not grant domain expertise.

## 13. Diagnostics and acceptance philosophy

One task trace connects interpretation, query revisions, provider calls, display ACKs and completion receipts. Record capability IDs/versions, durations, evaluated/matched counts, budget usage, retry/reconciliation status and bounded reason codes. Exclude raw sensitive values.

Separate deterministic query correctness, model intent quality, UI behavior and adapter correctness. A scripted model response can prove transport wiring, not natural language understanding. A live chat success can prove that example, not live speech recognition. Do not conflate local, mocked, browser, provider and production evidence.

Required scenarios, code ownership, migration gates and release criteria are defined in [implementation-plan.md](implementation-plan.md). Implementation starts only in the separate task seeded by [codex-prompt.md](codex-prompt.md).
