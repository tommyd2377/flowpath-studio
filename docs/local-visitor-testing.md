# Local visitor test recordings

Use this when a voice/chat request goes wrong and you want to trace what the
application supplied to the model, what it requested, and what the browser did.
Recording is opt-in and disabled in production. Ordinary recording and timeline
access stay on a loopback development server; an explicitly paired phone can
write to its own temporary recording over local HTTPS. Recording does not change prompts, model settings, task limits or provider
requests, and does not issue additional model calls.

## Test workflow

1. Run the usual local Studio server and open a published visitor page.
2. Open **Local test recorder** near the developer diagnostics, then click
   **Record test session** before or during voice. For an existing connection,
   wait for **Voice server capture attached** before reproducing the problem.
   Attachment does not reconnect or interrupt audio and makes no model calls.
   Earlier unrecorded speech is unavailable. An explicit incomplete-capture
   warning appears if attachment fails (including connections started before
   this recorder update or on a different development worker).
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
After recorder code changes during development, reload the page and verify the
active recording and voice attachment again before testing. Hot reload can
replace the recorder's client observer while an older mounted UI still shows
its previous status; that is not evidence of continued capture.

## Paired phone testing

The existing local HTTPS server must already be reachable and trusted on the
phone. This pairing workflow does not create certificates, change network
permissions, start voice, or make provider calls.

1. On the development Mac, from the repo root with Node 24, run the command
   below using the server's exact HTTPS origin and published site slug:

   ```sh
   node scripts/pair-phone-recording.mjs https://YOUR-LAN-IP:3220 YOUR-PUBLISHED-SLUG
   ```

   For the current LAN server, the origin is `https://192.168.1.250:3220`.
   The command prints a private local HTML card's path, never its invitation.
   Open that card locally and copy its link to the phone yourself. Keep the
   card/link private; do not paste it into logs, issues, screenshots or chat.
2. Open the link within ten minutes. The invitation is in its URL fragment,
   which is removed immediately on page initialization and is never sent in
   an HTTP URL or referrer. Nothing records yet. Open **Local test recorder**
   and tap **Start paired recording** to explicitly consent on the phone.
3. Start or continue voice/chat yourself. A running voice connection can attach
   without reconnecting. Check **Voice server capture attached** before testing
   spoken responses; ordinary browser capture alone is incomplete voice evidence.
4. Tap **Stop recording** when finished. Delete the private pairing card on the
   Mac afterward. A new test after stopping or server restart needs a new pairing.

Each one-use invitation creates exactly one recording for one publisher and one
HTTPS origin. Acceptance rotates the invitation into a separate 30-minute grant,
held only in that phone tab's session storage. The Mac stores token hashes, not
usable grants. Reloading the same opted-in tab can resume its still-active
recording through an empty append check; it never lists other recordings.
Navigating to another publisher ends browser capture and attempts one stop.
Server expiry remains independent if the phone goes offline. Stopping capture
does not stop the conversation or alter the site's separate voice time limits.
If a save/stop request fails, the server observer may continue until its grant
expires; stopping the development server ends capture immediately.

The phone can append observations, attach its own existing voice connection and
stop **only that recording**. It cannot start arbitrary recordings, list, read,
export or delete them. Pairing requires development mode, an exact same-origin
HTTPS request, the paired publisher and the active grant. Production rejects
requests before reading files. This does not weaken the application's ordinary
LAN, publisher, session or authentication checks. Initial support accepts private
IPv4 addresses and loopback; public hosts, LAN DNS names and IPv6 LAN addresses
are not supported. HTTPS loopback pages use the same explicit pairing flow;
ordinary unpaired recording/history stays on HTTP loopback. Invitation and
grant-bearing requests reject redirects so their credentials cannot be forwarded
to another endpoint.

Saved JSONL uses the existing local timeline format and retention/redaction
limits. On a server bound only to the LAN IP, `/dev/recordings` cannot read the
recordings remotely, even from the Mac's browser using that LAN URL. After phone
testing, stop the LAN server and run the ordinary `npm run dev` loopback server
from the same checkout; open `http://127.0.0.1:3220/dev/recordings` to inspect the
saved session. The files also remain available for authorized local inspection.
No raw audio or hidden reasoning is captured, and speech before consent cannot
be recovered.

## What the record means

| Evidence | What it can establish |
| --- | --- |
| `voice.capture_attached`, `voice.config_snapshot`, `voice.context_snapshot`, `screen.published` | Attachment boundary, original session configuration and current application context with referenced published record values; snapshots are not reconstructed prior model inputs |
| `voice.config`, `voice.sent`, `voice.received` | Actual voice configuration and sideband messages, including supplied context, transcript events, delegations, commentary and interruption events |
| `model.request`, `model.transport`, `model.response` | Bounded copies of actual backend inputs/tools/settings and output, with the WebSocket cache reference/delta when used |
| `tool.request/result`, `action.request/result/failed` | Requested actions, arguments, validated results, failures and timings; direct navigation is captured as well as delegated work |
| `chat.submitted`, chat/voice stream events | Typed input and model-provided transcripts/answers, including provisional output |
| `conversation.memory`, `conversation.memory_unavailable` | The bounded historical research supplied to voice, or a safe hydration failure; actual delivered parts also appear in `voice.sent` |
| `voice.application` with `answer_completed` | A successful, revision-scoped backend reply retained for dialogue, even without a display change; not proof of audible delivery |
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

Handled `search_explore` failures now include `action.failed` with a bounded
`phase` (`validation`, `search`, or `display`), operation and safe diagnostic
classification. An omitted unused argument can be distinguished from a provider
failure without exposing its raw error body or automatically retrying it.

Before the Record button is pressed, ordinary development diagnostics may show
timings, failures and stops, but they do not reconstruct the missing conversation.
Retained earlier dialogue in an attachment snapshot also does not establish its
original timestamps or the complete earlier model inputs. The [noon investigation](qa-voice-2026-09-19-noon.md)
demonstrates this boundary. Conversation memory works with recording on or off;
enabling recording changes observation, not which past facts the assistant receives.

The September 19 QA incident exposed a gap in that binary omission: output-audio
events used the generic `delta` field. New writes now omit these audio deltas,
while keeping transcript deltas. Timeline/export reads sanitize older events as
well; existing ignored originals remain private under the retention policy.
See the [incident and verification report](qa-real-content-2026-09-18.md).

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
- The ordinary recording API's reads and writes require development mode, a loopback URL and Host, an exact
  matching Origin and a custom header. Production returns 404 before parsing the
  body or accessing recording files. The separate paired-phone endpoint permits
  only scoped writes, voice attachment and stopping as described above. These controls are for a local development
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
  voice session attaches its server observer going forward. It cannot recover
  earlier speech or model events. The capability-scoped local registry is
  removed when the session ends; it never writes tokens or recording IDs to
  Firebase. Attachment failure is shown rather than silently reporting success. Model capture does not include unrequested private
  publisher data or hidden state outside the supplied API context.

## Implementation map

| File | Responsibility |
| --- | --- |
| `lib/visitor-test-events.ts` | Shared event shape, bounded redaction/copying, failure isolation and opt-in browser observer |
| `lib/visitor-test-recording-store.ts` | Scoped server observers, loopback request gate, bounded JSONL persistence and rotation |
| `app/api/dev/recordings/route.ts` | Local session start/append/stop/list/read/export/delete API |
| `lib/visitor-phone-recording.ts`, `app/api/dev/recordings/phone/route.ts` | One-use phone invitations, expiring origin/publisher grants and write-only capture |
| `scripts/pair-phone-recording.mjs` | Manual local creation of a private pairing card; does not start capture or voice |
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
node --conditions=react-server --import tsx --test tests/visitor-test-recording.test.ts tests/visitor-phone-recording.test.ts
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

Phone unit tests use only synthetic invitations/grants and mocked browser
requests. They cover consent, fragment removal, passive voice attachment,
publisher/origin/session isolation, history denial, one-use replay protection,
expiry/revocation, scoped reload and navigation cleanup. They do not establish
physical iPhone networking or microphone behavior. No real pairing credential
was created during implementation verification.

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

## Active-session capture verification

- Recording can attach to a running local voice connection using that connection's existing capability, without restarting it or issuing a provider request.
- Attachment snapshots include current approved fact values, separately labeled
  from actual subsequent model inputs and outputs. No missing historical speech
  is reconstructed. The timeline warns about older recordings with no server attachment.
- `lib/visitor-test-live.ts` owns the development-only capability-scoped registry;
  `visitor-realtime-session.ts` owns registration, observer switching and cleanup.
- Verified with 95 offline server/recorder/control tests and six isolated recorder
  browser cases, including mocked active-voice attachment and attachment failure.
  These checks do not establish live spoken-phone-number accuracy.

## Optional bounded local paid QA

With explicit authorization for the host, task and dollar ceiling, an ignored
`.visitor-recordings/qa-budget.json` can scope a development-only guard to an
active local recorder. Example (use the actual active recorder ID and site slug):

```json
{"recordingId":"00000000-0000-4000-8000-000000000001","slugs":["synthetic-qa"],"limitMicros":3000000,"voiceReserveMicros":150000}
```

The guard is off without this file and always off outside `NODE_ENV=development`.
It changes neither provider prompts nor output limits. Configured local test
slugs require the matching, validated active recorder and reject paid requests
when its scope is missing or different; other slugs are unaffected. Keep that
recording active and do not run unrelated paid flows concurrently. It covers task backend
REST/WebSocket requests, the older text provider, and nested/direct web, image
and map providers. Mock/local maps do not need paid reservations.

Before sending a request it writes a conservative reservation to
`qa-budget-<recordingId>.json`, under an exclusive filesystem lock. Count
`voiceReserveMicros + sum(entries[].chargedMicros)` against the ceiling. The
ledger survives HMR/restarts. Missing usage, missing/unrecognized service tier,
aborts and failed calls retain their reservation. Measured usage releases only
the difference from a conservative upper-bound cost; these figures are **not
billed totals**. Never delete/reset a ledger or lock to continue spending without
first reconciling the prior run. Recorder events `qa_budget.reserved`,
`qa_budget.measured` and `qa_budget.usage_unknown` contain accounting observations.

The initial $0.15 is a held allowance for **one manually supervised voice session
of at most 120 seconds**, not permission for repeated microphone sessions. Its
backend requests consume the separate guarded token allowance. This guard does
not meter or limit the number of Live session starts; the operator must enforce
that single-session test boundary. Stop on unexpected calls or uncertain usage.

Rates/bounds verified September 18, 2026 against official
[pricing](https://developers.openai.com/api/docs/pricing),
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) and
[web search](https://developers.openai.com/api/docs/guides/tools-web-search):
Luna Fast/long/cache-write input is conservatively charged at $1/M, output at
$3.60/M, hosted web/image search at $0.01 plus up to 128K context tokens. Serialized
UTF-8 bytes plus 20K framing headroom bound request text tokens. A full 128K search
context is added without changing the request's search settings. GPT-Live is
$0.05/minute, billed per second. Reverify these rates before later runs. Other
models, media inputs and unbounded hosted tools are rejected while enabled.
