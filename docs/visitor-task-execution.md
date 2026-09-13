# General visitor task execution

## Required outcome

Chat and voice represent the same publisher website and complete a visitor task through enabled capabilities. The model resolves dependencies from actual results, not subject-specific routing or hard-coded action pairs. Finding an address and displaying a map is one acceptance case; retrieval, comparison, image search and display must compose through the same mechanism.

## Current verified implementation and gaps

- `lib/visitor-knowledge-context.ts` supplies the website-assistant role, publisher boundaries, full-task instructions, evidence rules and screen acknowledgment requirements to both channels.
- `lib/visitor-task-runner.ts` is the website-owned, transport-independent executor. It accepts chat or voice delivery, runs sequential tools and returns their outputs to the next model request. The mirrored `lib/gpt-live/backend.ts` remains unchanged for the independent news app. It remains bounded to four tool executions plus a final model response, with no parallel tools or automatic retries.
- `lib/visitor-realtime-control.ts` previously overrode that limit to one. It now calls the website executor with four steps and continues to wait for browser acknowledgment before returning display results to the model. Per-request usage is recorded by the existing callback. This increases the maximum model requests per voice task from two to five; it adds no background work.
- Explicit `silent` and `directText` results still terminate a task; current failure outcomes must not be converted into successful prerequisite results.
- Live workspace chat now streams through `lib/visitor-chat-task.ts` and the shared executor, using the existing publication-bound control mailbox for browser acknowledgments. `lib/visitor-chat-protocol.ts` validates the bounded NDJSON stream. The legacy provider remains for non-workspace and demo paths.
- `components/VisitorAssistant.tsx` preserves direct Home/Browse controls and routes live chat requests intact to the executor. It applies each streamed view, confirms the resulting state, and acknowledges it before the next step. Missing search views cannot report applied.
- Map tools currently provide published coordinates or an approximate model-selected overview. Resolving a sourced external address and an appropriate map requires reusable evidence/location capabilities, not an address/map regex shortcut. No subject-specific map shortcut was retained.

## Next implementation boundary

Chat and voice share the executor, workspace validators, exploration validator/provider and publication checks, while retaining separate transport adapters. Further consolidation of adapters remains possible. Dynamic instructions are regenerated before every model round from the latest acknowledged workspace, preventing the initial snapshot from overriding newer tool results. The host must own a task ID, publication snapshot, allowed tools, intermediate evidence, latest browser state, cancellation and a bounded execution budget. Tool results must distinguish retrieved information from browser-applied changes. Chat must acknowledge a displayed change before the executor claims success or uses that changed view as a prerequisite. Publication changes, Home, manual interaction and cancellation invalidate stale work. External evidence remains temporary and attributed, not published knowledge.

## Acceptance evidence required

1. Mocked dependent chains with multiple unrelated publishers/subjects, including retrieval then comparison and sourced location then map.
2. No dependent execution after failed or cancelled prerequisites; no invented IDs or newly granted capabilities.
3. Browser confirmation after each display step and correct retained context after manual changes.
4. Live GoSite chat on September 13 retrieved a cited address (606 Thayer Road), then opened an interactive West Point overview using that returned address and retained the evidence card. An initial run subsequently failed on a stale workspace operation. After refreshing instructions each round, a fresh live request completed cleanly in Brave: cited address, interactive West Point overview, retained evidence and final answer, with no error or lingering loader. The server request completed in 16.8 seconds.
5. Voice uses the same handlers and task logic; mocked transport verifies that parity, while real microphone/speech behavior requires separate testing.

The first browser reproduction opened an empty published map card stating that no address/coordinates were provided. That is evidence of the failure, not completion. The requested live chat chain is verified. This single example does not establish universal model reliability or live microphone behavior. Country/world map presets now match the complete subject, so institution names containing United States or World no longer select a country/world viewport. Maps remain approximate overviews, not geocoded address pins. The original three-submission budget was exhausted; the user then approved 30 additional submissions, of which one was used. No automatic retries were added.
