# Combined website and assistant acceptance — September 18–19, 2026

This independent QA run checks the combined working checkout, including the website and evolving information-surface implementations. **Acceptance remains partial:** the user's latest 09:45–09:47 recording confirms a correct digit-by-digit phone answer and a successful two-item filter. It also exposes an unfulfilled refinement and a recognized image-search request that never reached the backend. The user confirmed that showing the unlabeled gallery with an explanation was useful judgment in this particular request; it is not a gallery-selection defect or a rule to codify. Follow-up implementation and verification are recorded below. This is not a deployment or release approval.

## Scope and budget

- Live application: `http://127.0.0.1:3220` in Brave, using the existing published cake-shop and travel-guide content.
- Maximum authorized API spend: **$3 total**, including backend, search and the subsequently authorized microphone retest; never a per-test allowance.
- Customer drafts and publications remain unchanged. Source replacement/removal and publication changes use disposable synthetic data in the isolated harness. Branding changes were previewed and discarded without applying or publishing.
- Only this run's local recordings were inspected. Raw inputs, outputs and transcripts remain ignored local artifacts. Recordings capture observable inputs, tool actions and outcomes, not hidden model reasoning.
- Real microphone recognition, audible accuracy and interruption require a short user-assisted check. Typed and mocked tests do not establish those results.

## Acceptance matrix

| Area | Result and evidence |
| --- | --- |
| Existing published website | **Fixed; Brave verified.** Publications missing `style.template` bypassed the new renderer. Cake-shop and PDF-derived publications now use the refined composition without reimporting or resaving customer content. |
| Imported menu | **Fixed; Brave verified.** Generic qualified-price fields render concise menu prices; full details retain slice/size/starting-price conditions. Exact generated-summary repetition is removed. |
| Photos and PDF reading | **Passed in Brave.** One consolidated 57-photo album, expand/collapse, photo detail and Escape; travel PDF pages 1–10 open and close. Repeated teaser headings are suppressed while full source reading remains available. |
| Branding | **Passed in actual-content previews.** All three templates, Motion Off and Larger text were checked. No customer settings were saved or published. |
| Publisher lifecycle | **Passed in an isolated synthetic browser scenario.** Review/apply/update/withdrawal preserve draft-versus-publication boundaries. No live import, removal or publication acceptance is claimed. |
| Contact facts | **Live chat and latest recorded voice transcript passed.** Phone `347.413.8438`, digit-by-digit follow-up, and `214 Bainbridge St., Brooklyn, NY 11233` matched published facts in chat. The 09:05 voice failure is documented below; the 09:45 test subsequently retrieved and transcribed the complete correct digit sequence. Recorded output text does not establish physical-speaker playback quality. |
| Menu/filtering | **Partial.** The full published menu displayed. “Show me all cakes” now returns 31 reviewed cake-category items, excluding incidental prose matches; a follow-up selected 13 items with slice prices below $10. Its final prose exhausted the old 500-token follow-up limit. The limit is fixed, but the attempted live verification hit a separate provider socket failure. |
| Web search | **Live passed.** Attributed external findings rendered with loading feedback. |
| Image search | **Service/display passed earlier; latest voice handoff failed.** Nine attributed images previously rendered; “Expand image A2” opened the selected image and Back restored the prior whole result state. At 09:47, a recognized request for external images produced no delegation and no search call. External relevance and local photo associations also need work. |
| Maps and screen context | **Live partial.** A labeled approximate Brooklyn map rendered; the follow-up identified the displayed map and address. This is not an exact location-pin/geocoding acceptance test. |
| Whole-state history | **Live passed for contact and image states; broader mocked checks also cover it.** Assertions wait for the surface transition to settle. |
| Cancellation | **Live chat cancellation passed.** Return to website during a pending search cancelled the request without an immediate late reopening. Mocked tests additionally exercise Back and stale-result rejection; actual speech interruption remains pending. |
| Home and reopening | **Fixed; mocked voice passed.** Home/Start over hide the surface without disconnecting their own voice session. Reopening a retained item explicitly reveals the layer before confirming visibility. |
| Responsive layout | **Brave desktop and 390px phone passed selected flows.** Menu navigation, detail, photo expansion and close worked without horizontal overflow. Synthetic tests cover wider responsive and reduced-motion cases. |
| Recorder | **Captured the live voice failure with no reported event drops.** Partial transcripts, context messages, acknowledgments and provider errors identified an overload. This also exposed an output-audio omission bug: new writes and reads/exports now remove binary audio deltas while preserving transcript deltas. Six isolated recorder scenarios previously passed; final verification is listed below. |

## Defects fixed and code map

| Defect | General fix and location |
| --- | --- |
| Website redesign absent on older publications | `effectiveWebsiteTemplate` resolves an intentional fallback without changing stored content; `site-design.ts`, `PublishedWebsite.tsx`, Branding preview. Explicit template choices still win. |
| Imported menu prices/qualifications and media lost during presentation | Generic semantic roles, qualified-price projection and video-poster preservation in `lib/website-presentation.ts`, `lib/website-catalog.ts`, catalog route and shared website rendering. |
| Duplicate gallery strips and repetitive summaries | Consolidate approved photo presentation; suppress exact generated repetitions without deleting source knowledge. |
| Mixed requests became literal catalog text searches | Keep unhandled compound prose and explicit external image/map requests with the assistant; use typed query patches instead of exposing `query.command` as a model shortcut. `lib/visitor-query-command.ts`, `lib/visitor-task-runner.ts`. |
| “All cakes” searched for the literal word “all” and matched unrelated prose | Strip the leading quantifier after exact-name lookup; match qualified category leaves and reviewed membership unions. Generic regressions also cover reports and consultations. |
| A 24-record result exceeded task instruction bounds | `lib/visitor-task-record-context.ts` preserves all bounded record IDs/names/codes, enriches a limited set with complete assertion groups and reports omissions for authorized lookup. A multilingual fixture measured 47,689 UTF-8 bytes. No private source content or invented facts fill omissions. |
| Valid model output used `metric: null` for an optional field | Normalize only the known optional null at the workspace boundary, without mutating the original reply; strict required/unknown-field validation remains. `lib/visitor-workspace.ts`. |
| Follow-up answer stopped at 500 output tokens | Each task round now allows up to 1,200 output tokens, retaining existing spoken/text word limits and bounded rounds. No automatic retry or extra model call was added. `lib/visitor-task-runner.ts`. |
| Home reopened the layer, or closed its own voice connection | Separate programmatic layer dismissal from manual hang-up; close after reset and reveal retained targets before confirming. `VisitorAssistant.tsx`, `VisitorWorkspace.tsx`. |
| Reduced-motion hydration mismatches | Make initial server/client reveal state consistent and give mode buttons an explicit tab order. `InformationSurface.tsx`, `VisitorAssistant.tsx`. Recorder tests now reject hydration errors. |
| Opaque transport errors | Record bounded, redacted error cause/code; retain confirmed views and surface failure without silently retrying. |
| Unchanged screens flooded live voice context | Compare semantic screen state before resolving timestamped facts; keep at most one application-context fragment awaiting acknowledgment and replace unsent stale snapshots with the newest view. `lib/visitor-realtime-control.ts`, `lib/visitor-live-context.ts`. Shared GPT-Live runtime remains unchanged. |
| Recorder saved output-audio bytes under a generic `delta` key | Detect audio-event types and omit their binary deltas without removing transcript text; re-sanitize historical events on timeline/export reads. `lib/visitor-test-events.ts`, `lib/visitor-test-recording-store.ts`. |
| A category request such as “cake menu” filtered category members by the word “menu” | After exact record/category resolution, presentation-only wording selects members without an extra text predicate. Meaningful qualifiers and typed filters survive. Reviewed named scopes take priority over the generic photo-gallery fallback. `lib/visitor-query-command.ts`; regressions cover four unrelated categories. |
| Voice claimed contact information was absent without consulting the backend | `lib/visitor-realtime-session.ts` supplies the publisher identity, whole-publication capability list and structured delegation policy. An empty screen is explicitly a partial view. Actual live compliance remains unverified after this fix. |
| Introduction competed with the visitor; mobile input could be muted during opening playback | `lib/visitor-realtime-control.ts` retires the opening once on recognized speech, suppresses an opening after earlier speech and preserves the complete caption. `lib/use-visitor-session.ts` cancels opening visuals on user captions and enables input after readiness without the optional iOS greeting mute. The shared core is unchanged. |

These fixes contain no cake-shop IDs, document-name branches or publisher-specific exceptions.

## Verification

Node 24.6.0; command logs and browser artifacts are under `/private/tmp/flowpath-qa-20260918/`.

- Initial independent `npm run check`: 559 server tests and 22 rendering tests, lint/type checks, packed package and production build passed before the QA fixes.
- Earlier broad `npm run check`: **576 server tests and 24 rendering tests passed**, plus lint, type checks, packed consumer and production build (`check-acceptance.log`). This preceded the final narrow Home/reopen change.
- After that change, production build, lint and type checks passed; the complete **13-case information-surface browser file passed** (`build-reopen.log`, `lint-final.log`, `typecheck-final.log`, `surface-final.log`).
- After diagnosing the microphone incident, **95 focused offline tests passed** (`voice-context-verified.log`). They reproduce unchanged screen heartbeats, delayed acknowledgments, superseding views, exact fact retention and audio-payload redaction.
- Final `npm run check` after the context and recorder fixes: **581 server tests and 24 rendering tests passed**, together with lint, type checks, packed-consumer verification and the production build (`check-voice-context-final.log`).
- **Six recorder browser scenarios passed after the final recorder fix** (`recorder-context-verified.log`), including reduced motion, mocked voice, attachment and persistence failures, timeline/export, and hydration assertions. The first rerun caught a test stopping capture before the debounced ready-scene event occurred; it now waits for the recorded receipt before stopping. The trace showed no missing event during the active recording. Final lint and `git diff --check` also passed.
- After the 09:05 retest fixes, **95 focused tests passed**, then `npm run check` passed **586 server tests and 24 rendering tests**, lint, type checks, packed-consumer verification and the production build (`voice-retest-focused.log`, `check-voice-retest.log`).
- **Two new isolated browser tests passed** for microphone input before and during the greeting on desktop and an iPhone user-agent (`voice-opening-verified.log`). Two existing readiness/permission-cancellation tests also passed. The first run's new-test teardown used the wrong End button label, corrected before rerunning; all input assertions had passed. A separate existing manual-context test could not reach the old workspace control behind the new information-surface backdrop; it still needs harness migration and does not establish manual-browsing acceptance. No real microphone or provider was used. Final scoped lint and `git diff --check` passed.
- Targeted source lifecycle, whole-website interaction and gallery scroll restoration checks passed; the remaining Home/Start over test then passed after its fix (`browser-recheck.log`, `browser-home-final.log`).
- The initial 17 template/design browser scenarios passed. These synthetic results alone did not expose the legacy-publication and real imported-price issues above.
- The initial full browser attempt reported 67 passed, 91 failed and 14 skipped. Many failures target obsolete UI or cascade from the 12-site fixture limit; this is **not** a claim of 91 independent product defects or a green whole-suite result. Relevant replacement tests were used for this acceptance run; the remaining harness still needs migration.

## Paid-run accounting and connection failures

| Recording | Accounting after microphone check |
| --- | --- |
| `24d2652c-ec17-4d56-b2d8-f49092ad3964` | First request failed without a usage receipt through a stale compiled module. **$1 held** for unknown cost; it is not a measured charge. |
| `4d1cb50b-70ee-4c76-95e1-c27003082f53` | 16 guarded requests; conservative usage/reservation total **$0.481554**. |
| `700344ca-cfd8-4b8c-9f06-0efc67cc83aa` | 13 guarded requests; conservative usage/reservation total **$0.718333**, including unreconciled socket-failure reservations. |
| `53c49fad-7691-40bf-96bb-a66540a883ba` | 09:05 microphone retest: one guarded backend request, **$0.028030** conservative measured usage. Final voice receipt: **68 seconds**; retain the full **$0.15 voice allowance** conservatively. |

The first failed microphone connection lasted about 46 seconds and produced no final usage receipt; its entire **$0.15 voice allowance remains held**. No additional backend requests occurred during that first check. Before the additional 09:29 activity described below, combined conservative usage/reservations were **$2.527917**, leaving **$0.472083** under the $3 ceiling at that point. These are conservative upper bounds, **not a provider invoice**, and do not establish the remaining amount after 09:29. No further paid calls are planned in this run. Do not reset a ledger, release unknown-cost reservations or start unrelated paid flows.

The development-only guard in `lib/visitor-qa-budget.ts` reserves before sending, reconciles known usage, retains unknown costs and fails closed if its configured active recorder is missing. It does not enforce voice duration; that one connection is manually supervised. Server restarts require a new recording and carrying forward the remaining budget, not a fresh $3 allowance. See [local testing](local-visitor-testing.md).

Two later requests failed with `UND_ERR_SOCKET`, including the attempted verification of the larger follow-up output limit. This establishes a connection failure before an answer, not its underlying network/provider cause. Their reserved costs remain counted; no repeated paid retry was performed. A complete live answer after the token-limit fix remains unverified.

## Microphone incident — September 19, 08:36 EDT

Recording `700344ca-cfd8-4b8c-9f06-0efc67cc83aa`, trace `0fab059c-e8bf-4bf3-b31c-4809ceb56680`, captures the user's failed phone-number check:

- Connection started at 08:36:16.121; control became ready 4.161 seconds later.
- Eighteen screen updates described the same surface state/revision, but resolving published facts added a fresh `asOf` timestamp. Comparing those timestamped snapshots made every heartbeat appear changed.
- The adapter emitted **571 context append messages** without waiting for delivery acknowledgments. The recording contains **76 acknowledgments and 41 `too_many_pending_appends` errors**. The first error appears at 08:36:57.196; the connection ended at 08:37:02.351.
- Only eight input transcript fragments were captured; they do not establish recognition of the complete question. There was no delegation or backend phone-number lookup. The overload explains a confirmed connection failure, but the logs cannot establish every cause of the earlier recognition difficulty or what was audible at the physical speaker.
- The recorder was stopped at 08:38:38.633, with zero reported dropped events. Voice was already disconnected. There was no paid retry.

The fix deduplicates before time-dependent fact resolution and sends the newest context with one fragment pending at a time. Reading updates are separate; a new scene discards unsent reading context from the previous scene. Matching acknowledgments release the next fragment; errors stop the channel rather than retrying. Delivery acknowledgment is an estimated context-injection receipt, not proof of understanding or audible playback, as described in the [official Live context-delivery documentation](https://developers.openai.com/api/docs/guides/live-conversations#understand-when-context-reaches-the-model).

The recorder fix removes output-audio payloads from new writes and sanitizes older records when read/exported. Existing ignored originals remain private under the normal retention policy; their binary audio content is not copied into the report.

## Microphone retest — September 19, 09:05 EDT

Recording `53c49fad-7691-40bf-96bb-a66540a883ba`, trace `d1a07c15-02f0-48c8-860e-82b033413de6`:

- 1,462 recorded events; recording stopped at 09:08:30.028 with zero reported dropped events. The voice connection had already closed at 09:06:16.282.
- Zero provider errors, 42 thinking acknowledgments and 51 total outbound events: the earlier uncontrolled context-append flood did not recur.
- The first phone question was fully transcribed at 09:05:12.915–15.356 and repeated at 09:05:22.856–23.414. Neither produced a delegation. Assistant transcript fragments overlapped the first request, then asserted that the number was not listed. The logs establish recognized input and absent retrieval, not hidden model reasoning or exact physical playback.
- “Show me the cake menu” delegated three times. Each shortcut selected the reviewed Cakes collections but added `searchText: "menu"`, returning no matches. This was an application parsing error, despite the information being published.
- Home delegated at 09:05:47.930 and the browser confirmed it at 09:05:54.167. This was the only paid backend request in the retest.

The fixes above add no publisher-specific facts, automatic paid fallback or retries. The frontend policy uses the [documented Live delegation structure](https://developers.openai.com/api/docs/guides/live-prompting). First speech sends one short instruction to abandon the introduction; further fragments do not repeatedly interrupt or create tasks. Browser checks use synthetic audio activity, so they do not establish real acoustic echo cancellation, multi-sentence turn-taking or the model's spoken accuracy.

## Later session evidence — September 19, 09:29 EDT

When reconnecting to Brave, voice was already active. Recording `85c7d3ca-83d4-4f8a-90ff-d9fec03eb338` began after that session's lookup and also captured part of a second connection. Both connections and the recording are now stopped. No new paid request was initiated by the agent during this inspection.

- The next session's retained conversation contains the question “What's the phone number” and the answer `347.413.8438`, matching the published contact. Server diagnostics for trace `accc84a3-59b8-4435-b063-b8f9e84ef90a` show a successful backend/result at 09:29:11.362. This is evidence that lookup succeeded, not a complete audible-speech acceptance test.
- The second session uses the new delegation policy, and its captured transcript begins repeating `347 413` before recording stops. The ending digits and opening interruption cannot be judged from this partial recording.
- The first connection has a final 33-second receipt. Earlier backend usage and the second connection's final usage are absent from this recording. The **$2.527917 figure above covers the earlier audited run only**; remaining budget is not asserted after this additional activity. The user explicitly chose to **keep the $3 cap** and declined an additional allowance. No more paid testing was performed.

## No-paid-call browser retest — September 19

Recording `57603118-2e63-4400-88e3-95a8bf534fca` captures the real published site in Brave with voice off and the existing local QA guard configured to leave **zero available for a paid backend request**. This temporary guard did not grant or spend a new voice allowance.

- Typed “Show me the cake menu” returned **31 matching published items**, covering both Retail / Cakes and Catering / Cakes. The prior empty-result parsing failure did not recur.
- Typed “Take me home” closed the information surface and restored the website.
- Typed “Show me the cake menu again” reopened the same 31 results. One submit-button click immediately after Home did not produce a `chat.submitted` event; submitting the retained text with Enter succeeded. This remains a timing observation to reproduce with the offline browser harness, not a confirmed parser or provider defect.
- A final typed Home command restored the website, then recording was stopped. The recording contains **89 events, four chat submissions, 17 successful local task HTTP exchanges, zero model/voice/paid-budget events and zero dropped events**. Source inspection confirms these commands used the shared deterministic capability path; the paid fallback was never entered.
- The combined results still use the first category's heading, a previously recorded presentation issue. This check proves the real menu retrieval/display and Home/reopen path, not live speech recognition, delegation or interruption.

The temporary guard was archived as `qa-budget-completed-20260919-no-paid.json`; earlier ledgers and unknown-cost holds remain unchanged. No publisher content was edited or published. At the end of that check, the server remained running, voice was off and the recorder was stopped. The user subsequently conducted the recording described below.

## User recording and layout review — September 19, 09:44–09:48 EDT

This review used saved local events, the supplied screenshots and source inspection. **No new live API request, browser submission or microphone connection was initiated by the agent.** The existing $3 ceiling remains unchanged; incomplete earlier usage and the additional user-run activity mean a remaining allowance cannot be asserted.

### Coverage

- Recording `1fa738b9-a509-4936-ac31-037c2e8c8129` covers **09:45:45.932–09:47:40.675 EDT**, with 2,292 events and zero reported drops. It ended when the tester stopped recording.
- There is no separate saved recording covering the **09:44:35 screenshot**. The preceding saved file is the 09:38–09:41 no-paid-call check above. That screenshot establishes the prose-heavy layout, but not which preceding request or tool decision selected it.
- The earlier 09:05 failure and partial 09:29 recording remain useful comparisons; neither substitutes for the missing 09:44 sequence.
- Recorded source hashes for the realtime adapter, session instructions and shared runtime match the files inspected during this review. The new failure therefore occurred with the previously described fixes present.

### Confirmed sequence

| Time (EDT) | Evidence | Assessment |
| --- | --- | --- |
| 09:45:59–09:46:04 | A phone request delegated, the backend returned the published number, and the output transcript contains **three, four, seven — four, one, three — eight, four, three, eight**. | Correct lookup and complete spoken-text output for this test. |
| 09:46:16–09:46:31 | The request for velvet cake slices excluding red velvet produced a typed search for `velvet` plus a negative `red` constraint. The browser acknowledged two records, Blue Velvet and Blue Velvet With Nuts. | Initial filtering succeeded. |
| 09:46:42–09:46:59 | The visitor refined the selection to the plain Blue Velvet option and requested related photos. The backend read published text, then added the entire imported album under an instance named `blue-velvet-photos`. The two-item query remained visible. | The new refinement was not reflected in the result set. The general gallery was a useful contextual choice, as subsequently confirmed by the user; it did not establish that a specific photo depicted the requested item. |
| 09:46:59 onward | The answer explicitly said the photos were not labeled as Blue Velvet, but the surface displayed the generic gallery beside the selected results. The screenshot shows a red cake from that gallery. | Accepted by the user: showing available photos while clearly acknowledging uncertainty was the right judgment in this case. Do not replace that judgment with a mandatory gallery fallback or a mandatory extra confirmation. |
| 09:47:07–09:47:12 | Four gallery interactions each appended a stop-speaking instruction and generated refreshed screen context. | Manual interaction correctly invalidated older work, but its effect on subsequent voice response needs investigation. |
| 09:47:13–09:47:19 | The input transcript recognizes an explicit web/image search for Blue Velvet. Later “Hello” and a repeated search request were also captured. | **No delegation, backend request or image-search call followed.** This incident failed before the search service was invoked. |

The recording contains three delegations and six completed backend model responses, with no provider error. Search was available in the backend tool set. The image-search failure is therefore not evidence of a disabled search setting, an exhausted workspace, an image-provider rejection or missing recognition of the request.

### Likely contributor: cancellation and screen-context traffic

Gallery interactions repeatedly sent: “Stop speaking now. The user changed the page or task. Discard the previous pending answer and use the new application context.” The adapter in that recording did not explicitly distinguish resuming normal response to new speech after that manual interruption. This is a **hypothesis to test**, not recovered model reasoning or a proven causal explanation.

The recording also contains **86 application screen-context fragments totaling 30,250 characters**. Large gallery snapshots included information-surface history, published facts and media state, and were superseded repeatedly while the user paged photos. The final update continued arriving while the image-search request was being spoken. A final context-window reading near 13% does not support a context-window overflow diagnosis. Existing acknowledgment backpressure prevented the earlier pending-append error, but substantial avoidable context traffic remained.

The [Live context documentation](https://developers.openai.com/api/docs/guides/live-conversations) recommends concise meaningful observations; an append acknowledgment confirms acceptance rather than model compliance. [Delegation guidance](https://developers.openai.com/api/docs/guides/live-delegation) also distinguishes session instructions from task results. A fix must preserve cancellation, explicit new-request handling, exact published facts and display acknowledgment without introducing automatic paid retries or guessing utterance completion from transcript timing.

### General implementation direction and product clarification

1. **Restore reliable response after manual interaction.** Reproduce gallery paging followed by a new request. Scope cancellation to the superseded answer, keep new speech eligible for delegation, and distinguish an application rejection from a provider that emitted no delegation. Apply the same policy to photos, maps, records, history and Home. Keep the shared GPT-Live core unchanged unless its independent contract demonstrably requires a coordinated change.
2. **Compact screen updates without losing grounding.** Send the current primary/supporting regions and relevant facts once; subsequent media changes should identify the selected media and its verified relationships without repeating the whole prior conversation. Preserve exact contact/price qualifications and stable IDs. Measure fragment count/bytes, delayed acknowledgment behavior and replacement of stale updates. Do not simply truncate facts or remove the acknowledgment gate.
3. **Preserve refinements before adding media.** The active selection and constraints remain authoritative through a multi-action request. Resolve the requested item/variant, acknowledge the resulting view, then enrich that selection. A gallery's existence or an `origin` reference does not prove its photos depict that item. Missing evidence must stay unknown; an item name alone cannot establish ingredients or other safety properties.
4. **Use structured presentation for browsing requests.** When reviewed records exist, render a compact heading, meaningful groups, names, qualified prices or other primary facts, and short descriptions. Keep full descriptions and secondary facts in details. Avoid duplicating the same price/category in the summary and every fact row. Descriptive source pages remain readable overviews; do not invent structured item/price pairings by splitting prose on commas.
5. **Preserve contextual judgment.** When an exact result is unavailable, the assistant may choose a useful related view, an explanation, clarification or another enabled action based on the request. The unlabeled gallery was a good choice here because the visitor wanted pictures and the assistant explained its limits. There is no default gallery fallback. Do not force a gallery, force text-only output, require an extra confirmation for every alternative, or claim an unsupported photo identity. Publishers can improve specificity through reviewed labels and associations. Explicit external-search requests still need the corresponding capability.

The first screenshot should become a browseable, grouped menu **when the task is to browse offerings**: brief introductory context, readable item/qualified-price rows or cards, and an optional overview. The second screenshot's two-column composition and discretionary gallery choice should be preserved, including its honest explanation; follow-up refinements should still update the selection. On mobile, use one coherent column with the current selection first and related media adjacent; keep the existing bounded information surface, history, keyboard access and reduced-motion behavior.

These decisions belong in shared query execution, media validation and semantic rendering. They must not branch on cake names, bakery categories, this publisher ID or this album. The same rules apply to services and rates, classes and dates, destinations and activities, equipment and specifications, and creative portfolios. No publisher data, approved associations or publication content was changed.

### Test order

First build offline regressions for the observed sequence using synthetic publishers and mocked providers:

- Structured browse → negative filter → narrower named variant → request related media. Verify the refinement survives every action. Permit a contextually useful general gallery without inventing a specific depicted identity; do not require that alternative in every missing-result case.
- Missing labeled media → explicit image search. Verify the request retains its subject/constraints and reaches the registered image capability, including immediately after repeated gallery paging.
- Gallery, map or history interaction → fresh question. Verify old work is cancelled, new work is accepted and context updates stay bounded. A mocked successful delegation does **not** prove that a real voice model will emit one.
- Home/Back during pending enrichment, then reopen. Late results must not reopen or overwrite the newer state.
- Text-only and media-rich layouts at desktop and phone sizes, with keyboard access, reduced motion, loading/error feedback and preserved history.

Only after those pass, progress to more demanding scenarios:

| Scenario | What it establishes |
| --- | --- |
| A freelancer's packages: filter by a published price condition, compare two, then show related portfolio work. | Qualified prices, chaining and verified media associations outside retail. |
| A course catalog: narrow by topic/date, change one constraint, return to the previous state. | Typed fields, unknown dates, selective refinement and whole-state history. |
| A travel catalog: narrow options, request a map and then external images, interrupt with Home. | Multiple registered capabilities, external-versus-published attribution and cancellation. |
| Equipment or services: retain hard constraints while sorting, paging and asking about “the second one.” | Stable references to the acknowledged visible order and no silent constraint loss. |
| Any publisher with no matching photo, missing attributes or disabled external search. | Honest absence/unknown states and useful browsing without invented facts. |
| Two unrelated publisher fixtures with similar names and different facts. | Tenant isolation and absence of publisher-specific shortcuts. |

A later separately authorized, budgeted live test should verify the real frontend's post-click delegation and interruption behavior. No repeat microphone session is needed for this offline work. Physical playback, opening interruption and live compliance with the follow-up fixes remain unverified.

## Follow-up implementation — compact assistant cards and fresh requests

The user's mobile screenshot and clarification refine the acceptance criteria: spend the information card's space on the requested content. Remove normal website-style filter chrome from this conversational surface. Keep useful discretionary alternatives rather than converting the successful gallery choice into deterministic behavior.

Implemented in shared platform code, with no publisher-specific branching:

- `VisitorTasks.tsx`, `VisitorWorkspace.tsx`, `VisitorCarousel.module.css`: replace the oversized matching-results heading with a small item count; remove the reset-button/filter-chip block, share the mobile top row with Back/Close, and tighten insets and result spacing. Keep loading, errors, necessary clarification, missing-data notices and empty states. Nonblocking missing-data notices follow the results. Query state/constraints still reach the assistant, and reset remains available conversationally. The ordinary website renderer is unchanged.
- `visitor-realtime-control.ts`, `visitor-realtime-session.ts`: after a manual interruption, the first fresh substantive speech supplies one instruction that restores normal response/delegation. Fragments do not execute tasks; stale work and duplicate delegations remain fenced. The local recorder observes `voice.resumed` without changing the decision path.
- `visitor-live-context.ts`, `visitor-realtime-control.ts`: separate the concise visible composition from unchanged answer/reference content. Gallery paging supplies the selected photo and current regions without repeating old answers, facts or history summaries. The newest screen update takes precedence over queued reference prose; full reference content and the one-outstanding-ACK limit are preserved. This does not increase provider limits or introduce retries.
- `visitor-carousel-control.ts`, `visitor-task-bridge.ts`: shared guidance favors reviewed structured records for browsing and applying a refinement before enriching its results. When exact information is unavailable, alternatives remain a contextual judgment, not a gallery fallback rule. This is policy guidance, not proof that every live model output follows it.

Verification: **107 focused offline tests passed**, including new post-gallery web/image/map delegation cases, stale-request rejection, complete reference delivery and bounded gallery context updates. **`npm run check` passed**: lint, typecheck, 591 server tests, 24 rendering tests, packed-consumer verification and the production build. The final spacing adjustment passed a fresh production build and focused lint. Browser geometry checks exposed a legacy template selector overriding the surface's mobile padding; the surface now owns those insets explicitly.

**All 13 targeted information-surface browser tests passed** on the rebuilt app, using an isolated demo server on port 3225 and mocked providers. Product and service fixtures verify the small count, mobile alignment with Back/Close, content beginning within 85 pixels of the card top, notices following results, 44-pixel controls, reduced motion and no horizontal overflow. History, Home, retained media, loading/cancellation, failed media and disabled search also pass. These replace the affected surface checks; this is not a claim that the entire older browser suite is green. The [desktop product view](screenshots/information-surface/products-compact-count-1440.png), [mobile product view](screenshots/information-surface/products-compact-count-393.png) and [mobile service view](screenshots/information-surface/services-compact-count-393.png) were visually inspected.

No new paid tests were performed, and the shared GPT-Live core was not changed. The live Studio server remains listening on port 3220. Real provider delegation after a gallery click and live compliance with the structured-browsing guidance still require a later authorized voice test; synthetic delegation events do not prove those outcomes.

## Deferred microphone acceptance check

The earlier supervised microphone attempts failed contact/menu acceptance; the later user recording now confirms the complete phone transcript and initial filtering, but exposes the post-gallery failure above. **Do not restart automatically or ask the user to repeat it during this run.** After the offline regressions and a later explicitly authorized live test are ready, include this sequence:

In the Brave cake-shop tab, start the Local test recorder before the voice connection:

1. Tap the wave and say, “What’s your phone number? Say it digit by digit.” Expected digits: **347-413-8438**.
2. Say, “Show me the cake menu.” Verify the visible menu corresponds to the request.
3. While it answers, say, “Take me home.” Verify the information surface closes, stale speech stops, and the conversation remains available.
4. Say, “Show me the cake menu again.” Verify the same content can reopen.
5. Tap the wave to end within two minutes. Report any wrong words, delayed speech or display problems. If it errors, stop rather than retrying.

Also include one gallery interaction followed by a fresh image-search request; this is now a required acceptance case. Retain unknown-cost holds; this run has no verified remaining allowance for further paid testing. Completed guard configurations and all ledgers remain ignored local artifacts. Normal manual testing is no longer blocked by the completed QA guard. The server was verified listening on port 3220 during this review; current browser microphone state was not inspected or changed.

## Remaining work / limits

- Ordinary v2 browsing is still alphabetical and paginated. Record kinds, qualified pricing and video posters survive projection, but hierarchy-aware complete website composition needs another implementation pass.
- External image relevance and publisher photo labeling can improve; a useful unlabeled gallery with an honest explanation is permitted, not a defect or mandatory fallback. The image-results-plus-answer composition also leaves too much empty width in some cases. A structured browse request should not fall back to a wall of source prose when reviewed item records are available.
- A query spanning several qualified categories can show only the first category as its heading; that label should describe the combined scope.
- Provider socket reliability and completion after the output-limit fix remain open acceptance items.
- The latest recorded voice output confirms the full correct phone number and initial filtering. A later refinement did not update the selection, and an image-search request after gallery paging never delegated. The follow-up changes above address the adapter and presentation behavior offline; live model compliance remains unverified. Audible accuracy and opening interruption need later authorized verification. Physical mobile-browser behavior, live OCR/crawling/import and production deployment are not established by this run.
- Reproduce the observed submit click immediately after Home in the offline browser harness; Enter successfully submitted the same retained request.
- The obsolete full browser suite needs reconciliation with the new information surface and isolated fixture limits.
