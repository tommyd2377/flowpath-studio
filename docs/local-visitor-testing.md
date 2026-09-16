# Local visitor test recordings

Use this when a voice/chat request goes wrong and you want to trace what the
application supplied to the model, what it requested, and what the browser did.
Recording is opt-in, limited to a loopback development server, and disabled in
production. It does not change prompts, model settings, task limits or provider
requests, and does not issue additional model calls.

## Test workflow

1. Run the usual local Studio server and open a published visitor page.
2. Open **Local test recorder** near the developer diagnostics, then click
   **Record test session**. Start voice afterwards. If a call was already open,
   reconnect it yourself so the recorder can capture its server-side context;
   the recorder never reconnects or interrupts a call for you.
3. Test normally with voice, chat and clicks. When something goes wrong, click
   **Mark a problem**. Optionally enter a note first. You can also note your local
   clock time and continue testing.
4. Click **Stop recording**, then **Open test timeline**. Stopping the recorder
   leaves the conversation running. In the timeline, select a session, search a
   time, phrase or request ID, or filter to problem markers, conversation,
   failures or model events. Expand an event to see its captured details.
5. **Export recording** downloads a JSONL copy. **Delete recording** removes the
   local original after confirmation. Neither action sends it to an external
   service. Exports in Downloads are separate copies you manage yourself.

The timeline is `/dev/recordings`. It refreshes on demand rather than polling.
The recorder resumes within the same tab after a page reload while the server
session is still active. A new tab is a separate opt-in recording. Stop recording
before reloading to ensure the final browser buffer is saved.

## What the record means

| Evidence | What it can establish |
| --- | --- |
| `voice.config`, `voice.sent`, `voice.received` | Actual voice configuration and sideband messages, including supplied context, transcript events, delegations, commentary and interruption events |
| `model.request`, `model.transport`, `model.response` | Bounded copies of actual backend inputs/tools/settings and output, with the WebSocket cache reference/delta when used |
| `tool.request/result`, `action.request/result/failed` | Requested actions, arguments, validated results, failures and timings; direct navigation is captured as well as delegated work |
| `chat.submitted`, chat/voice stream events | Typed input and model-provided transcripts/answers, including provisional output |
| `screen.observed`, `screen.received`, `screen.accepted`, `screen.confirmed` | Browser state versus server-accepted context and display acknowledgments |
| `http.*`, `diagnostic`, `problem.marked` | Request timing/status, existing browser diagnostics and tester notes |

There is **no access to hidden model reasoning**, and opaque encrypted reasoning
content is removed from recordings. No reasoning summary or explanation request
is added to the model. A later diagnosis based on these observations is an
inference, not a recovered thought process.

No microphone audio, screenshots, video, image bytes, SDP or connection
credentials are saved. A transcript event is evidence of a transcript, not proof
that the speaker heard that text. Browser playback diagnostics are useful but do
not measure the sound at a physical speaker. Inputs describe what the model was
given; they cannot prove it attended to or understood every part.

Each event includes a wall-clock timestamp, a process-local monotonic timestamp,
source and recording sequence. Request IDs, turn generations, interaction
revisions and acknowledgment IDs provide the causal links. Browser and server
monotonic clocks have different origins; network batches can arrive out of order.
The timeline sorts by wall clock, while JSONL keeps server arrival order. A start
event includes Node version and hashes of the relevant source files at that time.

## Storage, scope and overhead

- Files live in `.visitor-recordings/<id>.jsonl`, excluded from Git. The directory
  is created with mode `0700` and files with mode `0600`.
- Capture only attaches to explicit, same-origin requests from the local browser
  recording. One visitor's recording ID is not inherited by other server requests.
- API reads and writes require development mode, a loopback URL and Host, an exact
  matching Origin and a custom header. Production returns 404 before parsing the
  body or accessing recording files. These controls are for a local development
  tool; do not expose the development server through a public proxy.
- Limits: 20 MB and one hour per recording; four active sessions; ten retained
  sessions. Starting or listing sessions removes inactive files older than seven
  days and rotates older inactive recordings to stay within the count limit.
- Browser queues are bounded to 500 events/500,000 characters; server queues to
  2 MB per session. Events are bounded in size, depth and node count. Overflow and
  truncation are reported; stopped/crashed sessions are distinguished.
- Writes are batched off the application's awaited action path. Serialization
  still costs CPU and local requests still cost I/O, so zero timing impact is not
  promised. Failure, stopping and queue overflow never trigger model retries or
  cancel the conversation. Recorded and unrecorded real-world latency still need
  measurement before making performance claims.
- Known credential fields and token patterns, URL credentials/query parameters,
  embedded JSON credentials, binary payloads and encrypted model state are
  redacted before queueing. Transcripts and published content remain readable;
  free-form personal information is not automatically anonymized. Use nonsecret
  test content and review exports before sharing them.
- A crash/reload can lose buffered events. A recording without a stop marker is
  shown as incomplete after server restart. Starting recording during an existing
  voice session cannot retroactively attach its server observer; reconnect to
  capture that connection. Model capture does not include unrequested private
  publisher data or hidden state outside the supplied API context.

## Implementation map

| File | Responsibility |
| --- | --- |
| `lib/visitor-test-events.ts` | Shared event shape, bounded redaction/copying, failure isolation and opt-in browser observer |
| `lib/visitor-test-recording-store.ts` | Scoped server observers, loopback request gate, bounded JSONL persistence and rotation |
| `app/api/dev/recordings/route.ts` | Local session start/append/stop/list/read/export/delete API |
| `lib/visitor-test-recording-client.ts` | Browser buffers, request correlation headers, start/stop/problem marker and tab resume |
| `lib/visitor-test-socket.ts` | Studio-only observation of the existing socket; shared `lib/gpt-live` stays unchanged |
| `lib/visitor-task-runner.ts`, `lib/visitor-response-connection.ts` | Model/tool observations before and after actual calls; transport cache details |
| `lib/visitor-realtime-session.ts`, `lib/visitor-realtime-control.ts`, `lib/visitor-chat-task.ts` | Voice/chat context, transcripts, actions, failures and display receipts |
| `components/VisitorAssistant.tsx`, `lib/use-visitor-session.ts`, `components/VisitorTasks.tsx`, `components/SearchExplore.tsx`, `components/VisitorWorkspace.tsx` | Existing browser action and rendering boundaries |
| `components/VisitorTestRecorder.tsx`, `components/VisitorTestTimeline.tsx`, `app/dev/recordings/page.tsx` | Local controls, marker, searchable timeline and export |

## Verification and continuing QA

Run with Node 24:

```sh
npm run lint
npm run typecheck
node --conditions=react-server --import tsx --test tests/visitor-test-recording.test.ts
npm run test:recorder
```

The recorder browser suite uses a disposable source copy and development server
on port 3225, isolated demo data, a clean environment without service keys and
mocked voice/media APIs. It does not use a signed-in browser profile or the main
Studio server on port 3220. It requires the same installed isolated Playwright
Chromium as the existing browser suite. Temporary copies/recordings are removed
after the suite.

Unit coverage checks redaction, bounds, session isolation, retention, write
failure, production disablement, cancellation, and identical mocked model
requests/actions/answers with recording on, off and a broken observer. Browser
coverage checks desktop/mobile recording, actual local navigation, markers,
timeline search/export, voice transcript/display receipts, stopping without
ending voice, and persistence failure without breaking the app. This does not
establish live model comprehension or physical microphone/speaker behavior.

For the continuing QA loop, turn each reported incident into a small synthetic
regression with the expected final browser state. Preserve request and
acknowledgment ordering, including interruption, stale output and timeouts.
Recommended recurring scenarios:

1. Find, filter and open published information using names, synonyms and visual
   references; confirm the correct evidence is available to the model.
2. Open another item while one is foregrounded; close, back, Home, clear, reopen
   and reset filters. Assert the visible state, not just the assistant's answer.
3. Request web/image search with publisher permissions on and off; preserve
   source attribution and verify loading, failure and display acknowledgments.
4. Interrupt mid-request, navigate manually, pause and resume; reject stale actions
   and speech rather than resurrecting the old task.
5. Repeat across unrelated synthetic publishers, desktop/mobile, keyboard and
   reduced motion; require useful browsing when AI is unavailable.

Future live evaluation should use an explicitly approved call budget and compare
task success, wrong-object/stale-action rates, first-audio/first-display latency,
tool/provider failures and observed usage by model/configuration version. A
successful tool response without a browser receipt is not a completed UI task.
An LLM judge can help triage transcripts but must not replace deterministic state
assertions or human voice checks. Automatic replay that reissues paid requests,
production content collection, acoustic recording, an evaluation service and a
production telemetry dashboard are not enabled by this implementation.

## Verification snapshot — 2026-09-16

- Recorder unit suite: 11 passed, including Studio voice adapter parity.
- Isolated recorder browser suite: 4 passed, including desktop and mobile.
- Lint, typecheck, production build and `git diff --check` on the recorder's
  modified files: passed. The checkout continues to receive concurrent changes.
- Broader selected voice/chat/task regressions: 128 passed, 1 failed. The remaining
  failure is the existing cross-repository `lib/gpt-live/browser.ts` byte-identity
  assertion while the separate voice-response task is changing that file. This
  recorder work does not edit shared GPT-Live files; its socket observation is in
  Studio's adapter. Concurrent catalog/protocol edits were preserved.
- No paid provider calls, real microphone/speaker testing or deployment. The
  normal Studio development server was restarted on port 3220 and its unsigned
  root request correctly redirected to sign-in.
