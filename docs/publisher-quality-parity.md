# Publisher experience parity audit

Reviewed against the independent FlowPath application on 2026-09-09. The identified conversation workflow gaps now have implementations in the shared publisher experience. **Full FlowPath quality parity is not established:** model tiers, session limits, actual provider behavior and acoustic/device performance still differ or require live verification. A waveform and continuous transport alone cannot establish parity.

## Direct interface corrections

- Active calls have a fixed **End voice** control with a touch-sized target and safe-area spacing, so scrolling cannot hide the only touch control that ends a call.
- Validated collection, criteria, relationship and legacy content changes join the other component destinations in settled-layout reveal. Reveal preserves focus, respects reduced motion, accounts for scrolling preview panes, and yields to visitor input.
- Keyboard reset, End and Escape return focus to the waveform or the current Chat input. Touch End preserves the visitor's scroll position.
- Catalog layouts respond to their container width, including an embedded 375px mobile preview; the fullscreen photo viewer still responds to the viewport.
- The external composer and live thinking state reach the catalog's progress status. Manual controls remain available to cancel stale work.
- An initial supplied view creates no spurious Back step, and equivalent later views do not duplicate history.
- Delayed detail focus yields to newer keyboard focus. Continuous busy animations cannot postpone current-view updates or navigation acknowledgements indefinitely.

See [visitor host](../components/VisitorAssistant.tsx), [legacy presentation](../components/SitePresentation.tsx), [shared runtime](../packages/platform-ui/src/Runtime.tsx) and [shared styles](../packages/platform-ui/src/styles.css).

## Conversation behavior implemented

| Area | Implemented behavior | Verification boundary |
| --- | --- | --- |
| Browsing during a call | Manual filtering, selection, reset, disclosure and photo controls invalidate old generation/playback and report the new state while retaining the audio session. Microphone capture pauses briefly until the latest view is acknowledged, so a new utterance cannot overtake it. Passive screen observations update context without cancelling every response. | Mocked browser regressions verify retained connections, stale-output rejection and microphone gating until the latest owner acknowledgement. |
| Actual screen awareness | The browser reports bounded viewport/scroll geometry, visible published entity/source IDs, rendered component types, focused references and expanded sources, alongside the current validated view and catalog state. | These are client observations, not a screenshot or proof of attention. A selected plan is not treated as proof of visibility. |
| Controlled navigation | Voice can request top, bottom or an already rendered published entity/source through `navigate_view`. The browser reports applied/unavailable, with an eight-second server deadline. | Navigation cannot open links or execute business actions; a failed move must not be described as successful. |
| Chat/voice continuity | Current view context and the latest eight bounded messages carry between typed requests and new calls. Voice supplies user transcription and only complete, uninterrupted assistant playback to local history. | History is ephemeral, not a displayed or persisted transcript. ASR is separately metered and may be inaccurate; interrupted assistant speech is not recorded as fully heard. |
| Greeting readiness | Browser connection, remote audio attachment and prepared playback precede a ready update. The supervising server acknowledges application before normal listening; greeting start is gated by that readiness. | Server readiness has a 25-second deadline. Greeting is skipped for visitor-speaks-first or a continued conversation; acoustic startup still needs real-device verification. |
| Natural spoken follow-ups | A grounded answer can use one generation without changing the view. A turn may instead call `present_site` or `navigate_view` once, followed by at most one tool-free continuation. | Structural tests do not establish conversational fluency or model selection quality. No autonomous tool rounds or automatic paid retries are allowed. |
| Voice failure fallback | Voice-preferred sites offer **Continue by typing** after voice errors, even with voice allowance remaining. Exhausted voice also falls back to separately bounded Chat after final playback. | Existing chat allowance remains 25 by default; fallback does not expand the allowance or enable voice on chat-only sites. |
| Conversational filters | Optional validated `stateUpdate.filters` atomically replaces filters with the accepted plan; an empty list explicitly resets them. Omission preserves filters. Demo “show all” and changed budgets use the same contract, and Back restores prior state. | Attribute/operator/value validation and stale-response protection remain mandatory; other view changes do not silently clear constraints. |

The upstream control path uses a server-private Firestore mailbox for Firebase mode, so an update handled by another worker can reach the call owner. The local demo implementation is explicitly single-process. This is an implemented transport boundary, not a claim that a deployed streaming adapter has been verified. Session-scoped capabilities expire with the call, accept at most 300 updates and eight normal updates per second, and convey bounded application state rather than provider commands. An HTTP success means the update was stored; the owning event stream supplies the application acknowledgement. There are no automatic control retries. Mailboxes and operational logs contain no conversation history, transcripts or audio.

Evidence: [browser session](../lib/use-visitor-session.ts), [session lifecycle](../lib/visitor-realtime-session.ts), [controller](../lib/visitor-realtime-control.ts), [mailbox](../lib/visitor-realtime-mailbox.ts), [context contract](../lib/visitor-realtime-context.ts), [typed provider](../lib/visitor-provider.ts), [filter interaction](../packages/platform-ui/src/interaction.ts) and [quota policy](../lib/visitor-quota.ts). The comparison used FlowPath's `lib/use-voice-session.ts`, `lib/realtime-control.ts`, `lib/screen-client.ts` and `lib/voice-tools.ts` in its separate repository.

## Explicit product and cost differences

- **Model:** publisher Standard defaults to `gpt-realtime-2.1-mini`; Premium uses `gpt-realtime-2.1`, which is FlowPath's model. Equivalent quality between tiers has not been established. See [publisher settings](../lib/visitor-model.ts) and FlowPath's `lib/session-config.ts`.
- **Continuity limits:** publisher sessions allow 120 seconds including setup and 20 seconds idle. FlowPath allows 600 seconds locally or 270 seconds hosted, with 45 seconds idle. Publisher input is additionally bounded to 20 seconds, including the current VAD/commit wait. See [publisher limits](../lib/visitor-realtime.ts).
- **Attempts and tokens:** a new connection reserves one attempt before provider creation. A greeting consumes that first attempt; every later answer needs another. Response ceilings remain 1,200 plus an optional 500 tokens for catalog turns, 250 plus an optional 500 for legacy turns, and 750 for a greeting. Direct answers avoid the second generation. These are pilot cost controls, not a completed commercial usage policy.
- **Transcription:** continuous voice now uses `gpt-4o-mini-transcribe` for cross-mode user history. This is separately metered input ASR, not an extra answer generation. Continuous audio, retained provider context and transcription affect cost even when attempt and output-token ceilings remain unchanged.

Publisher-selected models, published settings and usage allowances were not changed implicitly.

## Appropriate differences

Published-reference validation, private-draft isolation, controlled components, grounded uncertainty, bounded usage, no automatic paid retries and browsing without AI remain necessary platform behavior. FlowPath's news retrieval, editorial policies, Boards and other domain-specific tools are not generic publisher requirements. Its interaction quality is the reference, not its news content or business logic.

## Verification boundary

For the current implementation, **164 offline server/unit/rendering checks and all 60 browser checks passed**, along with lint, TypeScript checking, the production build and packed independent shared-package consumer verification. The browser run covered 35 core checks and 25 visitor quality/continuous voice checks. It used separate fresh demo workspaces for the core and voice groups and preserved the real 12-site limit. Mobile End and typing-fallback screenshots were also inspected. See [shared layout/reveal regressions](../tests/browser/shared-reveal.spec.ts), [visitor quality regressions](../tests/browser/visitor-quality.spec.ts), [continuous voice regressions](../tests/browser/visitor-realtime.spec.ts) and [test instructions](../CONTRIBUTING.md).

Local tests use synthetic publications and mocked microphone, WebRTC, Firebase and provider events. They can establish contracts, component behavior, geometry, context ordering, cancellation, bounded generations and lifecycle decisions. They cannot establish acoustic quality, real model quality, SDP interoperability, deployed cross-worker delivery/session supervision or mobile Safari echo behavior. The startup-echo work is deferred and the FlowPath repository is unchanged. No paid API calls or deployment were performed; real-device/provider verification needs its own authorized, bounded test session.

## September 10 interaction improvements

New sites now default to Premium (`gpt-realtime-2.1`); stored publisher choices remain unchanged. Session and daily attempt limits remain enforced.

Voice navigation now supports direct open/expand, spotlight, compare, back/collapse, up/down and next/previous-section requests in addition to absolute scrolling. Catalog commands invoke the same deterministic detail/comparison plans and view history as manual controls, without asking the model to generate a full presentation envelope. Spotlight preserves the collection and expands the discussed card. Legacy sites support source detail and return. External actions remain unavailable. A browser acknowledgement is required before navigation is described as successful, and manual input cancels obsolete navigation.

The screen report adds fully visible and expanded entities and the primary visible entity. The server enriches the ordered visible list with published names, summaries, catalog numbers and visible positions. These remain observations, not proof of attention or authoritative facts.

Motion now uses 380 ms reveals, 450 ms disclosure, 480 ms reflow, 520 ms workspace transitions, 180 ms exits and 160 ms feedback. The voice controls dock while browsing; details provide a larger reading surface. Back restores the saved scroll position, selection, filters and spotlight, yielding to user input. Catalogs with meaningful attributes include compact manual filters, and legacy sites expose their section cards without an AI request. Cards show at most three attributes; comparison rows prioritize shared known attributes, retain partially known attributes, and omit wholly empty rows without inventing values.

The voice reservation path avoids its redundant preliminary publication read, and the controller does not repeat the publication read already performed by a verified reservation. Billing enrollment is still checked, the reservation transaction still checks the publication, and paid generation never starts before authorization. Reservation observations no longer block the reply. Existing provider-usage observations now include `latency_authorization`, `latency_generation`, `latency_navigation` and `latency_turn_to_audio` durations without prompts, transcripts or audio. Turn-to-audio starts at accepted audio commitment; generation timing ends at the provider playback-start event, not proof of audible device output.

Verification on an isolated snapshot of these quality changes passed lint, TypeScript, all 229 server/unit/rendering checks, packed independent-consumer verification and the production build. Browser verification covered 35 core checks (34 in the final core run plus the corrected motion check in a focused passing rerun), all 26 visitor quality/continuous voice checks and all 11 synthetic billing checks. Reading-view and mobile photo screenshots were inspected. Concurrent search/explore work in the shared checkout was excluded from this validation; these results do not certify that combined tree. All providers and billing were mocked; no paid API calls or deployment occurred. Live latency, model quality and acoustic parity remain unverified.
