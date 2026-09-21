# Voice QA: noon research, recall and reconnect

September 19, 2026. All times below are America/New_York. This is an investigation of an existing local recording, followed by generalized code fixes and offline verification. No additional paid requests or live microphone tests were initiated.

## Evidence and limits

The local recording `36396ac8-fe70-4bab-b649-b9eb1005abad` contains 1,791 events from **12:07:28.268 to 12:09:10.107** and a stop marker reporting zero dropped events. Its initial configuration/context and two voice connections are captured. The eight source hashes in its start event matched the inspected code before these fixes. Raw recordings remain in the ignored local recorder directory; they are not added to the repository.

The development log also contained 212 operational diagnostics from **12:00:19.705 to 12:11:24.426**, including 157 before recording started. Those earlier entries establish activity, failures and stops, but do not recover missing speech, model inputs or search answers. Two earlier backend failures at 12:01:43.635 and 12:02:12.035 lack enough evidence for a reliable cause. The initial recording context contains eight earlier user-message fragments without original timestamps or the corresponding assistant replies.

| Observation | Supported conclusion |
| --- | --- |
| Events 193–224: tax request. Event 326 at 12:07:47.599: `search_explore` requested a web lookup with `kind` and `query`, omitting unused `id`. Events 336/345: task error/unavailable. | Runtime validation rejected the arguments before the search provider ran. The model did attempt a lookup. |
| Events 450–458 at 12:07:53.550: resumed history and a wait-for-fresh-speech instruction. Event 459: shared readiness then says to respond now. Assistant output at 12:07:55.425 precedes fresh input at 12:08:05.988. | Conflicting startup instruction order is a concrete defect consistent with unsolicited replay. This is a diagnosis from observable instructions/events, not hidden reasoning. |
| Model requests 291, 796 and 1190 do not contain the later researched rate. Events 1293/1294 at 12:08:40.086 contain the complete successful lookup; event 1303 passes it into the continuation. | The recorded lookup eventually succeeded. The earlier slice lookup is outside captured evidence, so its exact loss cannot be reconstructed. |
| Code supplied research primarily through current-view references and current-generation action handles. Rebuilding browser history from a call-start snapshot discarded later completed answers. | Screen changes, new tasks and reconnects could lose useful research/dialogue context even while older visual states remained available. |
| Events 1638–1699, 12:08:58.617–12:09:03.403, contain the complete correct published phone number. | This recorded phone response was correct at transcript level. It is not acoustic verification. |

The last recorded voice connection stopped at 12:09:13.254 in operational diagnostics, after the recorder stopped. Its final usage is not established by this recording. The existing 120-second connection limit was not changed. A context-injection failure immediately after an intentional close is not evidence that it caused the earlier search failure.

## Changes

1. **Normalize genuinely optional search arguments.** The runtime accepts omitted nullable `query`/`id` fields and normalizes them to `null`, while retaining the advertised schema and all required-query, capability, annotation and exact-reference checks. Web, image, map and existing-result navigation share this fix. Search failures now record their safe validation/search/display phase and schema field without dumping provider secrets or retrying automatically.
2. **Keep researched findings independent of the display.** Successful `research.lookup` and `search_explore` results enter the visitor task session's research memory. Both voice and chat receive this context on later requests. Voice also receives a quiet, separate memory update and hydrates it on reconnect without creating another task or model call. Home, Back, filters and a hidden research card do not erase it.
3. **Retain complete evidence, with bounded recall.** Up to eight results fit within 96,000 serialized UTF-8 bytes; a complete individual result may occupy at most 48,000 bytes. Prompt projection uses up to 12,000 bytes within the existing task instruction ceiling. A finding either fits whole, including its answer, source links, citation offsets, acquisition time and qualifications, or is available through the read-only `research.recall` capability. If directory entries also do not fit, the prompt reports their omission; `research.history` lists exact retained IDs with its separate metadata output type. The optional memory field can be omitted entirely rather than fail an otherwise valid crowded context. Oversized complete results are explicitly unavailable rather than silently clipped. Storage pressure can evict older findings.
4. **Preserve session and authority boundaries.** Memory belongs to the exact visitor session and publication. It follows the existing two-hour absolute / 30-minute idle expiry. Recall never refreshes acquisition dates and does not revive stale action handles. A new current handle must come from validated recall before a dependent action uses it. Historical external evidence is not publisher approval, current inventory, a confirmed transaction quote or proof that content is displayed.
5. **Repair completed dialogue history.** User caption corrections update their own entry rather than rebuilding the conversation. A revision-scoped `answer_completed` event records successful backend replies even when no new answer card is needed. The active voice adapter also retains the associated request and completed answer for later delegations in the same connection; this preserves earlier calculated totals without depending on generated speech captions. Intermediate card copy and raw assistant audio captions do not establish a completed answer. Home/Back cancel unfinished writes while retaining completed dialogue; old connections and duplicate completions are rejected. Both dialogue buffers retain at most eight messages of 2,000 characters; browser dialogue disappears on reload.
6. **Keep reconnects quiet until new speech.** The resumed/visitor-speaks-first instruction follows shared startup readiness. The adapter refuses delegation before substantive fresh user speech. Publisher-approved greetings remain available for ordinary new conversations.

The shared knowledge policy tells both channels to reuse applicable research, preserve its conditions and recalculate for changed quantities or inputs. It also permits an enabled lookup when evidence is genuinely missing or no longer applicable. There are no publisher, cake, city or tax-rate special cases. A previous estimate does not make every later item subject to the same rule. Remembering a finding and deciding that it applies are separate responsibilities.

This memory is part of normal application behavior whether recording is on or off. The recorder observes the supplied memory and completed-answer events; it is not a hidden source of model context. Bounded retained context can add input tokens to a later request; there is no new summarization model, background worker or automatic paid retry.

## Verification

Under Node 24.6.0:

- **173 focused offline tests passed**, covering search parsing/failure classification, research storage and recall, voice/chat/reconnect integration, caption corrections and completed answers, startup ordering, interruption/cancellation, context delivery, task integration, 24-record context size, surface history, recorder behavior and diagnostics.
- Mocked integration checks perform one synthetic lookup, remove all visible research references, ask a related follow-up, switch to chat, and reconnect voice. The exact source answer, qualifications, URL and acquisition time reach later model inputs with no repeat lookup. A second fixture tests chat-to-voice recall. These are model-input/transport assertions, not generated arithmetic or live comprehension tests.
- Tests preserve visitor/publication isolation, expiry, complete citation/condition retention, bounded storage/context, read-only recall, and rejection of stale action handles after Home/Back/query changes.
- Independent review reproduced missing completed answers in the next request of the same voice connection and a context-budget failure with eight retained findings. Both have regressions: exact completed dialogue survives without a visible card or assistant captions; cancelled late answers are excluded; a dense 24-record foreground still fits under 48,000 bytes with eight retained research results. History discovery followed by exact recall makes zero provider calls and cannot bind directory metadata as research evidence.
- Whole-project no-emit TypeScript checking, focused ESLint and whitespace checks passed after the final changes.
- The local development server was restarted and the published cake-shop route returned HTTP 200. This is route availability only; no voice connection or paid action was started.

The earlier broad website task reported an unrelated sibling-runtime byte-parity failure in `tests/gpt-live.test.ts`; its concurrent files are preserved. This investigation does not claim an aggregate `npm run check`, live speech accuracy, tax-rule applicability, physical-device behavior or deployment.

## Next acceptance test

The existing $3 cap remains unchanged, with no verified remaining allowance for agent-initiated paid testing. Do not start another such test under this run. A future authorized live test should record from before the first utterance:

1. Research one applicable rule, rate or measurement and state its source/conditions.
2. Change the displayed content; ask a related calculation using different quantities.
3. Use Home or Back, switch voice/chat, and ask what was established earlier. Verify no needless repeat search.
4. Change a condition that matters, such as location, date, eligibility or item type. Verify that the assistant checks applicability instead of blindly copying the earlier rate.
5. Reconnect voice. It should wait for fresh speech and retain the conversation's still-valid research. Finish with a different publisher domain to check generality.

Compare recorded inputs, requested actions, confirmed displays, completed answers and actual spoken behavior separately. A successful mocked test does not establish the live model's judgment or arithmetic accuracy.
