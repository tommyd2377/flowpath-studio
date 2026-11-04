# Waveform startup timing — November 3–4, 2026 local work

The November 3 changes overlap independent work after a deliberate waveform click and were handed to the coordinator. The November 4 follow-up also prepares a short-lived availability hint before the click; its integration and live measurement are recorded in the handoff receipt. Neither change preconnects to a paid provider, skips ICE gathering, caches server authorization, or changes quotas/deadlines. The original November 3 measurements below are synthetic.

## Baseline and critical path

Source: the current uncommitted `codex/hosted-tester-demo` checkout at `studio-voice-lifecycle/theVoice`, copied into a source-only temporary workspace. The original checkout and localhost:3220 session were preserved. The existing conversation recorder was unsuitable for these measurements because it includes transcripts; the new timing report accepts only fixed labels and numbers.

Before: click → readiness GET (scope/auth/content and availability) → AudioContext resume → microphone permission/capture → offer/local description/complete ICE → session POST (scope, current-identity checks, admission, required deadline, provider creation, durable ID, supervision) → remote description and provider session event → conversation readiness → greeting/output → playback.

The scope resolver previously serialized independent admin, visitor and waveform resolution on readiness and creation requests. The candidate overlaps those reads, retaining the existing error precedence, current-identity/content checks and later transactional admission. It also overlaps AudioContext resume and microphone capture only after enabled readiness. A captured stream immediately belongs to the session and is stopped even when context resume is pending, fails, or the user cancels.

Required ordering remains: provider creation follows admission/deadline checks, provider identifiers are persisted before supervision, and SDP is not released without its required observer. No elapsed-time animation or status change is counted as a latency improvement. The provider's [WebRTC sequence](https://developers.openai.com/api/docs/guides/voice-webrtc#understand-the-connection-sequence) explicitly requires completed ICE gathering; that wait remains.

## Synthetic evidence

These are measured application fixtures, **not a live baseline or promised user improvement**. They use fake microphone/playback/provider responses and fixed injected waits. Browser page loading and dev compilation happen before the click, so these figures do not measure cold server/provider startup or permission-dialog time.

| Measurement | Before | Candidate | Method |
| --- | ---: | ---: | --- |
| Scope resolution | 248 ms median | 82 ms median | Three 80 ms resolver waits; three samples each (250/244/248 → 82/80/82) |
| Click → conversation readiness | 1,506 ms median | 1,100 ms median | Three samples (1506/1503/1612 → 1103/1100/1098) |
| Click → simulated non-silent playback | 1,753 ms median | 1,344 ms median | Three samples (1753/1747/1850 → 1349/1344/1344) |

Browser injected delays: readiness 150 ms, context resume 400 ms, capture 500 ms, session response 250 ms, provider start event 150 ms, then output 200 ms. The server-scope gain is measured separately; do not add it to this browser benchmark, whose session routes are intercepted. The largest injected waits were capture and context resume. Actual browser, Firebase, supervisor and provider bottlenecks remain unmeasured.

## Timing-only manual measurement

After integration into an explicitly selected test host, add `?startup=1` to the waveform URL (or `&startup=1` if it already has a query). This only enables timing for deliberate starts. Do not enable the transcript-recording checkbox. Click the waveform, allow any permission prompt yourself, listen for the greeting, and confirm a brief spoken interruption works. Click **Review startup timing**, then copy the timing-only JSON if needed. It is held in the tab, replaced on the next start, and discarded on navigation/reload. No upload, audio capture log, transcript log or extra provider request is introduced.

Use the same browser/device/network and waveform for before/after. Keep cold first-start, warm subsequent-start, and permission-prompt samples in separate groups. Note browser version, whether the app/provider was already warm, whether permission was already granted, whether a prompt appeared, and whether playback was blocked. A page reload alone does not prove the server or provider was cold. Stop each conversation and wait for confirmed cleanup before another deliberate start. No automatic repeats.

For an instrumented before/after comparison, use the accompanying instrumentation-only patch for the before version, then the full candidate patch from the original source snapshot for after. Do not stack those two patches. Keep the user's existing serving session intact; choose a separate approved test host or integrate when that session is finished. Do not copy credentials or private runtime data into the source copies.

Read these fields:

- `conversation_ready`: application session/control ready with captured microphone, applied answer and provider `session.started`; this is not proof of physical microphone transmission.
- `microphone_requested` → `microphone_acquired`: permission plus device capture. `permissionBeforeCapture` is best-effort and remains unknown if a permission query finishes too late. Human prompt time cannot be inferred separately; annotate it.
- `audio_resume_requested` → `audio_context_running`: local context startup. `local_description_set` → `ice_complete`: ICE gathering. `session_requested` → `session_answer_received`: full response/first streamed answer, including nested server work.
- `fp_scope`: server identity/content resolution, including credential validation; `fp_admission`: availability/reservation/recovery/cancellation checks; `fp_deadline`: required scheduling; `fp_provider`: provider creation through response parsing; `fp_persist`: durable provider-ID write; `fp_supervision`: sideband/local supervisor readiness. Absent phases did not run or were not complete when headers were emitted. Server and browser clocks are independent; these are nested durations, not timestamps to subtract or sum.
- In the streaming hosted path, the first answer frame includes observer readiness but `fp_supervision` is omitted because response headers were already emitted. Confirmation-frame waiting is visible between `remote_description_applied` and `supervision_confirmed`.
- `greeting_requested` is available for browser-controlled greetings only. Its interval to `first_output_signal` includes generation, transport and buffering. Server-controlled greetings have no browser dispatch timestamp; use `provider_session_started` → `first_output_signal` as a combined interval, never as isolated generation time. No provider generation-only timer is invented.
- `first_audible_output`: first instantaneous non-silent remote sample while audio playback has resolved and the context is running, unmuted/unpaused. This is a browser-observed playback proxy sampled every 50 ms, not proof of physical sound. Pending/blocked playback and the waveform's 700 ms visual hold cannot satisfy it. Human listening remains necessary. `first_output_signal` can precede readiness/playback permission.

Live testing by Codex requires new explicit approval for this chat's exact app, host, task and bounded call budget. Existing credentials and earlier chats' approvals are not authorization. A reasonable later comparison is one deliberate before start and one after start; report permission/coldness differences rather than silently retrying.

## Verification

Run with Node 24 and live disabled: `npm run check` and `npm run test:browser`. The browser suite uses isolated profiles, synthetic accounts/media/providers, blocked external browser traffic, and a separate fixture port. Tests cover concurrent authorization with revoked access, header allowlisting, denied microphone, disabled readiness, late capture cleanup, cancellation while context resume is pending, blocked/pending playback and instantaneous-signal timing. Paid-preview fixtures also exercise the shared hook without real payment/provider calls.

The companion handoff receipt records final counts, source hashes, patch application checks and the remaining live limitations. This source change is not deployment or live acceptance evidence.

## November 4: preparation before the click

Once the existing demo-access gate has loaded and allows access, the visible waveform page prepares one availability GET. Pointer entry or keyboard focus may refresh it after 60 seconds; there is no timer, polling, provider connection, microphone capture, AudioContext creation, reservation or automatic paid retry. Paid-payer and published-preview flows retain click-time readiness. All unpaid readiness requests share the existing visitor-cookie Web Lock, including personal waveform URLs that can initialize that cookie.

Only a successful enabled result can be reused, once, within 60 seconds of the request starting. A click joins an unfinished check. An expired, disabled or failed hint falls back to the normal readiness GET; a joined preparation failure permits one ordinary GET, never an automatic retry of a paid session POST. Account changes, scope changes, hidden-page preparation and departure invalidate or abort the hint. Canceling a start still aborts its request and stops late media. The final POST repeats current identity, safety, admission and cleanup checks before creating any provider session. A change after preparation can therefore still reject a start.

Preparatory GETs carry `X-FlowPath-Prepare: 1`. Franklin's speculative path checks only its existing approved public snapshot and current membership: it neither creates a first snapshot nor adds a review follow-up. A missing snapshot is inconclusive and the normal click-time GET keeps its existing behavior. Selected Knowledge is resolved only on POST, where it is needed to register the tool; GET, PATCH and DELETE no longer trigger document-selection reconciliation. Knowledge is not part of the waveform safety digest. The private account adapter batches its first two transaction reads with Firestore `getAll`, retaining the conditional extra-waveform read and fresh account-wide testing preference.

The timing report adds `readinessPreparation`: `source` is `ready`, `pending` or `cold`, followed by the actual request duration and how far before the click it started/completed. The `events` timeline still starts at click zero. `readiness_wait_started` and `prepared_readiness_used` distinguish consuming a prepared hint from `readiness_requested` for an ordinary GET. Failed readiness now retains its available server timings. Do not count a prepared request's earlier duration as time spent waiting after the click, or add overlapping server phases together.

For real measurement, use the same approved local URL with `?startup=1`, keep the tab visible, and click within 60 seconds of opening it. A later pointer entry/focus can refresh an expired hint; the report establishes whether it was ready or still pending. Record the time from page arrival as well as from click: preparation shifts work earlier and does not eliminate it. Use a separate immediate-click sample only with additional authorized call budget. Stop each call, confirm cleanup, and retain the timing-only report. No transcript recording is required. Automated synthetic results and browser-observed playback remain separate from hearing the actual greeting and testing speech.

In the last two prepared localhost trials, browser-detected first audio arrived at 6.22 and 7.47 seconds, compared with one earlier 14.27-second reference. The final prepared hint was already more than 22 seconds old at click. A separate live cancellation after the session request began cleared without reaching ready or first audio. These are individual local samples. The idle supervision helper is localhost-only, and hosted startup timing has yet to be measured.
