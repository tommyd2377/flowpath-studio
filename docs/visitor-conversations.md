# Visitor conversations

Publishers choose Voice only, Chat only, or Chat and voice in **Content → Visitor conversations**. New publishers default to voice with GPT-Live-1 and Marin. Saved Standard and Premium values both use this same model; the obsolete quality selector is removed. Publisher identity, tone, greeting and visitor-speaks-first preferences remain configurable through draft, review and publish. Existing disabled publications stay unchanged until their owner publishes an enabled draft.

## Shared voice architecture

See [GPT-Live architecture](gpt-live.md) for the identical core used by Studio and the independent FlowPath app, current provider events, bounded Luna delegation, startup protection, usage and graceful close semantics. The frontend speaks continuously; the server runs substantive tasks through Luna and validates every tool result. Transcript fragments and backend completion are not authoritative playback or turn boundaries.

Voice starts when the visitor taps the waveform. Separate microphone and output analysers drive feedback. End, Escape, page hiding and unmount stop the conversation; manual browsing cancels stale work while retaining the connection. During a manual update only cloned outgoing microphone tracks pause until the owning server acknowledges the new view; original capture stays active. Stale output is muted until the observed output is quiet. Greeting waits for connected media and server readiness (25-second deadline), and is skipped for visitor-speaks-first or resumed history. iOS opening protection is only armed when an opening greeting is expected. A published inactivity setting closes the Live session after 30 seconds, one minute, two minutes or Never when there is no visitor speech, assistant playback or backend work. Tapping the waveform after the close starts a fresh session.

## Published information and tools

Assignment 2 adds the integrated [adaptive workspace](adaptive-workspace-architecture.md). `update_workspace` submits one atomic multi-object batch within the existing one-tool delegation budget. Compatibility tools below remain accepted, but their results now lift into retained objects. Typing and ordinary controls use the same reducer. Actual screen context reports open versus visible/offscreen/obscured objects, IDs, positions, focus, per-object scroll and modal state; quiet deduplicated appends keep the voice frontend informed without initiating responses. Browser acceptance is distinct from applied/failed/cancelled results. The event reader remains responsive to interruption while animations finish; there are no automatic paid retries. Neither this adapter work nor the new renderer changes the shared GPT-Live transport core.

Greeting setup now has three optional approved-content/custom-draft points with deterministic text preview. Selected facts retain qualification; voice may supply tone and transitions but not missing facts. Save/Publish validates the selections; content updates prune/remap them and Undo restores draft state. Empty points keep the existing greeting fallback. Visitor-speaks-first remains independent of visually selected opening content. See [opening and greeting controls](#opening-and-greeting-controls).

Both text and voice use the current published snapshot, validated catalog state, media and visible references. They never receive private originals, draft proposals or the owner's editor history. Models select registered presentation components and semantic transitions behind strict schemas; the runtime owns rendering, motion, styling and action routing. Invalid references or stale results retain the last accepted view. See [architecture](architecture.md) and [shared contracts](../packages/platform-ui/src/contracts.ts).

Studio permits at most one optional tool per delegated task: `update_workspace`, `present_site`, `navigate_view`, or enabled `search_explore`, followed by one tool-free continuation. Workspace, presentation, navigation and search wait up to eight seconds for the browser's matching acknowledgement. Acknowledgement indicates applied state, not that the visitor read it. Publication changes and manual interaction invalidate older work. There are no automatic repair generations or retries. Tools cannot edit, book, send, purchase or execute generated code. External search is separately labeled and off by default; see [Search and explore](search-and-explore.md).

## Limits and fallback

Chat uses Luna through Responses with the existing 30-second deadline and output limits (1,200 tokens for catalog requests; 700 for legacy requests). GPT-Live voice sessions have a hard 120-second duration plus the publisher's inactivity boundary. Delegated tasks have a 35-second deadline, a 1,200-token initial response and at most one 500-token continuation. The old recorded-turn provider now returns 410; connected voice uses the continuous session endpoint.

Default daily allowances are 25 chat attempts and five voice task reservations per site, shared by visitors, with deployment-wide daily caps of 100 each. A connection reserves its first voice task before provider creation; that reservation covers the first delegation, whether or not a greeting is spoken. Later delegations reserve another task before running Luna. Failed and cancelled attempts count. Continuous small talk, silence and speech duration are not individual task reservations. Duration observations and backend tokens are measured separately; attempt limits are not dollar budgets. On the last task, the server allows a bounded 15-second speaking window before closing; this does not prove an utterance was fully heard.

Chat has its separate allowance. Voice-only sites offer **Continue by typing** after a voice error. When both allowances are exhausted, browsing and the current view remain available. Local demo sites and Studio previews stay deterministic and do not contact a provider; previews use an installed local voice when available. Connected Firebase sites require existing server configuration. No auth, environment, billing or deployment configuration changes are part of the migration.

## Transport and storage

`/api/visitor/[slug]/session` accepts an audio-only SDP offer, bounded current context and up to eight recent messages. Video and provider data-channel negotiation are rejected. The server creates GPT-Live, owns its sideband connection and all delegation, and streams the answer SDP plus validated app events over HTTP. Browsers receive no provider key or session identifier. End waits for provider finalization with a bounded hangup fallback; uncertain cleanup blocks further calls in that process.

`/session/control` carries ordered, capability-scoped readiness, view revisions, audio activity, acknowledgements and End updates. The Firebase mailbox is server-private and works across workers; local demo mode uses an in-memory mailbox. Capabilities are bound to slug, site, publication and expiry; only token hashes are stored. Each session permits 300 updates (last slot reserved for End), eight normal updates per second and a 64 KiB update body. Updates coalesce current state; successful HTTP acceptance is distinct from the owner's `control_applied` event.

Quota reservations remain transactional with publication checks. Mailboxes store bounded published context, never audio or transcript history, and expire with opportunistic cleanup. Operational logs contain bounded IDs, counts, cumulative voice duration and backend token measurements, not conversation text or reconciled charges. No scheduled workers or cloud settings are added.

Cross-mode history is bounded component memory and disappears on reload. Exact active-session transcript fragments feed delegation; grouped user captions can be revised. Generated assistant transcript text is not added as a fully heard answer because GPT-Live supplies no authoritative playback completion. Current view and earlier trusted local history can seed another call. Responses and Live sessions use `store: false`; provider retention still depends on account policy.

## Verification

Use Node 24 and run `npm run check`, then `npm run test:browser` for isolated demo browser coverage. Provider calls are mocked. Tests cover published-reference validation, delegation limits, cancellation, acknowledgement ordering, media readiness, manual browsing and graceful cleanup. The shared core test compares both repositories byte for byte when sibling checkouts are available.

Actual provider access, audio-only SDP interoperability, hosting lifetime and iPhone acoustic echo cancellation require a separately authorized live test. Passing offline tests does not establish these outcomes or authorize deployment.

### Published opening and voice dock

The visual choreography described below is retained, with one important boundary change: new/republished intro-only sites do **not** mount catalog/section/contact/photo content below the fold. An explicit **Browse published content** control provides the ordinary, no-AI route. Activating voice or opening the typing control alone does not expose everything. Focused objects return before Escape ends a call; Escape on voice/chat controls and page hiding retain their existing lifecycle behavior. Status changes do not enlarge the waveform or lower the dashboard.

Published pages omit the preview banner, voice attribution line, redundant Explore button and template signature. Opening copy defaults to the current catalog title and description, or a local composition from the site name and section titles when no catalog exists. This uses published content and makes no generation request on page load. Content → Opening experience → Opening copy lets publishers select Personalized and edit the headline and introduction; save and publish apply the choice. Existing stored headline and introduction remain available when personalizing.

The shared VisitorVoiceStage uses the Flowpath invitation: a full-height opening, small spaced publisher wordmark with fine side rules, a 650 ms identity fade and a 1.25-second waveform glide into a sticky dock. The same canvas remains mounted. Content sits below the initial viewport and remains available by scrolling without voice. Activation dismisses the opening copy; listening and speaking use waveform feedback plus screen-reader text, while connecting, thinking, map and search work use a measured animated status area. Search progress is emitted only for validated tool work and stale status events are ignored. Reduced motion removes the transitions; the End control and keyboard focus return remain available.

Published pages use the neutral #101110 Flowpath base and restrained charcoal/olive surfaces. Publisher color is retained for identity and controls, not large background washes. The host removes nested page/assistant/catalog width caps, uses 28px desktop and 18px mobile gutters, and fits collection columns to the available width and number of items. It does not constrain desktop content to a phone-sized column. Studio previews keep their own scroll surface.

## Docked typing fallback

Typing shares the voice dock's height and sticky top position. The shared `ConversationDock` keeps its input mounted, moving it over the content when focused or tapped; suggestions fade in underneath. Enter or a suggestion submits immediately, fades out the suggestion surface, and returns the input to the dock. Escape and outside taps dismiss the expanded surface without clearing the draft. Motion follows reduced-motion preferences, and departing suggestions are inert. The heading and attribution/helper row have been removed.

The shared library no longer registers or renders CriteriaControls. Voice and chat apply validated `stateUpdate.filters`; the matching results remain visible. Legacy plan entries for the retired criteria panel are validated and discarded, including their transition target, rather than creating a blank sidebar or breaking an older publication.

## Opening and greeting controls

Visual opening policy is explicit: intro-only by default for new/republished sites, publisher-selected references when requested, and a compatibility path for older snapshots missing the policy. Existing `OpeningSettings` controls select approved entities, sections, albums/photos and links; publication validates every reference. Explicit browsing uses the same approved authority and objects after failure or exhausted allowances.

Spoken greeting points are configured separately from content visible before a conversation starts. Each of three slots can be empty, an approved source/entity/fact, or bounded publisher-authored text. When the welcome audio starts, those points appear as a carousel with existing related photos. Matching narration captions bring each card forward using the shared focus motion; after speech becomes quiet, the cards return to the carousel. Manual browsing or visitor speech stops automatic focus. The wording, voice requests, visitor-first behavior and all-empty greeting fallback are unchanged. Caption matching is approximate; live word-level synchronization is not verified. See the [greeting visual lifecycle](adaptive-workspace-architecture.md#publisher-controls).

The offline preview shows the resolved greeting without a new provider request. Branding offers balanced/editorial/compact layouts and midnight/forest/parchment palettes using platform tokens. Draft preview and publication share these settings. The [acceptance ledger](adaptive-workspace-acceptance.md) distinguishes tested persistence and mocked coordination from unverified natural live speech.

## Repeatable visitor QA

See [Voice and chat quality assurance](voice-quality-assurance.md) for the offline test gate, request-correlated diagnostic panel, startup timing analysis, knowledge-source policy, and the separate bounded live/device acceptance checklist. Run `node scripts/test-visitor-qa.mjs --unit-only` for the fast gate or omit the flag for isolated browser coverage.
