# Model prompt inventory

Source audit for backlog note **#14**, against the current working checkout on **2026-09-19**, including its uncommitted changes. This is a navigation aid for the owner and future developers; the source remains authoritative. The audit adds documentation and comments outside string literals. It does not change or centralize prompts.

## How to read this inventory

A **unit** is an independently selected instruction constant, builder, conditional supplement, tool description, or application-authored message sent to a model. Sentences in one continuous policy are one unit; separately selected branches are identified below. Each row gives its purpose, source, delivery path and dynamic inputs.

- **Active** means a current application call path exists when its existing configuration and permission gates allow it; it does not mean deployed or live-tested.
- **Compatibility** means a retained branch or shared helper outside Studio's normal information-surface path. Reachable fallback branches are identified explicitly.
- **Demo** means deterministic/synthetic behavior, not production capabilities. **Test** means test input or assertions, not additional production instructions.
- **Responses instructions** means the request's top-level `instructions` field. **User input** means `input[].role: 'user'`. **Tool** means a function description/parameter schema; capability purposes are instead serialized into Responses instructions. **Live** uses session `instructions` or the explicit `session.instructions.append`, `session.thinking.append` and `session.commentary.append` event types. These are distinct transport fields, not interchangeable role names.

## Call paths

The path codes below link to the entry point or builder used by each inventory row. All current Responses builders select `gpt-5.6-luna` directly or through `LIVE_BACKEND_MODEL`; `runVisitorTask` accepts its model from the caller. Voice sessions select `gpt-live-1`. Model selection is recorded here only to identify the path.

| Path | Entry point → prompt consumer | Status and scope |
| --- | --- | --- |
| [E: editor][editor-route] | Site `chat` command → [editWithChat][editor-dispatch] → [generateEditorReply][editor-call] → Responses HTTP. | Active connected owner edits; demo edits use deterministic commands. |
| [I: ingestion/correction][knowledge-route] | Knowledge analyze/analyze-files/analyze-url/analyze-website/correct → [ingestion][ingestion-builder] → `semanticProviderOutput` → Responses HTTP. | Active connected prose/correction path; structured extraction and supported exact corrections can stay local. |
| [P: photos][photo-route] | Media interpret route → [interpretMedia][photo-builder] → Responses HTTP. | Active only for the explicit connected `useVision` branch; local suggestions have no model prompt. |
| [C: visitor chat][chat-route] | Connected chat with workspace → [visitorChatTask][chat-builder] → [runVisitorTask][runner] → streamed Responses HTTP. | Active information-surface path; selected preview requests inject `previewFetch` instead of a provider. |
| [F: chat fallback][chat-fallback] | Visitor route without workspace → `visitorTextReply` → Responses HTTP. | Reachable compatibility path selecting source or catalog instructions; its workspace branch remains implemented for direct callers/tests. |
| [V: voice backend][voice-control] | [Session route][session-route] → [visitorRealtimeSession][session-builder] → `createVisitorRealtimeControl` delegation → [runVisitorTask][runner]. | Active; uses [Responses WebSocket][response-socket] or the runner's injected/HTTP transport. Deterministic navigation/query shortcuts can bypass Luna. |
| [L: voice delivery][session-builder] | Session creation → `POST /v1/live/sessions`; controller → [shared Live runtime][live-runtime] and [context channel][live-context] → attached Live socket. | Active audio session instructions and subsequent instructions/thinking/commentary. |
| [S: external search][search-service] | [Explore route][explore-route], chat tools, voice tools or research capability → `authorizedExplore` → [searchExplore][search-builder] → Responses HTTP. | Active opt-in; local demo results and recognized map presets avoid a provider call. |
| [B: shared backend][shared-backend] | `runLiveBackend` → Responses HTTP using caller-supplied instructions, context and tools. | Shared compatibility helper; repository callers are tests, while Studio uses `runVisitorTask`. The independent FlowPath checkout was not audited. |

This accounts for **seven Responses HTTP request builders**, one Responses WebSocket transport that forwards the runner's body, and one Live session-creation builder. Shared Live socket append producers are itemized below. No additional first-party model transport was found in the scanned source.

## Owner editing, ingestion and photos

| Unit / source | One-line purpose | Path / channel / status | Dynamic instructions or reference data |
| --- | --- | --- | --- |
| [Editor `instructions`][editor-instructions] | Propose requested draft edits for review without inventing facts or applying/publishing changes. | E / Responses instructions / active | Fixed policy; selected draft, documents, logos and history come from `buildEditorContext`. |
| [Editor reference wrapper][editor-input] | Mark saved context as reference data before the current owner request. | E / user input / active | Serialized context followed by the owner's `text`; prior messages remain quoted data rather than live roles. |
| [Semantic base instruction array][semantic-base] | Extract reusable, evidence-linked entities, typed facts, relationships, collections and jobs for publisher review. | I / Responses instructions / active | Fixed policy joined in source order; source material, anchor IDs and schemas are supplied separately. |
| [Related-file supplement][semantic-related] | Require one evidence-isolated interpretation per supplied source in a combined response. | I / Responses instructions / active conditional | Selected by `context.related`; file IDs and anchors are reference data. |
| [`WEBSITE_CONTENT_BRIEF`][website-brief] | Turn website material into useful canonical topics and offerings while excluding crawl containers and repeated source copies. | I / Responses instructions / active conditional | Appended only when `context.website`; imported HTML/crawl text is untrusted evidence. |
| [Correction request wrapper][semantic-correction] | Apply the publisher's current correction while preserving IDs, unrelated records and capability boundaries. | I / user input / active conditional | Selected when `correction` is supplied; current catalog is serialized separately and the publisher request is interpolated. |
| [Photo interpretation instructions][photo-instructions] | Suggest visible descriptions and supported photo connections without face identification or inferred business facts. | P / Responses instructions / active conditional | User input contains publisher context, existing reviewed metadata, reference IDs and selected sanitized thumbnails; embedded image text is data. |

## Shared visitor guidance and chat composition

| Unit / source | One-line purpose | Path / channel / status | Dynamic instructions or reference data |
| --- | --- | --- | --- |
| [`VISITOR_KNOWLEDGE_POLICY`][knowledge-policy] | Separate published facts, background and historical research; reuse applicable findings while completing bounded, confirmed tasks. | C, F, V / Responses instructions / active | Shared fixed policy; callers add current subject, published passages, completed dialogue and retained evidence. Prior estimates preserve conditions and are not transaction authority. |
| [`assistantPurposeInstructions`][assistant-purpose] | Combine the publisher's bounded audience/purpose with the applicable conversation preferences. | C, F, V / Responses instructions / active | Published `visitor.assistantPurpose` or fixed fallback, plus `conversationInstructions`; purpose does not grant capabilities. |
| [`conversationLanguage`][conversation-language] | Choose delivery language, with a separate rule for auto-language greetings. | C, F, V, L / instructions / active | Published language enum; greeting flag selects welcome-text language versus following the visitor. |
| [`conversationInstructions`][conversation-instructions] | Translate published tone, length, follow-up, small-talk and voice-listening preferences into delivery rules. | C, F, V, L / instructions / active | `conversationSettings` merges defaults, legacy opening tone and saved preferences; voice adds pace, backchannels, listening and quoted pronunciation hints. |
| [`workspaceInstructions`][workspace-instructions] | Compose exact-reference workspace operations and qualified answers using current state and bounded published retrieval. | C, V / Responses instructions / active; F/direct callers also supported | `tool`, `chat` and default `response` modes select envelope instructions; state, scene, directory, records, facts, text and omitted counts remain data. |
| [`carouselInstructions`: surface branch][surface-instructions] | Compose one evolving information surface with related media, whole-answer Back and confirmed visibility. | C, V / Responses instructions / active when surface exists | Acknowledged surface and media plus server-resolved `surfacePublishedFacts`; browser prose is not factual authority. |
| [`carouselInstructions`: carousel branch][carousel-instructions] | Ground navigation and explanations in the active card of the retained carousel representation. | C, V / Responses instructions / compatibility fallback | Current carousel, active published text, reading/media state; absent carousel returns an empty guide. |
| [Chat instruction callback][chat-instructions] | Refresh task, purpose, evidence, carousel and workspace guidance before each chat model round. | C / Responses instructions / active | Bridge instructions when available, retained research, current acknowledged context and request; fixed text explains missing retained evidence. |
| [`runVisitorTask` instruction wrapper][runner-instructions] | Add shared knowledge policy, chat/voice delivery guidance and the current word limit to each task round. | C, V / Responses instructions / active | Caller string or async callback, channel and word limit; context is refreshed as user input, tool results as `function_call_output`. |
| [`activeCarouselImage` label][active-image] | Explain the current image input without treating visible appearance as identity or business evidence. | C, V / user `input_text` next to `input_image` / active conditional | Authorized current photo ID and published caption/alt; no extra model request is created. |
| [`visitorTextReply` `guide`][fallback-guide] | Assemble the single-response chat policy and explicitly describe its lack of an implicit search tool. | F / Responses instructions / compatibility | Purpose, subject, history and workspace/catalog/source branch selected from validated request context. |
| [`visitor-provider.instructions`][fallback-source] | Select published source content for the retained source-only visitor guide. | F / Responses instructions / compatibility | `presentationInstructions`, public source records, history and navigation context. |
| [`visitor-provider.catalogInstructions`][fallback-catalog] | Add current-view precedence and trust limits to the retained catalog presentation guide. | F / Responses instructions / compatibility | `catalogPresentationInstructions` plus validated current context. |
| [`presentationInstructions`][presentation-instructions] | Select up to six published sources and an appropriate legacy layout without generating facts. | F and V `present_site` / instructions or tool description / compatibility | Fixed policy; schema/source IDs come from the current publication and approved media. |
| [`catalogPresentationInstructions`][catalog-instructions] | Select controlled v1 catalog components, filters, media and transitions using published references. | F and V `present_site` / instructions or tool description / compatibility | Bounded catalog projection, current state, request and history; the voice tool takes only the policy before the JSON boundary. |

## Visitor task guidance and tool descriptions

| Unit / source | One-line purpose | Path / channel / status | Dynamic instructions or reference data |
| --- | --- | --- | --- |
| [Task bridge `guidance`][task-guidance] | Preserve typed query criteria, dependent operations and exact display acknowledgment across visitor tasks. | C, V / Responses instructions / active with task bridge | Rebuilt per round with schemas, scope, query, selection, evidence handles and acknowledged surface/result state. |
| [Task bridge `projectionGuide`][task-projection] | Explain how to retrieve details omitted from bounded record context. | C, V / Responses instructions / active with task bridge | Record projection limits and omitted counts are data; guidance names `records.lookup` and `schema.describe`. |
| [Task bridge record-parameter description][task-record-schema] | Require server-owned record handles instead of model-authored record arrays. | C, V / schema description inside Responses instructions / active | Inserted into capability schemas with a `records` property, then serialized with enabled descriptors. |
| [Task bridge `visitor_task` tool][task-tool] | Execute an enabled typed capability with optional prior-result bindings. | C, V / tool description / active | Allowed IDs derive from the registry; `query.command` is excluded, demo entries require demo mode, research lookup requires enabled research. |
| [`publishedContentTool` / `read_published_content`][published-content-tool] | Search published text or page through an exact source without changing the screen or searching externally. | C, V / tool description / active | Fixed description/schema; current authorized publication supplies results. |
| [`answerCompositionTool` / `present_answer`][answer-tool] | Present a complete answer while retaining related context or replacing an unrelated subject. | C, V / tool description / active | Fixed description; typed arguments choose text and relationship. |
| [`carouselNavigationTool` / `navigate_carousel`][carousel-tool] | Navigate the acknowledged surface, including whole-answer Back and local gallery controls. | C, V / tool description / active when carousel exists | Fixed description; valid actions and optional exact ID are schema-bound. |
| [Chat `update_workspace`][chat-tools] | Arrange published information or retained external results and wait for browser acknowledgment. | C / tool description / active | Fixed description; workspace schema and current state constrain arguments. |
| [Voice surface `update_workspace`][voice-surface-tools] | Add, replace or remove semantic regions while routing collection queries through visitor tasks. | V / tool description / active when carousel exists | Surface-specific description selected by `tools(taskBridge)`. |
| [Voice workspace `update_workspace`][voice-compat-tools] | Change exact workspace objects atomically while preserving unrelated objects. | V / tool description / compatibility without carousel | Selected only when workspace exists in the retained branch. |
| [Voice `present_site`][voice-compat-tools] | Select a legacy published presentation for a requested visual change. | V / tool description / compatibility without carousel | Appends the catalog policy prefix or `presentationInstructions`; parameter schema follows catalog/media availability. |
| [Voice `navigate_view`][voice-navigation-tool] | Describe Home, Browse, Clear, panel focus/close, comparison and scrolling with confirmed results. | V / tool description / compatibility without carousel | Fixed description; exact scene/reference IDs supplied as arguments. |
| [`exploreVoiceTool` / `search_explore`][explore-tool] | Describe enabled external search, approximate maps, annotation and navigation of existing results. | C, V / tool description / active opt-in | Inclusion follows search enablement; runtime validates image/map/annotation permissions and current result IDs. |
| [Task bridge shortcut feedback][task-feedback] | Redirect rejected conversational-command and record-display shortcuts to typed query operations. | C, V / `function_call_output` data / active | Two fixed rejection messages in `execute`; these are feedback, not a replacement instruction channel. |
| [Chat query-ownership feedback][chat-query-feedback] / [voice feedback][voice-query-feedback] | Explain that workspace operations cannot bypass authoritative collection queries. | C, V / `function_call_output` data / active conditional | A fixed rejection message is selected after validating a workspace batch. |

### Capability purposes serialized into the task guide

These are **34 separate first-party capability descriptions**, not UI labels. Each `capability(...)` call supplies a purpose that [the bridge][task-schemas] serializes with its schema, effect, authorization, output type and demo flag into **C/V Responses instructions**. The following source links identify each definition; delivery and dynamic availability follow that shared path. Handler code is deterministic and does not itself introduce another prompt. Names, labels, records, values and tool outcomes supplied by handlers are reference data.

| Capability / source | One-line purpose | Status |
| --- | --- | --- |
| [`query.command`][cap-query-command] | Describe the retained verbatim-command adapter for filtering, scope, sorting and undo. | Compatibility; explicitly excluded from the model-facing registry. |
| [`publisher.links`][cap-publisher-links] | List reviewed navigation links without claiming external action completion. | Active. |
| [`task.clarify`][cap-task-clarify] | Ask for necessary clarification while preserving the current useful view. | Active. |
| [`presentation.show`][cap-presentation-show] | Display a retained typed result and require the exact browser receipt. | Active; bridge rejects `records` display shortcuts. |
| [`records.search`][cap-records-search] | Retrieve a bounded set of matching authorized records within active filters. | Active. |
| [`records.filter`][cap-records-filter] | Filter an already-retained bounded record result. | Active; not the collection-display filter path. |
| [`selection.fromRecords`][cap-selection-fromRecords] | Replace selection from a server-owned record result. | Active. |
| [`schema.describe`][cap-schema-describe] | Retrieve collection scopes and reviewed field definitions. | Active. |
| [`collection.page`][cap-collection-page] | Page through child collections and field definitions. | Active. |
| [`query.close`][cap-query-close] | Close a query while retaining selections, artifacts and cart state. | Active. |
| [`query.create`][cap-query-create] | Create an independent query in a chosen scope. | Active. |
| [`query.patch`][cap-query-patch] | Edit typed criteria, search and ordering while preserving unrelated constraints. | Active. |
| [`query.activate`][cap-query-activate] | Return to an existing query without transferring incompatible criteria. | Active. |
| [`view.back`][cap-view-back] | Restore a confirmed view or explicitly return to local collection results. | Active; whole-answer Back uses `navigate_carousel`. |
| [`view.reset`][cap-view-reset] | Clear collection constraints, search, sort and scope. | Active; Home remains separate. |
| [`query.page`][cap-query-page] | Retrieve the next bounded result page using the current cursor. | Active. |
| [`selection.modify`][cap-selection-modify] | Select or remove an exact published canonical record. | Active. |
| [`selection.compare`][cap-selection-compare] | Compare selected records using compatible reviewed fields. | Active. |
| [`records.lookup`][cap-records-lookup] | Read bounded current published records without private sources or inferred live state. | Active. |
| [`record.detail`][cap-record-detail] | Open one published record with its qualified fields and detail blocks. | Active. |
| [`reference.resolve`][cap-reference-resolve] | Resolve stable result codes or visible ordinals against confirmed scene identity. | Active. |
| [`home`][cap-home] | Return to the opening and cancel pending work while retaining selected/saved state. | Active. |
| [`research.lookup`][cap-research-lookup] | Retrieve enabled external evidence separately from displaying it. | Active opt-in; excluded without research callback and publisher search permission. |
| [`research.recall`][cap-research-recall] | Read a complete prior finding by exact ID without a new search or display. | Active; same visitor session/publication and expiry, with original sources and conditions. |
| [`research.history`][cap-research-history] | Discover bounded retained research IDs when the prompt cannot include the directory. | Active read-only; directory metadata has its own output type and is not complete research evidence. |
| [`map.fromEvidence`][cap-map-fromEvidence] | Prepare an approximate map from actual retained lookup evidence. | Active; requires server-owned evidence with coordinates. |
| [`artifact.compose`][cap-artifact-compose] | Compose an editable brief, reading list or itinerary from selected records and optional research. | Active. |
| [`artifact.edit`][cap-artifact-edit] | Edit or save an artifact within the visitor session. | Active. |
| [`artifact.open`][cap-artifact-open] | Reopen a retained editable artifact. | Active. |
| [`artifact.export`][cap-artifact-export] | Export authorized published artifact content as Markdown. | Active. |
| [`demo.cart`][cap-demo-cart] | Set synthetic item quantities using fixed fixture prices. | Demo only; no real inventory or merchant. |
| [`demo.quote`][cap-demo-quote] | Estimate a synthetic cart with fixture tax and delivery/pickup costs. | Demo only; no real tax quote. |
| [`demo.availability`][cap-demo-availability] | Retrieve synthetic time-zone-labelled slots. | Demo only; no live availability. |
| [`demo.booking`][cap-demo-booking] | Prepare an expiring booking draft for a synthetic slot. | Demo only. |
| [`demo.confirm`][cap-demo-confirm] | Confirm the exact reviewed synthetic draft by its current ID and hash. | Demo only; not a real transaction capability. |
| [`demo.status`][cap-demo-status] | Reconcile a synthetic outcome using the original operation ID. | Demo only. |

## Realtime voice and shared GPT-Live

The delivery rows below are **L / active**, except the explicitly marked shared defaults/backend. `thinking` and `commentary` messages can carry first-party guidance, operational observations or quoted data; their classification is stated rather than treating every model-visible string as a system prompt.

| Unit / source | One-line purpose | Provider field / dynamic source |
| --- | --- | --- |
| [`visitorVoiceInstructions`][voice-session-instructions] | Define Studio's visitor identity, listening, interruption and concrete backend-delegation policy. | Live session `instructions`; published site name, purpose, conversation preferences and search enablement select quoted values/branches. |
| [`LIVE_INSTRUCTIONS`][live-default] | Supply generic listening and substantive-task delegation defaults for shared consumers. | Compatibility/shared default in `liveSessionConfig`; Studio **replaces**, rather than appends, it with `visitorVoiceInstructions`. |
| [`runLiveBackend` suffix][shared-backend-instructions] | Wrap a shared caller's instructions with concise voice-backend and untrusted-context rules. | B / Responses instructions / compatibility; caller instructions and tools are dynamic, and Studio has no active app caller. |
| [Shared runtime `start`][live-start] | Allow listening and responses once the application is ready. | `session.instructions.append`; fixed message. |
| [Shared runtime `interrupt`][live-interrupt] | Stop the superseded answer and use changed application context. | `session.instructions.append`; fixed message. |
| [No-user-transcript recovery][live-repeat] | Ask the caller to repeat a request when delegation has no user transcript. | `session.commentary.append`; fixed recovery text. |
| [Backend failure recovery][live-failure] | Supply the classified failure and available recovery options for speech. | `session.commentary.append`; `liveTaskFailureMessage` result plus fixed suffix, not new factual evidence. |
| [Voice correction interruption][voice-interrupt] | Replace cancelled work with the latest substantive speech without announcing cancellation. | `session.instructions.append`; selected for voice-origin interruption. |
| [Opening interruption][voice-opening-interrupt] | End the introduction permanently and listen to the complete visitor request. | `session.instructions.append`; selected when fresh user speech interrupts opening. |
| [Quiet request][voice-quiet] | Stop speech while allowing the existing backend task to continue. | `session.instructions.append`; selected by the quiet-intent branch. |
| [Fresh speech after manual interaction][voice-resume] | Re-enable normal delegation for a new request after cancelling the prior answer. | `session.instructions.append`; emitted once for fresh speech after manual interruption. |
| [Reconnect instruction][voice-reconnect] | Wait for fresh speech instead of replaying earlier or unfinished work. | `session.instructions.append`; selected when supplied history is nonempty. |
| [Earlier-dialogue wrapper][voice-history] | Mark resumed history as untrusted reference context rather than pending requests. | `session.thinking.append`; indexed serialized history entries. |
| [Conversation memory update][voice-memory] | Keep prior external findings available independently of current visibility without starting speech or work. | Separate acknowledged `memory` context channel; server-owned projection with sources, dates, qualifications and recall metadata. |
| [Concurrent-conversation instruction][voice-conversation] | Separate listening, small talk, status, delegation and task cancellation. | `session.instructions.append`; fixed startup instruction referring to configured preferences. |
| [Greeting delivery branches][voice-greeting] | Deliver approved points or welcome text briefly, in the selected language, and yield to speech. | `session.instructions.append`; greeting-point presence and `conversationLanguage(content, true)` select the branch. |
| [`getWelcomeMessage`][welcome-content] | Supply the actual approved points, custom welcome text or default introduction to speak. | `session.commentary.append` content data; published greeting points, welcome text, site name and catalog references, not a policy override. |
| [Voice backend `guide`][voice-guide] | Select active surface guidance or retained workspace/catalog/source procedures for the delegated request. | V / Responses instructions; purpose/preferences, current request, published authority and validated context select the branch. |
| [Voice `knowledgeGuide`][voice-knowledge] | Preserve published/general/external evidence boundaries and explain missing retained evidence. | V / Responses instructions; focused subject, server web evidence and retained research are serialized reference data. |
| [Voice `searchGuide`][voice-search] | Explain enabled search/annotation and reuse of existing result navigation. | V / Responses instructions; search callback, publisher permissions and current external result view select enabled/disabled guidance. |
| [Voice round callback][voice-round] | Refresh task/view guidance and completed dialogue while preventing interrupted work from becoming a backlog. | V / Responses instructions; task bridge and `guide(latestRequest)` plus a fixed history/latest-request policy; recent completed dialogue remains untrusted context. |
| [Idle task-state message][voice-idle] | Report that no backend request is running without inventing completed outcomes. | `session.thinking.append`; emitted on busy-to-idle transition. |
| [Status reply][voice-status] | Answer a status question using the actual backend busy state. | `session.commentary.append`; one of two fixed status strings. |
| [Task-start state][voice-task-start] | Allow ordinary conversation while the current backend request continues. | `session.thinking.append`; fixed delegated-work state. |
| [Delayed acknowledgment][voice-acknowledgment] | Acknowledge ongoing work only if the current request is still unacknowledged. | `session.commentary.append`; fixed text guarded by existing timing/cancellation state. |
| [Tool-progress state][voice-tool-progress] | Identify search or another tool step without claiming completion. | `session.thinking.append`; tool name selects one of two fixed strings. |
| [Display-confirmed state][voice-display-confirmed] | Distinguish an acknowledged display step from completion of all requested work. | `session.thinking.append`; emitted only after an applied result. |
| [Verified and final result forwarding][voice-result] / [shared forwarding][live-result] | Deliver confirmed result/answer text to the speaking model. | `session.commentary.append`; dynamic validated tool/direct/backend text, not an additional authored instruction policy. |

### Live screen/context wrappers

All rows use [reportScreen][voice-screen] → [createVisitorLiveContext][live-context] → `session.thinking.append` on L. The fixed wrapper describes the authority of dynamic data; it does not turn publisher or browser content into instructions.

| Unit / source | One-line purpose | Dynamic source / branch |
| --- | --- | --- |
| [Acknowledged view wrapper][screen-view] | Replace earlier visibility while keeping content-version and photo-identity limits explicit. | Active surface state, region references, photo descriptions and media observations. |
| [Reference content wrapper][screen-content] | Bind complete published facts to a content version while separating displayed answers from evidence. | Active surface references, answer presentation and server-resolved published facts. |
| [Reading-position wrapper][screen-reading] | Label scroll/reading position as a presentation observation. | Active surface ID and reading state. |
| [Hidden-surface message][screen-hidden] | Explain that retained cards are hidden and current facts/actions require the backend. | Active closed-surface branch; fixed text. |
| [Retained carousel wrapper][screen-carousel] | Label the current active card and navigation/media state as reference data. | Compatibility branch without a surface snapshot. |
| [Retained workspace wrapper][screen-workspace] | Distinguish open objects from actual visibility and combine one screen update consistently. | Compatibility workspace/scene branch without carousel context. |
| [Multipart context prefix][live-context-prefix] | Identify channel, generation and ordered parts of one context snapshot. | Dynamic transport labels for screen/content/reading; no independent task or policy is introduced. |

## External search instructions

All rows follow **S / active opt-in / Luna Responses**. The provider's hosted `web_search` implementation is external; the repository selects its options but does not contain its internal prompt.

| Unit / source | One-line purpose | Channel / dynamic inputs |
| --- | --- | --- |
| [Map overview branch][search-map] | Select an approximate named-place viewport without claiming address verification or navigation. | Responses instructions; used only when no local map preset matches, with visitor query as user data. |
| [Image search branch][search-images] | Request actual hosted image results rather than invented URLs or a text-only substitute. | Responses instructions; query and image-search options, publisher domain/image permissions. |
| [Web search branch][search-web] | Produce a brief cited answer from one hosted web search without adopting source instructions. | Responses instructions; query and publisher domain permissions. |
| [Published-card annotation wrapper][search-subject] | Keep external enrichment tied to the card's identity without rewriting publisher facts. | User input; present only with `options.subject`, followed by serialized subject and visitor question. |

## What is data, not a first-party instruction definition

- [Editor context][editor-context], extracted documents, source anchors, imported web content, image pixels/metadata, catalog entities/facts/blocks, labels, captions, tool outputs and external findings are reference data. Their inclusion in a JSON-bearing instruction string does not give embedded requests authority. Publisher purpose and delivery preferences are intentional bounded guidance only through the named builders above.
- Visitor/owner request text is runtime user input. Conversation history, transcript fragments, scene geometry and prior answer prose are context, not fresh system instructions. `runVisitorTask` and `runLiveBackend` serialize context into user messages and append validated tool results as `function_call_output`; `liveSessionConfig(history)` also supports bounded user/assistant history for shared callers, while Studio starts it with no history and uses its explicit reconnect wrappers.
- [Task record projection][record-projection], `catalogPresentationContext`, `surfacePublishedFacts`, published-text retrieval and research retention build/trim data, not separate prompt policies. Capability **purpose** and the inserted **records schema description** are the exceptions itemized above.
- Zod/JSON schemas, enums and function signatures constrain model output and tool arguments; they are linked through their consumers and were not rewritten. The scan found no additional first-party `.describe(...)` prompt text in the shared package; its `purpose` field is a schema definition, not a prompt instance.
- UI placeholders, suggested directions (`catalog.jobs`), onboarding/demo chat text, deterministic `demo-editor`, `demoVisitorReply`, `demoPresentation`, `planWorkspaceIntent`, `websiteQueryCommand`, `demoWebsiteQuery`, local photo suggestions, map presets and synthetic adapter outputs are not hidden model prompts. The retained `visitorVoiceReply` rejects the removed one-shot voice route rather than calling a model.
- Source extraction/OCR adapters, website crawling/design extraction, shared OpenUI compilation/rendering and diagnostic/recorder scripts add no additional first-party model instructions found by this audit. Test/benchmark visitor utterances are exercise inputs. Generated recordings can contain captured prompts, but private recordings/data were not inspected or inventoried.

## Test coverage and historical implementation briefs

These links describe **existing test coverage**, not tests run for this comment-only task and not additional production behavior. Mock/injected transports and synthetic values do not establish live provider quality. Test files were not edited.

| Test source | Prompt-related coverage / classification |
| --- | --- |
| [GPT-Live tests][test-live] | Test-only caller instructions (`Use only validated facts.`, `Complete the requested task.`, empty instructions and a changing workspace-revision template), dummy tool descriptions, shared config and sequencing assertions. |
| [Voice responsiveness][test-responsiveness] / [speed][test-speed] | Test-only `Published facts only.` or empty instructions and dummy tools exercise stream timing/cancellation/effort behavior. |
| [Task integration][test-task-integration] / [context size][test-task-size] | Synthetic callback instructions or the real bridge builder are delivered to mocked tasks to inspect bounds, cancellation and refreshed context. |
| [Published content][test-published-content] | Real workspace instructions and read-tool descriptions are inspected with synthetic publications and mocked Responses. |
| [Carousel][test-carousel] / [information surface][test-surface] | Test-only `Test`/empty instructions, synthetic image labels and dummy tools exercise image/context refresh and display state. |
| [Voice settings][test-voice-settings] | Real purpose/language/delivery builders are checked against synthetic publisher settings and mocked request bodies. |
| [Realtime session][test-session] / [control][test-control] / [context delivery][test-live-context] | Captured fake session/socket bodies check delegation, greeting, interruption, state and multipart context behavior. |
| [Typed context][test-typed] / [catalog presentation][test-catalog] / [workspace tools][test-workspace] | Real compatibility/workspace guides and trust boundaries are inspected; hostile extra `instructions` fields are rejection input. |
| [Semantic provider][test-semantic] / [media provider fixture][test-media] / [explore][test-explore] | Injected interpretation callbacks, provider mocks and schema/image-search assertions cover source boundaries; they are not alternate production policies. |
| [Recording][test-recording] / [QA budget][test-qa] | Test-only instruction placeholders and a deliberately oversized instruction string exercise capture/redaction and reservation limits through mocks. |
| [Diagnostics][test-diagnostics] / [control-route boundary][test-control-route] | Hostile or sensitive-looking synthetic `instructions` fields exercise omission/rejection; they are never approved prompt sources. |
| [Synthetic prose fixture][fixture-injection] | An explicit malicious instruction in publisher prose is untrusted test data used to exercise review/action boundaries. |

Historical implementation instructions belong to developer tasks, not Studio's model runtime:

| Source | One-line purpose / status |
| --- | --- |
| [Semantic-graph Codex prompt](codex-prompt-stronger-semantic-graph.md) | Historical copy/paste brief for extending semantic ingestion and review; not imported by application code. |
| [Visitor-task Codex prompt](visitor-task-system/codex-prompt.md) | Historical implementation brief for the visitor task system; not a visitor/owner model prompt. |
| [Astra sequence](astra-implementation-plan/README.md) and [semantic](astra-implementation-plan/01-semantic-knowledge.md), [workspace](astra-implementation-plan/02-adaptive-workspace.md), [integration](astra-implementation-plan/03-integration-review.md) assignments | Historical coordinated developer work briefs, not runtime instructions or authority to perform their work now. |
| [AGENTS.md](../AGENTS.md) / [CLAUDE.md](../CLAUDE.md) | Repository contributor guidance for coding agents; separate from product model requests. |

## Scan scope, verification and genuine gaps

The scan covered first-party TypeScript/JavaScript in `app/`, `lib/` (including `lib/gpt-live/`), `components/`, `packages/platform-ui/src/`, `scripts/`, root/public scripts and configuration, plus prompt-related tests, synthetic fixtures and Markdown documentation. It combined provider/transport searches, instruction and tool/schema searches, TypeScript literal/capability-call inspection, and manual tracing of callers and conditional builders. This was not a single `prompt` regex inventory.

The starting snapshot captured **438 source/document/fixture files** plus Git status before editing. The resulting **91 added one-line comments in 26 source files** were checked against that snapshot: every original line remained in order, TypeScript syntax tokens matched, all **3,309 raw string/template tokens** in edited files matched, and in-memory executable output with comments removed matched. This preserves prompt bytes, schemas, ordering, models, endpoints, budgets and executable behavior relative to the captured checkout. Source links were resolved against the resulting files. Focused Node 24 syntax checks and ESLint on the commented files are the validation for this task; no shared-package/production build, test suite, server, browser or live provider session was run.

Boundaries requiring a separate future decision, if broader coverage is wanted:

- Runtime publisher settings, source contents, private files/recordings and deployed/provider-side prompts are not enumerated; only their first-party producers and trust boundaries are mapped. No secrets or environment files were read.
- The separate FlowPath repository and external consumers of the shared GPT-Live files were not audited. Shared helper reachability here is not proof of another application's current behavior.
- Dependencies, generated `dist`/`.next` output and hosted model/search internals are outside first-party ownership. Existing OCR injection/managed-service implementations outside this checkout cannot be inventoried here.
- This is a point-in-time source inventory, not a runtime prompt editor or automatic drift detector. Future changes to request builders, conditional policy branches, tool descriptions, capability purposes or Live appends need a corresponding inventory update. No unresolved first-party model transport was found within the stated scan scope; live behavior was deliberately not tested.

<!-- Source references resolved against the audited working checkout. -->
[editor-route]: ../app/api/sites/%5BsiteId%5D/route.ts#L54
[editor-dispatch]: ../lib/chat-editor.ts#L12
[editor-call]: ../lib/ai-editor.ts#L70
[knowledge-route]: ../app/api/sites/%5BsiteId%5D/knowledge/route.ts#L48
[ingestion-builder]: ../lib/ingestion.ts#L257
[photo-route]: ../app/api/sites/%5BsiteId%5D/media/interpret/route.ts#L8
[photo-builder]: ../lib/media-interpretation.ts#L104
[chat-route]: ../app/api/visitor/%5Bslug%5D/route.ts#L92
[chat-builder]: ../lib/visitor-chat-task.ts#L35
[runner]: ../lib/visitor-task-runner.ts#L27
[chat-fallback]: ../lib/visitor-provider.ts#L67
[voice-control]: ../lib/visitor-realtime-control.ts#L78
[session-route]: ../app/api/visitor/%5Bslug%5D/session/route.ts#L99
[session-builder]: ../lib/visitor-realtime-session.ts#L81
[response-socket]: ../lib/visitor-response-connection.ts#L14
[live-runtime]: ../lib/gpt-live/runtime.ts#L35
[live-context]: ../lib/visitor-live-context.ts#L11
[search-service]: ../lib/explore-service.ts#L17
[explore-route]: ../app/api/visitor/%5Bslug%5D/explore/route.ts#L14
[search-builder]: ../lib/explore-provider.ts#L100
[shared-backend]: ../lib/gpt-live/backend.ts#L14
[editor-instructions]: ../lib/ai-editor.ts#L21
[editor-input]: ../lib/ai-editor.ts#L84
[semantic-base]: ../lib/ingestion.ts#L270
[semantic-related]: ../lib/ingestion.ts#L283
[website-brief]: ../lib/website-content.ts#L60
[semantic-correction]: ../lib/ingestion.ts#L287
[photo-instructions]: ../lib/media-interpretation.ts#L135
[knowledge-policy]: ../lib/visitor-knowledge-context.ts#L5
[assistant-purpose]: ../lib/visitor-model.ts#L56
[conversation-language]: ../lib/voice-settings.ts#L59
[conversation-instructions]: ../lib/voice-settings.ts#L65
[workspace-instructions]: ../lib/visitor-workspace.ts#L336
[surface-instructions]: ../lib/visitor-carousel-control.ts#L24
[carousel-instructions]: ../lib/visitor-carousel-control.ts#L29
[chat-instructions]: ../lib/visitor-chat-task.ts#L95
[runner-instructions]: ../lib/visitor-task-runner.ts#L49
[active-image]: ../lib/visitor-active-image.ts#L57
[fallback-guide]: ../lib/visitor-provider.ts#L72
[fallback-source]: ../lib/visitor-provider.ts#L19
[fallback-catalog]: ../lib/visitor-provider.ts#L37
[presentation-instructions]: ../lib/site-presentation.ts#L52
[catalog-instructions]: ../lib/catalog-presentation.ts#L165
[task-guidance]: ../lib/visitor-task-bridge.ts#L103
[task-projection]: ../lib/visitor-task-bridge.ts#L105
[task-record-schema]: ../lib/visitor-task-bridge.ts#L44
[task-tool]: ../lib/visitor-task-bridge.ts#L76
[published-content-tool]: ../lib/visitor-published-content.ts#L7
[answer-tool]: ../lib/visitor-answer-composition.ts#L5
[carousel-tool]: ../lib/visitor-carousel-control.ts#L11
[chat-tools]: ../lib/visitor-chat-task.ts#L80
[voice-surface-tools]: ../lib/visitor-realtime-control.ts#L232
[voice-compat-tools]: ../lib/visitor-realtime-control.ts#L233
[voice-navigation-tool]: ../lib/visitor-realtime-control.ts#L234
[explore-tool]: ../lib/explore-voice.ts#L13
[task-feedback]: ../lib/visitor-task-bridge.ts#L114
[chat-query-feedback]: ../lib/visitor-chat-task.ts#L114
[voice-query-feedback]: ../lib/visitor-realtime-control.ts#L271
[task-schemas]: ../lib/visitor-task-bridge.ts#L39
[cap-query-command]: ../lib/visitor-capabilities.ts#L56
[cap-publisher-links]: ../lib/visitor-capabilities.ts#L58
[cap-task-clarify]: ../lib/visitor-capabilities.ts#L60
[cap-presentation-show]: ../lib/visitor-capabilities.ts#L62
[cap-records-search]: ../lib/visitor-capabilities.ts#L67
[cap-records-filter]: ../lib/visitor-capabilities.ts#L69
[cap-selection-fromRecords]: ../lib/visitor-capabilities.ts#L75
[cap-schema-describe]: ../lib/visitor-capabilities.ts#L80
[cap-collection-page]: ../lib/visitor-capabilities.ts#L82
[cap-query-close]: ../lib/visitor-capabilities.ts#L84
[cap-query-create]: ../lib/visitor-capabilities.ts#L86
[cap-query-patch]: ../lib/visitor-capabilities.ts#L88
[cap-query-activate]: ../lib/visitor-capabilities.ts#L97
[cap-view-back]: ../lib/visitor-capabilities.ts#L101
[cap-view-reset]: ../lib/visitor-capabilities.ts#L110
[cap-query-page]: ../lib/visitor-capabilities.ts#L118
[cap-selection-modify]: ../lib/visitor-capabilities.ts#L120
[cap-selection-compare]: ../lib/visitor-capabilities.ts#L131
[cap-records-lookup]: ../lib/visitor-capabilities.ts#L139
[cap-record-detail]: ../lib/visitor-capabilities.ts#L144
[cap-reference-resolve]: ../lib/visitor-capabilities.ts#L153
[cap-home]: ../lib/visitor-capabilities.ts#L160
[cap-research-lookup]: ../lib/visitor-research.ts#L16
[cap-research-recall]: ../lib/visitor-research.ts#L21
[cap-research-history]: ../lib/visitor-research.ts#L25
[cap-map-fromEvidence]: ../lib/visitor-research.ts#L29
[cap-artifact-compose]: ../lib/visitor-task-extensions.ts#L20
[cap-artifact-edit]: ../lib/visitor-task-extensions.ts#L29
[cap-artifact-open]: ../lib/visitor-task-extensions.ts#L38
[cap-artifact-export]: ../lib/visitor-task-extensions.ts#L40
[cap-demo-cart]: ../lib/visitor-task-extensions.ts#L46
[cap-demo-quote]: ../lib/visitor-task-extensions.ts#L51
[cap-demo-availability]: ../lib/visitor-task-extensions.ts#L53
[cap-demo-booking]: ../lib/visitor-task-extensions.ts#L55
[cap-demo-confirm]: ../lib/visitor-task-extensions.ts#L57
[cap-demo-status]: ../lib/visitor-task-extensions.ts#L61
[voice-session-instructions]: ../lib/visitor-realtime-session.ts#L17
[live-default]: ../lib/gpt-live/protocol.ts#L6
[shared-backend-instructions]: ../lib/gpt-live/backend.ts#L26
[live-start]: ../lib/gpt-live/runtime.ts#L173
[live-interrupt]: ../lib/gpt-live/runtime.ts#L175
[live-repeat]: ../lib/gpt-live/runtime.ts#L110
[live-failure]: ../lib/gpt-live/runtime.ts#L121
[voice-interrupt]: ../lib/visitor-realtime-control.ts#L173
[voice-opening-interrupt]: ../lib/visitor-realtime-control.ts#L419
[voice-quiet]: ../lib/visitor-realtime-control.ts#L434
[voice-resume]: ../lib/visitor-realtime-control.ts#L447
[voice-reconnect]: ../lib/visitor-realtime-control.ts#L638
[voice-history]: ../lib/visitor-realtime-control.ts#L626
[voice-memory]: ../lib/visitor-realtime-control.ts#L102
[voice-conversation]: ../lib/visitor-realtime-control.ts#L635
[voice-greeting]: ../lib/visitor-realtime-control.ts#L647
[welcome-content]: ../lib/site-greeting.ts#L47
[voice-guide]: ../lib/visitor-realtime-control.ts#L219
[voice-knowledge]: ../lib/visitor-realtime-control.ts#L222
[voice-search]: ../lib/visitor-realtime-control.ts#L224
[voice-round]: ../lib/visitor-realtime-control.ts#L555
[voice-idle]: ../lib/visitor-realtime-control.ts#L404
[voice-status]: ../lib/visitor-realtime-control.ts#L459
[voice-task-start]: ../lib/visitor-realtime-control.ts#L492
[voice-acknowledgment]: ../lib/visitor-realtime-control.ts#L496
[voice-tool-progress]: ../lib/visitor-realtime-control.ts#L529
[voice-display-confirmed]: ../lib/visitor-realtime-control.ts#L536
[voice-result]: ../lib/visitor-realtime-control.ts#L481
[live-result]: ../lib/gpt-live/runtime.ts#L115
[voice-screen]: ../lib/visitor-realtime-control.ts#L100
[screen-view]: ../lib/visitor-realtime-control.ts#L120
[screen-content]: ../lib/visitor-realtime-control.ts#L121
[screen-reading]: ../lib/visitor-realtime-control.ts#L125
[screen-hidden]: ../lib/visitor-realtime-control.ts#L131
[screen-carousel]: ../lib/visitor-realtime-control.ts#L135
[screen-workspace]: ../lib/visitor-realtime-control.ts#L147
[live-context-prefix]: ../lib/visitor-live-context.ts#L26
[search-map]: ../lib/explore-provider.ts#L115
[search-images]: ../lib/explore-provider.ts#L117
[search-web]: ../lib/explore-provider.ts#L118
[search-subject]: ../lib/explore-provider.ts#L120
[editor-context]: ../lib/ai-editor.ts#L27
[record-projection]: ../lib/visitor-task-record-context.ts#L15
[test-live]: ../tests/gpt-live.test.ts#L1
[test-responsiveness]: ../tests/voice-responsiveness.test.ts#L1
[test-speed]: ../tests/visitor-speed.test.ts#L1
[test-task-integration]: ../tests/visitor-task-integration.test.ts#L1
[test-task-size]: ../tests/visitor-task-context-size.test.ts#L1
[test-published-content]: ../tests/visitor-published-content.test.ts#L1
[test-carousel]: ../tests/ai-carousel.test.ts#L1
[test-surface]: ../tests/information-surface.test.ts#L1
[test-voice-settings]: ../tests/voice-settings.test.ts#L1
[test-session]: ../tests/visitor-realtime-session.test.ts#L1
[test-control]: ../tests/visitor-realtime-control.test.ts#L1
[test-live-context]: ../tests/visitor-live-context.test.ts#L1
[test-typed]: ../tests/visitor-typed-context.test.ts#L1
[test-catalog]: ../tests/catalog-presentation.test.ts#L1
[test-workspace]: ../tests/visitor-workspace-tools.test.ts#L1
[test-semantic]: ../tests/semantic-provider.test.ts#L1
[test-media]: ../tests/helpers/media-provider.fixture.ts#L1
[test-explore]: ../tests/explore.test.ts#L1
[test-recording]: ../tests/visitor-test-recording.test.ts#L1
[test-qa]: ../tests/visitor-qa-budget.test.ts#L1
[test-diagnostics]: ../tests/visitor-diagnostics.test.ts#L1
[test-control-route]: ../tests/visitor-realtime-control-route.test.ts#L1
[fixture-injection]: ../fixtures/semantic-knowledge/prose.txt#L8
