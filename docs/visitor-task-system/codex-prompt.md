# Paste-ready Codex implementation prompt

Paste the text below into a new Codex task associated with theVoice / FlowPath Studio repository. The current checkout contains substantial uncommitted work; a task created from the remote default branch alone may not contain this baseline. The implementation agent must establish the correct baseline before editing.

---

Implement the FlowPath Studio visitor task system described in these documents:

- /Users/thomasdevito/Projects/theVoice/docs/visitor-task-system/architecture.md
- /Users/thomasdevito/Projects/theVoice/docs/visitor-task-system/implementation-plan.md

Read both documents completely. This is an implementation task, not another design-only investigation. Work through milestones M0–M6, keep a progress/evidence report, and continue until the local implementation and required checks are complete. Treat the architecture as the chosen direction; make reasonable technical adjustments when current code or tests justify them and document the reason.

The repository is /Users/thomasdevito/Projects/theVoice. It is FlowPath Studio, not the separate FlowPath news app. The intended baseline is the current working checkout, including existing uncommitted website/task/semantic-graph work. Inspect Git status and diffs first. If you are in an isolated worktree, compare it with the current checkout and establish a baseline containing the relevant uncommitted work without overwriting or moving anyone else's work. Preserve concurrent edits. Do not silently implement against an older default-branch version or overwrite overlapping changes.

Read AGENTS.md, README.md, docs/product-philosophy.md, docs/architecture.md, docs/visitor-task-execution.md, and the relevant semantic/adaptive-workspace docs before changing behavior. Use Node 24. Read relevant guides under node_modules/next/dist/docs before changing Next.js routes/rendering.

Product requirements:

1. Preserve existing voice navigation, chat, Home, manual browsing, loading states, focus/return and Motion quality. Filtering is an additional shared capability, not a replacement for navigation. Voice, chat and clicks must operate on the same state and validated operations. Compound requests must reach the task executor intact.

2. Replace the flat-catalog assumption with a hierarchical publication space: collections, subcollections, canonical records, explicit/derived memberships, and semantic relationships across branches. A record may appear in multiple collections without duplicating its facts. Keep collection containment acyclic, separate from the semantic graph. Maintain chosen-path breadcrumbs, scoped filtering and distinct result counts.

3. Extend existing ingestion and publisher review so documents, tables and websites can propose record boundaries, content blocks, nested collections, memberships and field descriptors. Source structure is evidence for a proposal, not an automatic final website hierarchy. Preserve provenance, identity review, publisher corrections, reimport behavior and proposal -> review -> Apply -> Publish. Do not produce a card for every paragraph or infer live capabilities from source text.

4. Implement conversational filtering as typed, versioned query state: scoped AND/OR/NOT, supported field/relationship predicates, units/currencies/time, explicit unknown/conflict handling, preferences, sorting, counts/facets, paging, incremental patches, undo and fork. “Include indoors too” changes that criterion while preserving budget/capacity. Soft preferences never override hard filters. Zero results do not automatically relax criteria.

5. Render criteria as editable chips, collections as suitable card/list/gallery views, and selections/comparisons as persistent task objects. Keep stable result IDs/codes independent of responsive layout; resolve visible ordinals from actual acknowledged scene state. Add accessible loading, mobile controls and no-AI filtering. Reuse the component/motion library and publisher style.

6. Evolve the existing lib/visitor-task-runner.ts and extract shared capability handlers for chat and voice. Add typed result/evidence handles, explicit dependencies, fresh context per step, publication/session authorization, budgets, cancellation and receipt-based completion. A lookup can feed filtering, comparison, map, image results, artifacts or enabled business actions. No subject-specific or hard-coded action-pair branches. No dependent execution from failed, expired or fabricated results.

7. Keep actual tool evidence server-owned and separate from browser-supplied descriptions. Browser acknowledgments prove display; provider receipts prove external effects. A query, sort, manual interaction or publication change invalidates stale dependent work. Home cancels pending work without deleting a cart or an explicitly saved artifact.

8. Add reusable structured artifact composition for briefs, reading lists and itineraries. Add fake commerce and scheduling adapters proving cart -> quote -> review and availability -> draft -> confirmation. Test idempotency, expired quotes, changed totals and ambiguous outcomes. Use synthetic data only. Do not implement tax rules by asking the model to invent rates, and do not confuse publisher subscription billing with visitor commerce.

9. Complete the large-catalog path, not merely a helper benchmark: versioned publication manifests/chunks, bounded imports/review, compiled query indexes, current-publication authorization, paginated public pages and bounded model context. Existing v1 is capped at 100 entities. Preserve a v1 adapter and prove a 10,000-record hierarchical fixture through actual local import/review/publication/query/browser paths. Do not just raise a schema limit or hydrate every item into the browser.

10. Keep the core independent of publisher verticals. Prove the same engine against media, freelancers, products, travel, education and an unseen field vocabulary. Domain-specific knowledge belongs in descriptors, relationships, fixture data and explicitly registered adapters.

Execution expectations:

- First record the baseline and a concise implementation sequence, then implement; do not stop after restating this prompt.
- Follow the milestone order in the plan. Make cohesive, reviewable changes and update an implementation report with real file paths, decisions and evidence.
- Run focused checks per milestone and the required final npm run check plus isolated browser suite. Distinguish pre-existing unrelated failures from regressions using evidence. Do not weaken acceptance tests to make a narrow demo pass.
- Add meaningful tests for hierarchy cycles/cross-listing, unknown and negation, scope changes, preserving criteria, cursor/revision validation, private-source/tenant isolation, manual cancellation, stale evidence, dependent multi-step tasks, duplicate confirmations and query performance.
- Use injected provider mocks to establish deterministic correctness; do not describe them as live model or microphone verification.
- Keep any user server on port 3220 running. Use the existing isolated browser harness for software checks. Do not touch the separate news app or mirrored shared GPT-Live core as incidental cleanup.
- If a milestone genuinely requires missing authorization, finish independent authorized work, report the specific boundary and ask only for that missing action. Do not invent approval checkpoints after every internal phase.

Authorization boundaries:

This prompt authorizes local software implementation, design-document updates and offline/mock/isolated-browser verification. It does not authorize deployment, Git pushes, package publication, cloud provisioning, changes to secrets/auth/billing/production settings, live purchases/bookings/messages or other real-world actions. Follow AGENTS.md. No new dependencies or database service should be added without a demonstrated need; do not start emulators.

This new task does not inherit earlier Brave or paid-API permissions. For milestone M7, request a specific local app/host, browser, scenario and call budget only after the implementation is ready for that live test. Real vendor connector activation remains a separate scoped task; do not mislabel synthetic adapters as production integrations.

Final deliverables:

- Implemented M0–M6 architecture, integrated with existing publisher review and visitor UI.
- Cross-publisher fixtures and meaningful automated tests.
- Accurate architecture/code map, migration notes, task/query/capability contracts and performance results.
- A completion report separating implemented, offline-tested, browser-tested, live-tested and unactivated features.
- Concrete local acceptance steps I can follow in chat and then voice.

Keep the full scope intact. If work spans context windows, resume from the recorded milestone state rather than starting over or claiming a smaller subset is the complete system.
