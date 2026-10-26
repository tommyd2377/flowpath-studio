# Text Box plugin

The October 26 user-approved interaction replaces the creator text-entry field with **Plugins → Text Box → Apply plugin** in waveform settings. Save, then open the waveform and start a new conversation. The user's manual testing uses the normal application and Google account flow on `http://localhost:3220`; synthetic owners belong only to internal automated tests.

## First version

- Say **Start writing** or **Start dictation**, then dictate. User transcript fragments populate the plain-text panel without a second model call per fragment.
- Say **Stop writing** or **Stop dictation** to pause capture while keeping the voice conversation running. The panel also has Stop writing.
- Ask **Put a short answer in the box**, **Make that shorter**, **Add another item**, **Clear the box**, or **Undo that**. GPT-Live delegates to GPT-6 Luna, whose validated `update_text_box` call operates on this conversation's panel. Editing current content first reads the panel.
- Clear, Undo and Copy text are explicit buttons. Ending a call keeps its text available to copy, including the paid/admin account flow. Starting another conversation or leaving the page clears it; paid visitors return through the existing payer/consent gate. Each conversation starts empty. Text stays in tab memory, never creator configuration, application storage or analytics. Tool results include current text in the existing model conversation so requested edits can use it. Provider data policy still applies.
- The four exact start/stop phrases are reserved controls, including inside dictated text. Other wording uses model delegation. Transcription can be mistaken or delayed. Request literal quotations containing reserved phrases as a written answer instead.

The first version does not add uploaded-document retrieval, web search, cross-session storage, arbitrary HTML or third-party executable plugins. Private creator instructions are not a visitor document library. News remains separate.

## Configuration and authority

`lib/text-panel.ts` accepts optional `null`, legacy `{ type: 'text', version: 1, text: string }`, and interactive `{ type: 'text', version: 2 }`. Version 2 rejects extra fields, including saved `text`. Version-1 records remain readable without migration and keep their approved static display until the creator explicitly applies or removes Text Box. No existing record is rewritten by deployment or page load.

Version 2 enables a built-in capability without creator-authored display text. It is available with ordinary Firebase accounts even where the optional creation-review adapter is not activated. Existing name/instruction rules remain. Where creation review is enabled, changing the plugin changes the exact candidate digest and requires matching approval. Legacy authored display text retains its review gate. Visitor dictation never updates creator review or published configuration.

The server reads the saved plugin after authenticating waveform access. A browser cannot enable it through the session POST body. Only enabled conversations receive the text tool and relevant transcript/delegation events. Their data channel may return tool results and request continuation; model selection, configuration, secrets and account authority stay server-side. The browser executor only changes local text; its acknowledgments never determine billing, membership or publication.

## Event lifecycle

`lib/live-text-session.ts` owns bounded ephemeral text and undo history. `lib/use-voice-session.ts` creates one controller per conversation and finishes it during teardown. `components/LiveTextPanel.tsx` renders escaped plain text and controls, never raw HTML.

Only completed `response.output_item.done` function items with validated IDs/arguments execute. `response.created` binds work to a response/delegation. Calls are deduplicated, results use `response.item.create`, and one `response.create` follows completion after outputs are supplied. Local controls invalidate known in-flight operations. A delegated read binds subsequent edits to the current panel revision, so an edit based on that read cannot discard newer dictation. A closed controller ignores later provider events; local Clear/Undo/Copy remain available afterward.

Transcript spaces and timing are preserved; duplicate/stale fragments are ignored. Start/stop commands span fragment boundaries without dropping ordinary final letters. Local stop protects against known pending work; fully delayed delegation metadata has a best-effort timing boundary, not a precise provider cancellation acknowledgment. Complete validated tool replacements appear at once; partial JSON is never executed. Bounds are 4,000 characters, ten undo snapshots and finite event/tool tracking. Existing voice admission, cancellation, deadline and spending controls remain.

## Verification

Unit tests cover capability validation, owner saving, exact review binding, Luna/tool setup, transcript fragments, controls, invalid/duplicate/superseded calls, undo and closure. Browser tests use a mocked Firebase account interface and fake media to verify application/removal, dictation, tool updates, escaping, mobile width and fresh-conversation reset. These make no paid API calls and do not replace the user's real Google/microphone/provider acceptance test.

October 26 local verification: `npm run check` passed lint, typecheck, all 288 unit tests and the production build in a source-only temporary checkout without private environment files. `npm run test:browser` passed 52 tests; `npm run test:browser:paid` passed six synthetic tests. The final homepage-description update also passed the six focused voice-configuration tests. The actual development server was restarted on port 3220: home/account returned HTTP 200 and the account endpoint reported Firebase mode. No paid provider call, production deployment or GitHub push was performed for this implementation.

Hundreds of milliseconds is a first-visible-text goal, not a measured guarantee. Transcript arrival and delegated model time must be measured separately. No model fallback or automatic paid retry is installed.

### Live startup correction, October 26

The first real Text Box start returned HTTP 400: `session.client.data_channel.allowed_server_events[4].response_event` was missing. A bare `response.event` selector is invalid. The configuration now explicitly selects nested `response.created`, `response.output_item.done`, `response.completed`, `response.failed` and `response.incomplete`, as required by the [Live create-session schema](https://developers.openai.com/api/reference/resources/live/methods/create). Regression tests failed against the old request and pass with the correction; the provider mock validates selector fields independently of the configuration builder. Both diagnostic modes are covered. `npm run check` (288 unit tests) and all 52 standard browser tests passed after this correction.

With the user's explicit Brave/localhost testing authorization, the coordinator clicked Start once in the actual signed-in Google-account waveform with Text Box enabled. The live POST returned 201 and the UI reached Conversation connected; End completed with a successful DELETE. Subsequent user-triggered starts also returned 201. Text appeared and remained after one call ended, but full dictation and delegated-edit correctness were not established: coordinator End/Escape actions overlapped the user's speech. The user's report that Start writing ended voice therefore remains unconfirmed independently of those actions. No automatic restarts or retries were added. Do not treat mocked coverage or successful connection as proof of all spoken operations or latency.

Official references: [transcript deltas](https://developers.openai.com/api/docs/guides/live-conversations#transcript-deltas), [delegation and function continuation](https://developers.openai.com/api/docs/guides/live-delegation), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).
