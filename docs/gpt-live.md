# GPT-Live voice architecture

Studio and the independent FlowPath app use identical copies of `lib/gpt-live/{protocol,backend,runtime,browser}.ts`. Each repository builds independently; `tests/gpt-live.test.ts` compares these files byte for byte when both sibling checkouts are available. Changes to the common core must be applied to both repositories. Product content and tool adapters remain app-specific.

## Shared path

Browser microphone and speaker → audio-only WebRTC → GPT-Live-1 (Marin). The application server creates the session with `POST /v1/live/sessions`, reads the JSON session ID and SDP answer, and attaches to `/v1/live/sessions/{id}/attach`. The browser has no provider command channel or provider credentials. Browser media readiness precedes the opening message. ICE gathering completes before the offer is submitted.

GPT-Live uses client delegation. The server accumulates exact timestamped transcript fragments and supplies those plus current validated application state to GPT-5.6 Luna through Responses. Delegation events carry an opaque ID, not task text. Transcript gaps do not trigger tools or cancel jobs. A new delegation or explicit manual change invalidates pending results; ordinary backchannels do not cancel backend work. Context is ephemeral and bounded. The common backend has no automatic retries or parallel tools and permits at most four tool rounds followed by one tool-free response; Studio selects a stricter one-tool limit. Initial output is capped at 1,200 tokens and continuations at 500. Each delegated job has a 35-second deadline.

Only app adapters execute tools. Studio validates published references and waits for browser acknowledgments for plans, navigation and external search views. FlowPath retains its news attribution, story selection, path, research and screen handlers. Large catalogs and research stay in backend context. Speakable results return through `session.commentary.append`; context and application instructions use their separate append events. Every append is conservatively bounded to at most 480 UTF-8 bytes, below the 500-token API ceiling.

## Audio and lifecycle

Input, output and backend activity remain independent. Waveforms and startup protection use browser media levels, not transcript arrivals, backend completion or append acknowledgments. Both apps keep original microphone capture running and mute cloned outgoing tracks during the iOS opening protection. Protection ends two seconds after first observed output activity, with a ten-second no-output escape. Microphone initialization and acoustic echo cancellation still belong to the browser.

Output quiet uses a 1.2-second observation window. This is a UI heuristic, not proof a sentence finished or that a user heard it. FlowPath uses it to advance its per-card briefing; long within-sentence pauses may need real-device tuning. Studio does not put generated assistant transcripts into cross-mode history as fully heard answers. User caption grouping is revisable; the backend keeps original fragments during the active session.

End requests `session.close`, keeps the sideband receiver alive, and awaits `session.closed` before releasing resources. A bounded timeout retains the latest duration as unconfirmed and invokes the hangup fallback. A successful HTTP hangup is not proof of final usage. Session duration snapshots are cumulative, never summed; backend token usage is separate. Existing app session-duration limits remain: Studio 120 seconds; FlowPath 600 seconds locally or 270 seconds on its hosted transport. These app limits do not create different voice quality tiers.

Both apps also use the shared inactivity policy. A session stays open while visitor input, assistant playback or backend work is active; after the configured quiet period the browser and server close the Live session. Studio publishers choose 30 seconds, one minute, two minutes or Never, with one minute as the default. The server remains authoritative so a backgrounded tab cannot leave a silent session charging. Tapping the waveform after an inactivity close starts a new session with the current bounded context.

## Publisher defaults and compatibility

Every new Studio publisher defaults to voice using GPT-Live. Both legacy saved Standard and Premium values resolve to GPT-Live-1; their obsolete quality picker has been removed. Publisher tone, content, greeting and voice/chat choices remain configurable. The legacy recorded-turn provider returns 410 and asks callers to reconnect using the continuous session endpoint. The offline publisher preview remains deterministic and does not call a provider.

Studio's **End voice after inactivity** setting defaults to one minute and is persisted with the published visitor configuration. Existing saved settings without the field resolve to that default when read. `Never` is available for publishers who want the existing hard session cap to remain the only automatic boundary.

Studio's daily voice allowance now bounds session starts/openings and delegated backend tasks, not individual sentences spoken by the continuous frontend. Independent hard session limits bound voice duration, including small talk and silence. Live duration and Luna token observations are operational measurements; they are not Stripe charges or reconciled monetary balances. The synthetic billing ledger and Stripe test controls remain separate and do not authorize live AI calls.

## Verification boundary

Offline unit and browser tests use synthetic data, provider events and audio levels. They validate request schemas, tool limits, cancellation, publication boundaries, readiness and close handling. They do not establish model quality, provider account access, audio-only SDP interoperability, production hosting lifetime, or an iPhone echo fix. Those require a separately authorized live test. No deployment or live API call is part of this migration.

References: [migration](https://developers.openai.com/api/docs/guides/live-migration), [client delegation](https://developers.openai.com/api/docs/guides/live-delegation), [sessions](https://developers.openai.com/api/docs/guides/live-conversations), [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live), [server control](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live).
