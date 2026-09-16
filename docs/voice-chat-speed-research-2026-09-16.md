# Voice and chat speed research — FlowPath Studio

September 16, 2026 · Current working checkout · Research and recommendations

Implementation follow-up: [completed application changes, local evidence, and remaining live experiments](voice-chat-speed-implementation-2026-09-16.md). The findings below describe the pre-implementation research snapshot.

The best next step is to shorten the path between a request, verified information, and its first useful display. The current system already has a fast voice frontend, a reused backend connection, indexed knowledge, and some deterministic commands. The remaining opportunities are largely in orchestration: unnecessary model passes, repeated data preparation, full-response buffering, and multiple display-confirmation round trips.

My recommendation is to keep the present GPT-Live architecture initially, improve those paths, and add a persistent indeterminate loader with accurate stage text. Compare provider or architecture alternatives after measuring the remaining delay. This should be cheaper and less disruptive than beginning with a model or database migration; the expected end-to-end gains still need measurement.

**Evidence:** “Confirmed” below means inspected in current source. “Measured” means the small, synthetic local benchmark described below. Recommendations and expected benefits are not measured improvements. No application implementation was changed, no paid API was called, and no microphone, signed-in browser, production service, or deployment was tested.

## Priority order

| Priority | Recommendation | Expected benefit | Effort / main tradeoff |
| --- | --- | --- | --- |
| 1 | Measure click-to-ready, request-to-visible-result, and request-to-useful-speech separately; add an explicit working indicator from the first click | Reveals the real bottleneck and removes unexplained waiting | Small–medium; metadata only |
| 2 | Remove redundant answer-writing calls when a verified lookup or simple display already completes the request | Removes a whole model round trip on eligible requests; likely lower cost | Medium; completion must be established for the whole request |
| 3 | Eliminate full catalog reconstruction during bounded record reads; reuse immutable prepared data | Faster knowledge details and first-use preparation; fewer storage reads | Medium; preserve publication authorization |
| 4 | Stream progress and release useful validated results before all narration is complete | Earlier visible information and earlier useful speech | Medium; distinguish partial results from completed actions |
| 5 | Consolidate duplicate display/scene acknowledgments and unnecessary answer-card confirmations | Less time between rendering and spoken confirmation | Medium; retain exact view, revision, and cancellation checks |
| 6 | Prepare nonbillable startup work earlier and overlap independent initialization | Faster first connection | Medium; microphone access remains tied to user intent; no speculative paid voice session |
| 7 | Reuse stable prompts, tool schemas, and prepared images; avoid unnecessary image search | Less processing, network payload, and duplicate work | Small–medium; recheck authority and freshness |
| 8 | Compare Luna `none` versus `low` reasoning for narrow tasks; test bounded concurrent reads | Potentially quicker routing and retrieval | Medium; quality and correctness must remain acceptable |
| 9 | Benchmark dedicated fast search or Fast mode only if provider time remains dominant | Potential additional speed | Separate experiment; new costs, dependencies, and quality tradeoffs |

Effort is relative implementation complexity, not a delivery estimate. The first implementation batch should cover priorities 1–3 plus truthful progress events; early-result streaming and acknowledgment consolidation can follow with stronger integration coverage.

## The actual system today

The current frontend model is **`gpt-live-1`**, with **`gpt-5.6-luna`** handling substantive backend work and **Marin** as the voice. This matters: generic suggestions to tune Realtime `semantic_vad`, shorten `silence_duration_ms`, or replace a speech-to-text → model → text-to-speech pipeline do not directly describe this app. Its voice connection is already continuous WebRTC, and GPT-Live handles conversation while application-owned backend work proceeds. [Model configuration](/Users/thomasdevito/Projects/theVoice/lib/gpt-live/protocol.ts:2)

There are two important latency boundaries:

- **Information latency:** when useful text, a card, or a result becomes visible or audible.
- **Completion latency:** when the requested operation and its necessary confirmations are complete.

An early “I’m working on that” improves feedback but does not reduce information latency. Measure both. The official voice evaluation guidance makes the same distinction between first audio, backend completion, and useful spoken results. [OpenAI voice evaluation guidance](https://developers.openai.com/api/docs/guides/voice-agents#measure-latency)

A general web lookup can currently follow this path; simple deterministic commands take a shorter route:

```mermaid
flowchart LR
  A[Visitor request] --> B[GPT-Live delegates]
  B --> C[Luna selects a tool]
  C --> D[Separate Luna web-search request]
  D --> E[Validate and display results]
  E --> F[Browser confirms display]
  F --> G[Luna writes final answer]
  G --> H[Answer card and confirmation]
  H --> I[Return answer to GPT-Live]
  I --> J[Useful spoken response]
```

That path can contain **three Luna requests**: tool selection, hosted search plus its answer, and final synthesis. A capability-based research request may need additional steps to display retained evidence. This is a code-derived possible execution path, not a recording of a live request. [Task loop](/Users/thomasdevito/Projects/theVoice/lib/visitor-task-runner.ts:19), [search request](/Users/thomasdevito/Projects/theVoice/lib/explore-provider.ts:119), [voice completion](/Users/thomasdevito/Projects/theVoice/lib/visitor-realtime-control.ts:422)

Several useful optimizations already exist and should be retained:

- Voice lazily creates one Responses WebSocket and reuses it, including compatible `previous_response_id` continuations. It does not open a new connection for every backend round. [Connection owner](/Users/thomasdevito/Projects/theVoice/lib/visitor-response-connection.ts:15)
- Voice and chat already bypass the model for some clear navigation and filtering commands. Expand only where evidence shows an important uncovered case. [Voice shortcuts](/Users/thomasdevito/Projects/theVoice/lib/visitor-realtime-control.ts:417), [chat shortcuts](/Users/thomasdevito/Projects/theVoice/components/VisitorAssistant.tsx:350)
- Web search already uses low search context, low reasoning, one hosted search per search request, and publisher domain restrictions. Merely enabling these settings would not be a new improvement. [Search configuration](/Users/thomasdevito/Projects/theVoice/lib/explore-provider.ts:133)
- Work state is separate from listening and speaking; the browser keeps `working` true while accepted work runs. A delayed acknowledgment is submitted after 350 ms if the request remains pending. [Work state](/Users/thomasdevito/Projects/theVoice/lib/use-visitor-session.ts:342), [acknowledgment](/Users/thomasdevito/Projects/theVoice/lib/visitor-realtime-control.ts:397)

## Faster voice startup

The current order is: prepare the visitor task session → prepare audio → request microphone → create offer and gather ICE candidates → request the application session → authorize and load published context → create the Live session → attach its server control connection and negotiate browser audio → send browser readiness → accept the readiness update → start conversation/greeting. The SDP answer is already sent while the server sideband attaches, allowing useful overlap. [Start handler](/Users/thomasdevito/Projects/theVoice/components/VisitorAssistant.tsx:433), [browser setup](/Users/thomasdevito/Projects/theVoice/lib/use-visitor-session.ts:207), [server setup](/Users/thomasdevito/Projects/theVoice/lib/visitor-realtime-session.ts:127)

**Begin visible feedback before task preparation.** `startVoice()` awaits `tasks.settle()` before entering `liveVoice.start()`, where `connecting` is set. A cold task initialization therefore precedes the explicit voice-connecting state. Show “Preparing voice…” immediately when the user taps, keep Cancel available, then advance to actual connection stages. Include that preparation time in startup diagnostics; the existing session start timer begins afterward.

**Prepare published context before the critical click where appropriate.** Warm the public task context and immutable index when voice intent becomes clear, such as focusing its control, or after the page has idle capacity. Bound this work and reuse one pending initialization. Do not create a paid Live session or acquire the microphone simply because a page loaded. Preparation may still consume application compute or database reads, so measure its hit rate and wasted work.

**Overlap independent local work after the gesture.** Audio preparation and microphone acquisition can potentially overlap with task preflight rather than following it. Start gesture-sensitive audio preparation synchronously, but keep paid session creation behind successful preflight and authorization. Release tracks and pending work on cancellation or failure. This needs Safari/iOS verification; it is not a promise that all initialization steps are independent.

**Keep complete ICE gathering unless the actual GPT-Live transport supports a validated alternative.** The app's 10-second ICE timeout is a failure ceiling, not a fixed 10-second wait. The current official Live WebRTC example also waits for ICE gathering to complete. Removing that wait based on examples for another API would be a reliability gamble. Measure its actual duration first. [ICE implementation](/Users/thomasdevito/Projects/theVoice/lib/gpt-live/browser.ts:44), [official Live WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)

**Separate connection readiness from microphone readiness on iOS.** The app protects the automatic opening greeting by muting cloned outbound tracks for two seconds after observed output, with a ten-second escape when output never starts. This does not inherently delay first greeting audio; it can delay the visitor's ability to interrupt or speak. Show the true input state, and measure “ready to hear you” separately. Tune that guard only with physical-device echo and interruption tests. The 1.2-second output-quiet heuristic also affects resuming after interruption; it is not provider end-of-turn detection. [Audio safeguards](/Users/thomasdevito/Projects/theVoice/lib/gpt-live/browser.ts:4)

**Do not hide a paid connection behind page preloading.** Official documentation states that creating a Live WebRTC session incurs a 15-second initialization charge credited toward the running session. Keeping unused sessions alive can also cost money. Prefer earlier nonvoice preparation and reuse an already active session under existing inactivity limits. [Live session cost behavior](https://developers.openai.com/api/docs/guides/voice-latency-cost?api=live)

## Faster useful answers and display

**Remove unnecessary synthesis after a completed lookup.** When a simple request is fully satisfied by a validated result and confirmed display, provide its concise facts directly to GPT-Live. The frontend can phrase those facts naturally. The task runner already supports `directText`; the general search path normally returns tool data and reenters the model. Do not use this shortcut for an unfinished comparison, compound request, unsupported claim, or explanation that still needs reasoning. [Direct-return support](/Users/thomasdevito/Projects/theVoice/lib/visitor-task-runner.ts:76), [search tool completion](/Users/thomasdevito/Projects/theVoice/lib/visitor-realtime-control.ts:245)

**Release verified information as it becomes usable.** The voice WebSocket sees text and function-argument deltas, but currently uses them only to record first-output timing. The task resolves when the provider response completes. Chat's backend waits for a complete HTTP response, and its browser protocol streams navigation plus a final `done` event, not incremental answer text. An open streaming connection therefore does not mean the visitor receives streaming answers. [WebSocket handling](/Users/thomasdevito/Projects/theVoice/lib/visitor-response-connection.ts:41), [HTTP buffering](/Users/thomasdevito/Projects/theVoice/lib/visitor-task-runner.ts:44), [chat event contract](/Users/thomasdevito/Projects/theVoice/lib/visitor-chat-protocol.ts:5)

Add an explicit distinction between progress, provisional answer text, verified result chunks, and terminal completion. Chat can render suitable answer chunks progressively. Voice should receive coherent verified facts rather than token-by-token speech updates. Never execute partial tool arguments, render incomplete structural JSON, forward private reasoning, or announce display success before its receipt. Preserve generation IDs so corrections invalidate old chunks. The official APIs support HTTP streaming and bounded Live commentary/thinking appends; the application still owns validation and cancellation. [Streaming responses](https://developers.openai.com/api/docs/guides/streaming-responses), [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation#reduce-backend-latency)

**Let information retrieval and presentation overlap where their dependencies permit.** Once verified facts exist, the UI can begin rendering while the voice frontend prepares a factual explanation. An answer about a policy need not wait for decorative animation to finish. A statement such as “I opened that card” still must wait for confirmed display. This is a change to the completion contract, not simply deleting an `await`.

**Avoid a second display just to finish speaking.** In carousel mode, the voice controller sends a final answer-card navigation and waits for its acknowledgment before returning the result to Live. Review whether every operation needs this card. A request to open an item often has an adequate confirmed item view already. If an explanatory answer card is necessary, display it progressively and avoid repeating an equivalent confirmation. [Final answer-card gate](/Users/thomasdevito/Projects/theVoice/lib/visitor-realtime-control.ts:446)

**Keep ordinary speech short and useful.** The voice backend already requests at most 75 words. Lead with the useful answer and let the card hold detail. Do not simply slash `max_output_tokens`: the caps also have to fit reasoning and valid tool output, and an incomplete response can be slower for the user because it fails. Fewer requests and less unnecessary generated text are better initial targets than trimming essential context. [OpenAI latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization)

## Faster access to the site's own knowledge

The app uses a bounded publication index with lexical postings, record maps, scope membership, and typed predicates. It already caches compiled indexes and exact result pages. It is not sending every lookup to an external vector database. [Index and cache](/Users/thomasdevito/Projects/theVoice/lib/catalog-query-index.ts:37), [result cache](/Users/thomasdevito/Projects/theVoice/lib/catalog-query.ts:143)

I ran an offline microbenchmark using the repository's synthetic media-archive fixture, Node 24.6.0, and the local Apple M3. Each query case had five warmup calls and 50 measured calls. Index construction had five samples. The compound query selected records above the halfway numeric value with a true Boolean field, then sorted descending; the facet case additionally calculated Boolean and enum facets.

| Operation | 100 records, median | 1,000 records, median | 10,000 records, median | 10,000 records, p95 |
| --- | ---: | ---: | ---: | ---: |
| Build index from in-memory fixture | 4.40 ms | 18.26 ms | 171.14 ms | Not estimated from five samples |
| Unfiltered browse evaluation | 0.09 ms | 0.30 ms | 3.31 ms | 4.19 ms |
| Exact-token text lookup | 0.06 ms | 0.12 ms | 0.95 ms | 1.06 ms |
| Two filters and numeric sort | 0.54 ms | 4.09 ms | 52.63 ms | 54.76 ms |
| Same query plus two facets | 0.72 ms | 8.12 ms | 85.17 ms | 92.57 ms |
| Cached first result page | 0.07 ms | 0.08 ms | 0.45 ms | 0.52 ms |

These are **function timings**, not database, server-route, UI, voice, or production timings. Fixtures have three assertions per record, short summaries, no article bodies, and no images. They exclude storage, authorization, provider calls, contention, and cold process startup. The 10,000-record index's internal estimated size was 19,514,955 bytes (18.61 MiB); that is not measured heap or total RSS. [Raw measurement data](/Users/thomasdevito/Projects/theVoice/docs/research-evidence/voice-latency-catalog-benchmark-2026-09-16.json)

The practical conclusion is that basic warm matching can be very fast. Investigate the work around retrieval before buying or building a replacement search service.

| Confirmed opportunity | Recommended change | Why it matters |
| --- | --- | --- |
| The v2 bounded `records()` path calls `repository.index()` to identify stored records; that method reads index chunks and compiles the index again | Retain a publication-bound record-ID set or reusable repository index; load only requested record chunks | A one-record detail read should not rebuild the whole catalog |
| Cold task initialization loads compact index chunks, recompiles an augmented publication, then reads full record chunks to index prose | Prepare reusable lexical derivatives during publication; cache immutable manifests and bounded chunks | Moves expensive preparation away from a visitor's first request |
| Chunk reads in repository index/reading construction are sequential | Consider a small bounded concurrency limit for independent immutable chunk reads | Reduces storage round trips without unbounded fanout |
| Task context cache misses do not have a visible shared pending-build guard | Coalesce simultaneous builds per publication key; evict failed promises | Prevents several visitors from duplicating the same cold work |
| Legacy catalog hydration occurs before the task index cache lookup | Separate fresh publication authorization from immutable snapshot retrieval | Avoids repeating large immutable reads on warm operations |
| Task instructions directly reevaluate the query on each model round | Reuse exact revision-bound evaluations and cache static schema serialization | Avoids repeating filtering and prompt preparation |
| Sorting and facets call field projection repeatedly | Reuse projections within the same publication/query/as-of evaluation | Targets the measurable compound-query CPU cost |

Evidence: [task context](/Users/thomasdevito/Projects/theVoice/lib/visitor-task-context.ts:13), [record reads](/Users/thomasdevito/Projects/theVoice/lib/visitor-task-context.ts:37), [repository reads](/Users/thomasdevito/Projects/theVoice/lib/catalog-repository.ts:157), [instruction assembly](/Users/thomasdevito/Projects/theVoice/lib/visitor-task-bridge.ts:63), [query evaluation](/Users/thomasdevito/Projects/theVoice/lib/catalog-query.ts:111).

Cache immutable data by site, publication, and index revision. Keep current-publication authorization fresh; never cache quota decisions or treat old publication data as currently authorized. Exact counts, Boolean criteria, qualified facts, and stable ordering must survive these changes.

For larger unstructured knowledge, a persisted lexical index and bounded passage retrieval are sensible extensions. Hybrid semantic retrieval may improve paraphrase recall, but it adds indexing, embedding, and possibly reranking costs. Treat it as a relevance experiment, not an automatic speed upgrade. Use it for candidate passages; retain the exact query engine for exhaustive filtering and counts.

## Faster web search

The current provider reads and validates the whole search payload before returning it. `search_context_size: low`, a single hosted search, and low reasoning are already present. When image search is enabled for the site, ordinary web searches can also request images and captions. [Provider path](/Users/thomasdevito/Projects/theVoice/lib/explore-provider.ts:102)

Recommended changes, in order:

1. **Reuse existing relevant evidence.** The voice controller already retains some web findings and asks the backend to reuse them. Make deduplication explicit for an identical normalized query, subject, search kind, publisher restrictions, and freshness requirement. Start with per-session reuse. A short-lived shared cache requires careful privacy and freshness rules; personal queries should not leak across visitors.
2. **Avoid unnecessary search work.** Use text-only search for text questions; request images only when the intended experience needs them. Keep result payloads and summaries bounded. A question about published hours should use published knowledge, not search the web.
3. **Stream actual search lifecycle events.** Use provider search-start/searching/completed events to drive honest status. Once complete, independently validated sources are available, display them before an optional longer synthesis. A progress event alone is not a validated result list. The current parser requires a completed response, so staged parsing is real implementation work. [Search streaming event](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.web_search_call.in_progress)
4. **Avoid rewriting a search answer unnecessarily.** For straightforward questions, use the already grounded search result to inform Live and populate the UI. Retain synthesis when combining sources or answering a compound question requires it.
5. **Only parallelize independent, needed lookups.** Published knowledge and fresh web evidence can overlap when both are required and the subject is already resolved. Do not launch several speculative paid searches, race providers on every request, or run dependent actions concurrently. The current task runner deliberately accepts one tool call at a time, so changing the flag alone is insufficient.
6. **Use cached-only search selectively.** OpenAI exposes `external_web_access: false`, but this changes freshness behavior. It may fit stable background information; it does not satisfy a request for the latest information. It is not a general replacement for live search. [Web search controls](https://developers.openai.com/api/docs/guides/tools-web-search)

If these changes leave provider search as the largest delay, compare these alternatives on identical queries:

| Option | Potential advantage | Cost / UX tradeoff |
| --- | --- | --- |
| Current OpenAI hosted search, streamlined | Existing integration, citation handling, and publisher controls | Still includes model work around the hosted search |
| Direct Exa search using `fast` or `instant` | Retrieve sources without requiring an extra answer-generation stage | New provider; minimum-latency mode trades search depth for speed; application must assemble evidence and citations |
| Direct Tavily search using `fast` or `ultra-fast`, without an extra generated answer | Retrieve bounded snippets directly | New provider; depth/relevance tradeoffs; documented `safe_search` support differs for these modes |

These are documented options, **not benchmark winners**. Exa documents its latency-oriented search modes and optional synthesis; Tavily documents its depth choices and snippet controls. Compare text and image search separately, and include citation quality, publisher domain restrictions, freshness, safety requirements, errors, and total cost per useful answer. [Exa search reference](https://exa.ai/docs/reference/search), [Tavily search reference](https://docs.tavily.com/documentation/api-reference/endpoint/search)

## Rendering and acknowledgment overhead

The current carousel uses `AnimatePresence mode="wait"` with a 220 ms exit and a 220 ms entry transition. When both run, their nominal sequential duration is about 440 ms. Task display confirmation additionally has a **340 ms minimum** before accepting stable layout. These waits can overlap; do not add them together and call the sum measured latency. [Carousel transitions](/Users/thomasdevito/Projects/theVoice/components/VisitorWorkspace.tsx:247), [task confirmation](/Users/thomasdevito/Projects/theVoice/components/VisitorTasks.tsx:83)

A task view can then require an `ack` request, a viewport `scene` request, and the voice controller's `navigationAck` through its mailbox. Voice control submissions have a 150 ms minimum spacing; ordinary context updates are scheduled after 500 ms, while urgent updates take an immediate path after layout. A busy submission can delay another acknowledgment. The connected mailbox uses Firestore transactions and a snapshot listener rather than a direct browser-to-owner message. [Task receipt](/Users/thomasdevito/Projects/theVoice/components/VisitorTasks.tsx:105), [viewport synchronization](/Users/thomasdevito/Projects/theVoice/lib/use-task-viewport.ts:23), [control scheduling](/Users/thomasdevito/Projects/theVoice/lib/use-visitor-session.ts:179), [mailbox backend](/Users/thomasdevito/Projects/theVoice/lib/visitor-realtime-mailbox.ts:42)

Recommended direction:

- Make the first useful card visible immediately or with a short entrance while retaining an appropriate outgoing transition. Consider overlapping transitions if focus and accessibility behavior remain correct.
- Replace an unconditional delay with an observed completion condition when possible. Confirm the committed, visible card identity; preserve stricter geometry requirements for operations that actually depend on settled geometry.
- Combine the initial display receipt and matching viewport scene where the server can validate both atomically. Preserve subsequent viewport observations. Prioritize terminal action acknowledgments over routine audio-level/context traffic.
- Measure how much time comes from animation, browser scheduling, application HTTP, and mailbox storage before replacing the transport. An application-owned persistent control channel is a later option, with hosting and lifecycle costs.
- Render titles, text, and source links before images finish. Reserve image dimensions, prioritize the active image, and load adjacent images sparingly. Do not make useful text wait for every image, and do not claim an image is displayed until its own readiness condition is satisfied.
- Profile mobile main-thread work. The opening voice stage animates layout dimensions; the waveform samples audio and draws continuously. Favor transform/opacity for suitable animation, avoid unnecessary offscreen work, and preserve reduced motion. These are profiling candidates, not confirmed frame-rate defects. [Browser rendering guidance](https://web.dev/articles/animations-guide)

Inspect the shipped JavaScript bundle before changing code splitting. Defer optional viewers/maps and preload likely code on intent; do not defer the entire voice control until the click and create a new startup waterfall. The installed Next.js 16.3.4 lazy-loading guide documents the supported patterns. [Installed Next.js guide](/Users/thomasdevito/Projects/theVoice/node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md:1)

## The waiting experience

The current source has spoken acknowledgments, a persistent `working` state, a status line, and a changing waveform. The voice stage renders status text but does **not** contain a separate indeterminate spinner. Chat's streaming contract has no progress event. Older responsiveness notes should not be taken as proof that a dedicated loader remains in the current UI. [Voice stage](/Users/thomasdevito/Projects/theVoice/components/VisitorVoiceStage.tsx:8), [status wiring](/Users/thomasdevito/Projects/theVoice/components/VisitorAssistant.tsx:565), [chat events](/Users/thomasdevito/Projects/theVoice/lib/visitor-chat-protocol.ts:5)

Add one compact, persistent working indicator near the voice controls. Keep the waveform dedicated to listening/speaking and the indicator dedicated to background work; both may be active simultaneously. Use an indeterminate ring or subtle dots with one line of text. Preserve the existing useful content and leave browsing and cancellation available.

| Actual state/event | Suggested visible text | Behavior |
| --- | --- | --- |
| User taps voice; task preflight begins | “Preparing voice…” | Immediate feedback; Cancel available |
| Microphone permission is outstanding | “Allow microphone access to continue” | Respond to the actual permission state; do not imply a server is working |
| Session/transport setup is underway | “Connecting voice…” | Indeterminate indicator |
| Audio and outbound input are genuinely ready | “Listening” | End the startup indicator |
| Accepted request, route not yet established | “Working on your request…” | Persist across listening and speaking |
| Published retrieval actually starts | “Checking this site’s information…” | Event-driven update |
| Web search actually starts | “Searching the web…” | Do not show for ordinary local lookup |
| Validated results are being applied | “Displaying results…” | Keep until the relevant receipt |
| First useful result is shown; remaining work exists | “Results are ready · finishing your answer…” | Keep the result usable |
| Work exceeds a chosen delay, with no terminal event | “Still working — you can keep talking” | Generic truthful reassurance; offer Cancel |
| Complete, cancelled, failed, or timed out | Brief matching outcome, then clear | Never leave the spinner running after a terminal state |

The loader should be **indeterminate, not unbounded**. Keep the existing request deadlines and show a recoverable failure when they expire. The default voice task deadline is 35 seconds, search has a 25-second provider timeout, and the chat lifecycle is bounded at 120 seconds. These are maximum waits, not expected response times, and the nested search timeout must fit inside the remaining voice-task budget. [Voice deadline](/Users/thomasdevito/Projects/theVoice/lib/gpt-live/runtime.ts:99), [search deadline](/Users/thomasdevito/Projects/theVoice/lib/explore-provider.ts:134), [chat deadline](/Users/thomasdevito/Projects/theVoice/lib/visitor-chat-task.ts:30)

Suggested interaction targets are immediate click feedback within 100 ms and stage text within 250 ms of receiving its event. These are proposed application UX goals, not measured current performance or provider promises. Avoid flashing a spinner for already completed operations, but never hold a finished answer merely to satisfy a minimum animation duration.

Emit status from the shared task/capability layer so voice, chat, `search_explore`, and `visitor_task` → `research.lookup` report the same real stages. Currently the voice wrapper classifies `search_explore` as search and other tools as navigation, so some actual retrieval work lacks a useful stage label. Include request/generation IDs and reject stale progress. Do not generate status text with a separate model call. [Current stage classification](/Users/thomasdevito/Projects/theVoice/lib/visitor-realtime-control.ts:428)

Use a polite status live region, suppress duplicate announcements, and mark the affected result region busy. If using `role="progressbar"` for an indeterminate indicator, omit `aria-valuenow`. Provide a static reduced-motion alternative. Keep ordinary spoken progress sparse: the existing acknowledgment is a good starting point, and the screen can carry subsequent updates without repeatedly interrupting the conversation. [WAI-ARIA progress semantics](https://www.w3.org/TR/wai-aria/#progressbar), [accessible progress announcements](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA25)

## Model, prompt, storage, and cost choices

**Retain Luna as the default until comparisons justify a change.** The current task runner uses `reasoning.effort: low`. Luna officially supports `none`, so compare it for straightforward routing and single-fact lookups. Preserve stronger reasoning for multi-constraint requests when it improves completion quality. Evaluate errors and extra calls alongside speed; the cheapest individual call is not necessarily the cheapest completed task. [Luna capabilities](https://developers.openai.com/api/docs/models/gpt-5.6-luna)

**Improve reuse before paying for a faster tier.** Keep static instructions and tool definitions stable and put changing view/evidence data afterward. The task bridge serializes dynamic data and capability schemas into its instruction string on every round. Separate the stable and changing portions, cache schema conversion, and measure actual cache hits. Prompt caching depends on a matching prefix; a reused WebSocket alone does not guarantee it. [Prompt assembly](/Users/thomasdevito/Projects/theVoice/lib/visitor-task-bridge.ts:73), [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)

**Avoid repeatedly preparing the same photo.** Each task round can call `activeCarouselImage()`, download the current thumbnail, resize it through Sharp, and encode it. Cache the prepared derivative by immutable publication/media revision and asset, while revalidating current authority. Include the image only when needed for the request. [Image preparation](/Users/thomasdevito/Projects/theVoice/lib/visitor-active-image.ts:9)

**Profile database work around model calls.** The bridge reads/saves task state before model calls, records usage after them, and reads again to finish. Publication checks recur around tool execution and display. Connected `visitorAccess()` reads publication and usage together in a transaction; all sites share one usage document. Keep spend reservations and authoritative mutation checks synchronous. Optimize duplicate immutable reads and noncritical observations without weakening accounting or cancellation. At scale, measure contention on that shared document. [Task bookkeeping](/Users/thomasdevito/Projects/theVoice/lib/visitor-task-bridge.ts:33), [access transaction](/Users/thomasdevito/Projects/theVoice/lib/visitor-store.ts:33)

Compute/database region distance and contention can add latency to every repeated operation. Compare the current deployment's locations and timings before proposing an infrastructure change; those settings were not inspected or changed here. Firebase recommends keeping compute close to Firestore and discusses transaction contention. [Firestore placement](https://firebase.google.com/docs/firestore/best-practices), [transaction contention](https://firebase.google.com/docs/firestore/transaction-data-contention)

**Treat Fast mode and backend warmup as separate experiments.** Fast mode charges a premium and requires model/project support. Provider headline speedups are not end-to-end guarantees for Luna, hosted search, or this UI. Request-state warmup using WebSocket `generate:false` is documented, but do not assume it is cost-free or add it to every visit. Test it only after connection/setup time is measured and its budget is approved. [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode), [WebSocket setup and warmup](https://developers.openai.com/api/docs/guides/websocket-mode)

Managed Responses delegation is another possible comparison: OpenAI handles persistent backend setup and compatible state reuse. The current client-delegation path, however, owns publication checks, shared visitor tasks, cancellation, and browser receipts. A switch must preserve those semantics and earn its complexity through measured results. It is not the recommended first change. [Delegation choices](https://developers.openai.com/api/docs/guides/live-delegation#reduce-backend-latency)

## Measurement and acceptance plan

The existing diagnostic events are a useful foundation. They already distinguish model start/output, navigation, backend result, startup milestones, and first observed audio. However, `turn_audio` can be an acknowledgment or unrelated conversation, and startup timing begins after task preflight. Search can also use its own trace ID, making parent-child correlation necessary. [Diagnostics](/Users/thomasdevito/Projects/theVoice/lib/visitor-diagnostics.ts:1), [first observed turn audio](/Users/thomasdevito/Projects/theVoice/lib/use-visitor-session.ts:240)

Track the following separately:

| Metric | Start → finish |
| --- | --- |
| Full startup | Initial tap → transport ready and microphone input enabled |
| Permission time | Microphone request → permission resolved; report separately |
| First greeting | Initial tap → audible greeting onset |
| Delegation delay | Annotated end of meaningful user request → accepted delegation |
| First useful visual | Request → first readable, correct result/card |
| Display confirmation | Validated result received by browser → exact accepted receipt |
| First useful speech | User request → audible answer containing requested information |
| Interruption | User correction/cancel → obsolete output stops and old work cannot apply |
| Search stages | Search request → sources ready → grounded answer ready |
| Retrieval stages | Authorization → cache hit/miss → data loading → evaluation → result serialization |

Use one browser monotonic timeline for visitor-visible boundaries and separate server spans correlated by trace, task, generation, and operation IDs. Do not subtract timestamps from unsynchronized machines or add overlapping spans. Record model round counts, cache hits, response sizes, image preparation, storage operations, and failure/cancellation rates without logging private content. Distinguish audible playback from server append acknowledgment.

Start with isolated offline cases: cold/warm startup, exact record lookup, complex filtering, full published prose, text search, image search, empty results, slow response, partial-result failure, rapid correction, Home/Back/close/reopen, and reduced motion. Inject deterministic provider delays to verify loaders, ordering, cancellation, and streaming behavior. Those tests validate control behavior, not live latency.

A later live comparison should use a named host/app and explicitly approved call budget. Keep the queries, prompts, publications, hardware, and network conditions comparable. Separate desktop and iPhone, first connection and resumed session, text and voice, and cold versus warm data. Report median and tail latency alongside grounded-answer quality and successful task completion. A three-action smoke test can find obvious problems; it cannot establish a trustworthy production p95.

The first release candidate should demonstrate faster eligible paths without premature success claims, stale cards, lost corrections, worse citation quality, or hidden retries. Suggested controlled targets are first click feedback within 100 ms, ordinary result rendering within 200 ms of validated data where no transition is required, and no redundant model call for a supported completed direct operation. Establish provider-dependent startup and useful-speech targets after collecting the live baseline.

## Scope and reproducibility

The source review used the current files under `/Users/thomasdevito/Projects/theVoice`, not older completion claims. The Git branch reference was `codex/voice-workspace-navigation`, pointing to `0ab094aeea57afbc995d8271f91c983ef9a48553`. Normal Git status was unavailable because the system Git launcher reported an unaccepted Xcode license; a clean tree or exact committed-only baseline is therefore not claimed. Current working files were treated as the intended baseline.

The benchmark imported the existing `taskFixture`, `fixtureQuery`, `compileQueryIndex`, `evaluateQuery`, and `QueryResultStore` with Node's `react-server` condition and the existing `tsx` loader. No app server, database, emulator, provider, or browser was started. Only the report and its measurement evidence were added; no implementation or deployment change is part of this research. Full application test suites were not run because no application behavior was edited.
