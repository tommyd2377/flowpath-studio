# FlowPath visitor task system: implementation plan

Design date: 2026-09-13. M0–M6 have been implemented in the current checkout; final verification status, code paths, measurements and acceptance steps are tracked in [implementation-report.md](implementation-report.md). M7 remains a separate live authorization gate. This document retains the original exit criteria. The authoritative design is [architecture.md](architecture.md), including section 4A on hierarchical collections. The [paste-ready prompt](codex-prompt.md) defines the authorized implementation scope.

## 1. Scope and priorities

Deliver one reusable path from hierarchical publisher knowledge -> conversational criteria -> consistent results/selections -> dependent capabilities -> appropriate UI.

Prioritize real ingestion, collection scope, deterministic filtering and state continuity before adding business connectors. Preserve existing website navigation and visual behavior while extending it. Do not replace the whole runtime, swap animation libraries or fork business rules by voice versus chat.

The full program includes all milestones below. The initial implementation is complete only when M0-M6 have code and offline/browser evidence. M7 is a separately authorized live validation gate; production vendor activation is a separate operational step. Synthetic commerce/scheduling prove adapter composition but do not constitute production commerce, booking or tax support.

“Any publisher” is an extension/conformance promise: new descriptors, relationships and adapters work without editing the planner's core. It is not a claim to implement every vertical's business rules.

## 2. Code map and ownership

Paths below are repository-relative. “Proposed” names are decisions for this implementation, not existing files; reuse equivalent modules if the checkout has evolved.

| Area | Existing anchors | Proposed additions / changes |
| --- | --- | --- |
| Pure content/schema contracts | packages/platform-ui/src/contracts.ts, knowledge.ts, media.ts | collection-space.ts for hierarchy, membership and v1 adapter; query.ts for typed expressions, patches, results and reducers |
| Query execution | lib/knowledge-retrieval.ts, packages/platform-ui/src/catalog.ts | lib/catalog-query.ts, lib/catalog-query-index.ts; retain old filter behavior via an explicit v1 adapter |
| Publication storage | lib/knowledge-store.ts, knowledge-model.ts, site-model.ts, site-commands.ts, local-store.ts, cloud-store.ts | lib/catalog-repository.ts; versioned publication manifest/chunk readers/writers and bounded cache |
| Ingestion and review | lib/ingestion.ts, source-adapters.ts, source-extractors.ts, source-provenance.ts, knowledge-store.ts; components/KnowledgeReview.tsx, KnowledgeAssertions.tsx | Hierarchy/record-boundary proposals, collection editing, staged chunk aggregation and reviewed field metadata; no source privacy regression |
| Shared session/task execution | lib/visitor-task-runner.ts, visitor-chat-task.ts, visitor-realtime-control.ts, visitor-realtime-mailbox.ts | lib/visitor-task-context.ts, visitor-capabilities.ts, visitor-task-store.ts; extract shared handlers while keeping channel transport code separate |
| Authoritative tool evidence | lib/explore-service.ts, explore-model.ts, visitor-realtime-context.ts | lib/visitor-evidence-store.ts; expiring session/publication-bound handles and validated result bindings |
| Visitor APIs | app/api/visitor/[slug]/route.ts and session routes; lib/visitor-request.ts | Query/page/detail/action endpoints under the same authorized site boundary; schemas shared with both channels |
| Browser coordination | components/VisitorAssistant.tsx, VisitorWorkspace.tsx; lib/workspace-screen.ts, visitor-view-context.ts | Shared query/selection state, patch dispatch, result-revision ACKs and stale-work cancellation |
| Controlled UI | packages/platform-ui/src/AdaptiveWorkspace.tsx, PublishedWebsite.tsx, components.tsx, styles.css, motion.tsx | CriteriaBar, CollectionNavigation, QueryCollection, SelectionTray, TaskProgress, ActionReview; compose existing cards |
| Publisher settings | components/EditorPanels.tsx, VisitorSettings.tsx, ExploreSettings.tsx; lib/site-model.ts | Reviewed field aliases/coverage and enabled capability descriptions; no credentials in the schema |
| Business adapters | Existing catalog link capability and independent test billing | lib/visitor-adapters/ with fake commerce and scheduling plus explicit contracts; do not reuse publisher billing as visitor commerce |
| Verification | tests/gpt-live.test.ts, visitor-realtime-control.test.ts, adaptive-workspace.test.ts, knowledge evaluations, tests/browser | New query, hierarchy, task, adapter conformance and cross-publisher evaluation packs |
| Package compatibility | packages/platform-ui/package.json, src/index.ts, build.mjs; scripts/verify-platform-package.mjs | Export pure contracts without introducing Next.js/Firebase/provider imports into the package |

The news app's mirrored lib/gpt-live files remain unchanged unless a future explicitly scoped shared-core change is necessary. Keep the website-owned executor as the integration point.

## 3. Milestones with exit gates

### M0 — Baseline and contracts

Read AGENTS.md and existing architecture documents, inspect status/diff, and identify concurrent edits. Run a focused baseline and record failures without attributing them to the new work. Do not infer implementation from filenames or old completion claims.

Define the versioned hierarchy, FieldDescriptor, QuerySpec/Patch/Result, selection, task/step/receipt and capability contracts. Implement strict validators and the v1 compatibility adapter. Preserve original entity/media IDs and use internal namespaces when combining source types.

Exit gate: legacy fixtures round-trip without losing data; invalid cycles, cross-site references, unsupported field operations and oversized expressions fail; new contracts are independently importable from the packed shared package.

### M1 — Hierarchical ingestion, review and publication

Implement publication space -> collections/subcollections -> canonical records and cross-listing. Keep collection containment separate from semantic relationships. Record content blocks preserve article/project detail instead of exploding every paragraph into a catalog card.

Extend existing structured and model interpretation proposals with bounded hierarchy/membership suggestions and field descriptors. Share candidate identity and aliases across import chunks. Add Studio tree/preview edits with reversible membership moves, coverage display and provenance inspection. Preserve structural corrections on reimport.

At this stage v1 size limits may remain while semantics and review behavior are proven. Existing sites retain their published layout until the publisher applies/publishes a proposed hierarchy.

Exit gate: actual fixture imports for a multi-sheet catalog, heading-based document and website-shaped HTML produce reviewable hierarchical proposals. One canonical record can appear in two collections without fact duplication; collection cycles are rejected; rejected memberships stay rejected after reimport; private extraction anchors do not leak into visitor responses.

### M2 — Query engine, scope and conversation patches

Implement typed Boolean expressions, relationship predicates, state predicates, units/currencies, temporal projection, sorting, counts/facets and query patches. Apply hard constraints before preferences. Support positive, negative and unknown/conflicting/conditional outcomes consistently.

Add capability-backed scope/schema discovery and model-proposed patches using the same descriptor registry. Do not hard-code industry attributes such as price, capacity, publication date or room size in the executor. Domain meaning belongs to reviewed field mappings.

Provide explicit scope traversal (direct/descendants/union), canonical ID deduplication, node-level replacement/removal, undo/fork and zero-result alternatives. Use the existing legacy evaluator as a compatibility oracle where semantics overlap; test new semantics independently.

Exit gate: multi-turn corrections preserve unrelated criteria, zero results do not silently relax constraints, cross-type comparisons reject mismatched units/bases, and descendant queries return distinct canonical records with correct counts.

### M3 — Visitor filtering and navigation integration

Add collection navigation/breadcrumbs, criteria chips, sort, paging, result counts and selection tray to browse and assistant modes. A user can filter and compare without AI. Voice/chat apply the same validated patches as clicks.

Integrate query-backed surfaces while preserving stable IDs, focus/return, reduced motion, keyboard control and publisher styling. Prefer existing cards; do not redesign waveform or opening/greeting behavior. A collection surface references one result set, not thousands of workspace objects.

Make loading local to the affected region and visible globally when appropriate. Keep existing content during async work. ACK exact query/result revisions after settled rendering. Distinguish stable result codes from visible ordinals and reject stale references after a sort/filter change.

Exit gate: desktop and mobile browser tests complete equivalent tasks through clicks and mocked chat/voice; manual edits during a pending request prevent late model results from overwriting them. Home works from every intermediate state, and no-AI browsing/filtering remains usable.

### M4 — General capability composition and reliable task state

Extract shared handlers into the registry and use one execution context for both channels. Implement typed output handles, explicit dependencies, current-state refresh, clarification, progress, cancellation, bounded budgets and receipt-based completion.

Add server-owned temporary evidence so subsequent steps/turns use actual approved or retrieved values. Browser-supplied result text never creates authority. Separate lookup from display, while preserving a convenience lookup-and-show path for existing behavior.

Persist bounded task/step metadata before external effects. Handle ambiguous outcomes as reconciling. Keep no automatic paid retries, reject conflicting operation-ID reuse and maintain useful partial results. Failure of a prerequisite prevents its dependent action but does not erase completed independent output.

Exit gate: the same registry executes lookup -> filter -> compare -> display and evidence lookup -> map across different fixtures; no tool can execute without typed input/permission; cancellation/expired evidence/publication changes prevent stale continuation; actual matching ACKs are required for display completion.

### M5 — Reusable artifacts and synthetic business actions

Add one structured editable artifact family supporting project briefs, reading lists and itineraries from selected records/evidence. These are different schemas/presentations using shared composition and export mechanics. Saved artifacts are opt-in; exports contain only visitor-authorized content.

Implement fake commerce and fake scheduling adapters with persisted synthetic state. Demonstrate cart changes -> quote -> review, and availability -> booking draft -> confirmation receipt. Use integer minor currency units, provider-like estimate/freshness flags and explicit appointment time zones. Synthetic rates/slots are fixtures, not tax advice or real availability.

Confirmation is bound to the exact current action and expires on relevant input changes. Double-click/repeated voice confirmation has one effect. Timeout after a simulated commit enters reconciliation; status inspection retrieves the existing outcome without another mutation.

Exit gate: three products can be added, quoted with a fixture tax/delivery breakdown and updated correctly; stale quotes cannot be committed. Booking race and duplicate submissions are covered. No live payment, email, scheduling account, merchant setup, subscription or billing changes occur.

### M6 — Large publication path and integration hardening

Implement the v2 manifest/chunk path for imports, review artifacts, public projections and query indexes. Stage complete immutable chunks, validate hashes/references/indexes and atomically publish the manifest. Adapt cloud/local repositories without provisioning infrastructure or changing production rules/configuration.

Remove full-catalog hydration from v2 public pages and full-directory injection from model context. Resolve current authority through manifest/schema summaries, result handles and bounded record retrieval. Review pagination must work at the same scale as visitor pagination.

Provide a legacy rollback/read path. Do not write a giant v2 catalog back through the old v1 schema or a single cloud document. Invalidate old cursors/evidence on publication change. Enforce index memory/I/O limits and explicit unsupported/partial responses.

Exit gate: create/import/review/publish/query/browse a deterministic 10,000-record hierarchical local fixture through the actual v2 lifecycle. At least one true record match lies beyond the first page and beyond the old 100-record cap. Cloud persistence is tested with injected/mocked transports; no live deployment claim. All required checks and adversarial suites pass, or specific unrelated baseline failures are reported with evidence.

### M7 — Bounded live acceptance and operational activation

After M0-M6 are concrete and locally validated, request a specific app/host/browser/test budget if the new conversation lacks it. Never inherit this conversation's paid-call or Brave authorization.

Use that budget for paraphrases, corrections and unrelated domains, not repeated identical demos alone. Include the West Point regression with honest approximate-map labeling. Live microphone tests require their own approved device/permission flow; chat is evidence for the shared task logic, not speech recognition or audio latency.

Production connector activation, credentials, cloud configuration, deployments and real transactions remain outside this implementation prompt. Deliver a setup checklist for the user if a connector is later requested.

## 4. Required cross-publisher scenarios

Every row must use the same core query/execution path. Labels/IDs are fixture data. In addition, generate at least one unseen field/collection vocabulary to detect memorized domain branches.

| Fixture | Request sequence / expected behavior |
| --- | --- |
| Media archive | Topic -> subtopic -> articles; recent articles AND either of two authors; changing time range preserves author/topic; no reading of premium/unpublished content without entitlement |
| Freelancer portfolio | Services -> projects; select industry and deliverable, prefer a visual style, create a brief from the shortlist; preference cannot invent a portfolio claim |
| Product catalog | Categories -> products/variants; compatible accessories, price/currency filter, selection -> fake cart -> revised quote; stale quote rejected |
| Travel guide | Region -> county -> attractions; include descendants, filter documented accessibility, show unknowns separately, compare and map; same place cross-listed without duplicate count |
| Class provider | Subjects -> courses -> sessions; beginner level AND Tuesday evenings in a declared time zone; missing availability requires adapter lookup |
| Multi-branch institution | One record appears under two departments; scope union deduplicates; breadcrumb follows chosen path; opposite relationship direction gives a different result |
| Mixed collection | Photos/articles/services share topic but incompatible “price” meanings; grouped result/facets avoid false comparisons |
| Sparse documents | Source lacks a requested field; report insufficient data, propose scope/refinement, never synthesize a positive match |
| Large publisher | 10,000 records, deep collections, stable paging and counts; result outside first page is findable without model/full browser hydration |

Add these failure cases: AND/OR/NOT nesting; unknown under NOT; conflict/conditional/expired fact; unit mismatch; list any/all; false versus missing boolean; deleted record; wrong tenant/publication/cursor; prompt injection in field labels/source snippets; stale scene ordinal; two simultaneously open queries; manual interruption after the first step; second tab conflict; provider timeout before/after a simulated write; duplicate confirmation; partial semantic coverage; unsupported connector; quota exhaustion mid-task; Home with an existing cart; reduced motion; keyboard focus retained during results reflow.

## 5. Verification and measurements

Use Node 24 and commands verified in the repository:

- npm run build:platform after shared package edits.
- npm run lint and npm run typecheck.
- npm test and npm run test:package for final contracts/integration.
- npm run check for the complete implementation before handoff.
- npm run test:browser for the isolated demo suite, using the documented runner and its disposable contexts. Keep an already running user server on 3220 intact.

Do not run emulators, live providers or personal browser profiles by default. Read the local Next.js route/rendering guides before changing those APIs. Use current package scripts rather than guessed commands.

Tests must assert final domain/query state and visible UI/receipts, not just that a model was called or a request returned 200. For hierarchy fixtures assert exact memberships and distinct counts against hand-authored expected data. For generated larger data use an independent simple exhaustive oracle. Benchmark scripts are proposed additions and must be documented when added.

Proposed measured targets, not present performance claims:

| Measure | Initial target and evidence |
| --- | --- |
| Deterministic query correctness | Exact agreement with oracle for supported operators; zero cross-tenant/unpublished leaks |
| Query edit continuity | All defined patches preserve untouched criteria; every undo restores equivalent results |
| Warm query at 10k records | p95 <=200 ms over >=100 diverse queries on documented local hardware, excluding network/LLM latency |
| Cold index and per-worker memory | Report cold load time, bytes/read count and RSS; single compiled index <=128 MiB; bounded LRU total <=256 MiB |
| Browser rendering | <=48 mounted result cards, initial query payload <=150 KB excluding image bytes; no full catalog in page props |
| Model context | Bounded descriptors/results with explicit omitted/coverage metadata; enforce a serialized context ceiling and report actual token usage |
| User feedback | Loading shown within 150 ms of a dispatched async action; no spinner remains after completion/failure/cancel |
| Model task quality | Live or recorded-provider evaluation report separate from mocked correctness; track interpretation errors, clarifications and false completion |
| Cost | Per-task model/search/adapter calls and observed usage; no unmetered composite substeps or automatic retry loops |

When a target is missed, record the workload, actual result and limiting path. Do not weaken the dataset, hide cold costs, drop unsupported filters or redefine a partial result as exhaustive to make a benchmark pass.

## 6. Migration and rollback gates

- v1 readers remain valid while v2 is introduced; all new payloads declare versions.
- Field IDs and canonical record IDs survive migrations; aliases preserve old references where needed.
- Ingestion/review support precedes publishing new structures. Existing publications are never silently reorganized.
- Public v2 pages load only bounded data; a fallback to full v1 hydration is allowed only for actual bounded v1 publications.
- Query indexes are derivatives of a publication, never the source of editorial truth.
- Only current authorized revisions are served, even if an old result or staged chunk is cached.
- New failure leaves the previous publication and useful confirmed workspace intact.
- Synthetic capability adapters are visibly demo-only and cannot be selected as live providers.
- No feature switch or adapter config enables a vendor capability without its real authorization/configuration.

## 7. Documentation and implementation completion report

Update this plan with milestone status and evidence links as implementation proceeds. Record actual file locations, schema versions, decisions that changed, migration behavior, known limitations and commands/results in a new implementation report.

Completion report must distinguish:
1. Implemented and offline-tested.
2. Isolated browser-tested.
3. Live provider-tested (exact scenario and calls).
4. Unverified voice/device or cloud/production behavior.
5. Vendor adapters intentionally not activated.

Do not call the whole commercial platform production-ready from this project. The implementation deliverable is a generalized, testable task/query architecture integrated with real publisher ingestion and visitor UI, with honest adapter boundaries.
