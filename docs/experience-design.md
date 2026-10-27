# Waveform experience: desktop design direction

October 26, 2026. Initial design baseline: `bd24198` on `codex/mvp-integration`; concepts were saved in `28be2a6`. The user then selected the first mockup (portrait left) and authorized implementation plus actual-local-app acceptance in Brave. The compact row and on-demand Text Box are now implemented locally. Verification is recorded in [Text Box](text-panel.md). No deployment is authorized.

## Product direction

Studio is the place to create/configure a waveform. An individual waveform is a focused voice experience with a visual display used when needed. Creators apply curated, quality-tested capabilities from the Plugins section. Applying a plugin grants availability; it does not open its interface for every visitor. The first capability is the safe Text Box. Future developer contributions do not imply executable uploads or an open marketplace.

The News example link belongs on the Studio homepage only, never on private `/w/` or public `/p/` waveform experiences. The individual-waveform link is removed; the homepage retains it. News source is untouched.

The user first requested brainstorming and desktop mockups, then approved the left-portrait design for implementation. It includes an explicit End conversation control. Future multi-plugin arrangements remain proposals.

Knowledge is now a second built-in, nonvisual capability. Its document management is separate from persona settings; it supplies spoken answers without automatically opening Text Box. An explicit request to show passages opens the existing panel and immediately shows a calm “Finding sources…” state while retrieval runs. Exact excerpts/filenames then replace that pending state. Hide remains immediate; a late search cannot reopen the panel or overwrite newer dictation. Source details expand inside the scrolling body, preserving the fixed toolbar and reduced-motion behavior. See [Knowledge](knowledge.md).

## Creator settings workspace

October 27: the selected Workspace design is implemented for desktop and mobile. The settings controller and existing account, review and save APIs remain in place. Desktop has section navigation, a central editor and a static appearance preview. Mobile puts a compact identity preview above touch-friendly section controls. The saved accent palette is retained.

- **Appearance & voice:** portrait, name, color and voice, with a draft preview that never starts media or a provider call.
- **Instructions:** the complete prompt editor, length warnings and existing background safety review.
- **Plugins:** visible Knowledge and Text Box cards. **Manage documents** opens the existing private Knowledge manager; applying/removing Text Box remains a saved waveform change.
- **Sharing & usage:** existing private-access explanation and gated publishing/balance controls. Availability, prices and payment enforcement are unchanged.
- **Account & tools:** existing admin testing and creation-review queue, only for the existing authorized roles. Sign out remains accessible in the header.

Sections keep one draft mounted; navigation does not submit, rerun reviews or reset edits. The persistent save area shows the current exact-version safety result, pending/error feedback and Save draft. Discard restores saved fields without writing or automatically requesting another review. If the server now holds a different draft review, the existing explicit Review this version control restores/verifies the saved version. Invalid required fields are revealed and focused before save. Overlong drafts and failed saves remain editable.

No schema, backend, billing, auth, dependency or deployment change is part of this layout. Knowledge file management remains on its existing dedicated page. This is a settings redesign; the visitor waveform and Text Box display are unchanged.

Workspace verification: `npm run check` passed lint, types, 341 unit/integration tests and production build in a source-only isolated copy. All 72 standard browser cases and six synthetic paid-preview cases passed after updating navigation expectations; the first run exposed two test assumptions (tab order and the publishing section), corrected and rechecked. Added coverage includes 1440/820/390/320 px layouts, draft retention, discard without writes, hidden-field validation/focus, keyboard navigation and no media starts from preview/navigation. Existing regressions cover photos, long prompts, account isolation, exact-version review, Knowledge and voice cleanup. Browser screenshots use synthetic accounts; signed-in Brave/real voice were not re-tested for this layout. No deployment or paid API calls occurred.

## Loading feedback

October 27: the shared `BrandLoader` uses the full FlowPath logo for startup, route transitions and whole-page data loads. The F mark is used inside waiting components and the button performing an asynchronous action. All sizes share the approved one-second, 1 → 1.06 → 1 heartbeat; reduced motion leaves a static mark and readable status. Startup ends on hydration, without an artificial minimum wait or a new provider request.

Loading stays scoped to the work. Text Box shows a centered F while its empty body waits for passages, or a small F in its heading when existing text is already visible. Hide remains available and late results cannot reopen it; voice continues. Buttons retain their existing disabled/cancellation rules and identify only their own pending action. Failed requests replace loading with the existing error/retry UI and retain editable drafts. The audio-driven waveform and its opening/return transition are unchanged.

Local verification passed `npm run check` (lint, types, 311 unit/integration tests and production build), all 64 standard browser tests and all six synthetic paid-preview browser tests. Delayed fixtures cover pre-hydration startup, page-load failure, failed-save draft retention, pending passages with existing text and Hide during retrieval. Startup, Text Box and mobile-save screenshots were visually inspected. No live paid calls, cloud changes or deployment were performed.

## Owner-route loading handoff

October 27 follow-up: a delayed synthetic account → Open waveform test reproduced a waveform appearing before the billing mode resolved, followed by the full-page experience loader and then the final waveform. `OwnerWaveform` previously initialized `paid` to false and mounted `VoiceExperience` as soon as the owner record arrived. A later enabled-billing response replaced it with `PaidExperience`, which loaded billing again before `/api/published` verified the saved Admin testing state. The toggle exposed this path; it did not itself toggle off or start a call. Development effect replay can add duplicate reads, but the routing race also existed without replay.

The owner route now keeps billing unknown until its read completes, alongside the owner-record read, and never mounts provisional voice. Its fresh billing result is handed to the personal experience for that initial load. Account changes invalidate both reads; subsequent conversations still refresh billing. Public experience routing, server ownership/admin authority, payer consent and limits are unchanged. Billing failures show the existing load error instead of treating unknown routing as disabled billing. The full-logo loader remains continuous until the correct screen is available; no minimum delay or paid retry was added.

Regression coverage in `tests/browser/waveform-startup.spec.ts` delays each prerequisite and observes DOM insertions to detect even transient premature waveforms. It covers Admin testing, regular prepaid consent, disabled billing and unavailable billing, with no voice starts. This establishes the rendering/request sequence, not the real Firebase request durations or live voice performance. The remaining private published-view authorization/retrieval still has to finish; no cloud timing claim is made from fixtures. Checks passed: `npm run check` (341 unit/integration tests, lint, types and build), 76 standard browser tests and six synthetic paid-preview tests. No paid provider calls, production changes or deployment; localhost:3220 remains running.

## Draft and published versions

October 27 follow-up: **Save draft** persists private settings; **Preview draft** (`/w/`) opens the saved private draft. **Publish / Update published version** explicitly promotes the approved saved draft. **View published version** (`/p/`) opens the frozen visitor-facing configuration. Save alone leaves an existing publication, its revision, funding and visitor-facing prompt/portrait/Text Box unchanged. Publishing is disabled while the editor has unsaved changes; Unpublish remains available. Preview opens saved fields, as its link description states.

The existing publication record now carries optional private draft fields alongside its published snapshot. Older publications stay intact, with no migration, reset or automatic promotion. Draft previews require owner authority and their own configuration revision/digest; prepaid draft sessions use self payment and never visitor sponsorship. Local founder Admin testing remains available on both owned versions. The published owner override resolves the frozen published snapshot and binds its revision/approval at admission; it does not use new private instructions or private Knowledge. Regular visitors still follow their configured payer consent. Public Knowledge remains gated/private as before.

The remaining loading work overlaps independent wallet/capacity and publication-approval/identity reads, skips a repeated visitor lookup for billing, and reuses the already verified identity only within the same metadata request. Financial transactions still recheck durable authority; private responses recheck current account access. Nothing caches identity across requests or delays the loader artificially. The one-second heartbeat is unchanged. Controlled fixture tests verify concurrent starts of independent reads; real Firebase latency has not been benchmarked. Aborting metadata loads also cancels queued client billing work when leaving settings, so stale settings work cannot hold up waveform navigation. Final checks passed: `npm run check` (348 unit/integration tests, lint, types and build), 77 standard browser tests and eight synthetic paid-preview browser tests. Browser evidence covers private edits remaining unpublished, explicit promotion, private prepaid session scope and founder published scope. Real paid API calls, signed-in Brave timing and deployment were not performed; localhost:3220 remains running.

## Recommended desktop layout

The selected desktop layout puts the portrait left of the raised waveform, on the same vertical level, in a compact conversation row. This establishes identity without a separate tall row. The right-side portrait remains a rejected comparison option. The waveform stays dominant and keeps the saved accent, existing dark palette and branding.

Compare the [left portrait](design/desktop-portrait-left.png) and [right portrait](design/desktop-portrait-right.png) concepts. These generated images illustrate open-panel layouts; they are not screenshots of implemented behavior. [Generation brief](design/README.md).

1. **Opening:** retain a calm centered portrait/waveform composition. Mount no plugin panel, toolbar or placeholder.
2. **Connected, no display requested:** glide the waveform upward over approximately 800 ms and move the portrait into the compact conversation row simultaneously. Leave the display area empty.
3. **Display requested:** reveal Text Box below that row over approximately 800 ms with a subtle fade and short vertical movement. Capture/process text immediately; animation must not delay capture or lose early words.
4. **Writing/paused:** keep the complete panel and toolbar inside the browser content viewport. Replace the fixed square aspect ratio with available-height sizing.
5. **Ended with text:** retain the panel for copying/local controls. The next conversation starts empty, as currently documented.

At a typical 1440×900 browser content viewport, explore a centered workspace up to about 1120 px wide, a conversation row around 112–144 px high and a panel using the remaining height with 24–32 px bottom clearance. These are mockup proportions, not approved hardcoded dimensions. Validate actual browser content height after browser chrome, plus shorter 1280×720/1366×768 windows and browser zoom.

Use a compact panel heading with Writing/Paused state, readable content and a persistent bottom toolbar: Stop writing while active, Undo, Clear, Copy and Hide. Long text scrolls within the content area; heading/actions stay visible. Do not force-scroll someone reading earlier text. A small new-text affordance can return to the latest fragment. Text remains escaped plain text.

The content remains a display, not an editable text input. Any incoming-writing indicator must not suggest that clicking the panel begins typing. Differentiate Stop writing from End conversation by wording and icon treatment.

Reserve the display space through the compact connected layout: opening a plugin should not cause a second large waveform jump. Existing footer/owner navigation must not push panel controls below the viewport; retain the footer in the appropriate opening/closed-workspace presentation.

## Availability and presentation are separate

Implemented host state: available capability with presentation closed → opening (800 ms CSS reveal) → open. Hide immediately unmounts it and pauses capture; there is no interactive invisible closing state. This visitor/conversation state is distinct from saved v2 configuration, voice connection and Writing/Paused. No saved-data migration is required.

| Trigger | Implemented behavior |
| --- | --- |
| Creator applies/saves Text Box | Capability is available; visitor presentation remains closed. |
| New conversation / ordinary speech | No panel, placeholder, invisible controls or reserved blank card. |
| Explicit Start writing / Start dictation | Open panel and capture immediately. |
| Explicit Show the text box | Open existing content without starting capture. |
| Explicit Put/write this in the box | Open and display the requested result. |
| Stop writing / Stop dictation | Pause capture; leave panel/content visible; voice continues. |
| Hide/close the text box | Pause capture and dismiss; retain text for reopening in this conversation; voice continues. |
| Clear / Undo | Change text without ending voice. Clear does not dismiss an open panel. A background clear need not reopen a closed panel. |
| End voice | Preserve already revealed text for copying. Do not reveal a panel that was never requested. |
| New conversation / navigate away | Preserve the current ephemeral-data lifecycle; no cross-session storage. |

Closed means absent from the rendered UI and accessibility tree: no opacity-only hiding, invisible pointer targets or focusable controls. Hide immediately pauses and unmounts. Opening does not steal focus; button dismissal returns focus to the waveform. Reduced motion disables glides/reveal. Only state changes are announced, not every fragment. After ending, an explicit Show text control can reopen previously requested, retained text without starting another call; it is absent before any text exists.

The strict `update_text_box` function now includes show/hide actions. The transcript handler recognizes exact dictation and show/hide/close controls locally; other requested operations use the existing delegation path. An internal read does not reveal UI. Display actions never end voice, start a new session, change payer consent, grant capability authority or affect usage accounting. The existing bounded executor remains, without an extra model call per fragment.

Future display-open/closed observations may enter the existing provider-neutral analytics boundary only after event/consent decisions. Such observations never grant credits or determine charges; conversation text remains excluded.

## Mobile and future plugins

Decide shared state/motion rules now; tune desktop first while protecting mobile reflow and short-height fallbacks in the same UI change. A compact stacked header and full-width panel are plausible mobile adaptations. Native framework selection remains undecided; this work does not choose one.

Recommend one active visual plugin at a time for the MVP. Future plugins declare identity, supported actions, minimum usable space, accessible label, cleanup and whether they can coexist with other displays. The host owns layout/reveal/dismissal/motion/focus. Explore compatible split displays later; do not build tabs, a grid manager or a new plugin framework for one capability. Not every future plugin must be visual.

## Lightweight plugin quality bar

Before offering a curated plugin, verify:

- Clean initial state, explicit reveal/dismissal, no invisible interactions or unexpected reopening/focus changes.
- Complete frame/actions on desktop, short windows, zoom and mobile; clear Writing/Paused state and readable text.
- Start/stop dictation, display/edit, hide/reopen, Clear/Undo/Copy and long-content behavior without losing voice or microphone cleanup.
- Escaping, capability/owner authorization, bounded data, stale-event rejection and ephemeral privacy boundaries.
- Delayed/rejected/duplicate tool calls, interrupted/reconnecting voice, ended-call retention and next-call reset.
- Keyboard, screen-reader, reduced-motion and touch behavior.
- Existing unit/browser checks plus explicitly authorized real-host/provider/spoken acceptance. A mocked pass or successful connection alone is insufficient evidence of full behavior or latency.

Create a reusable checklist/example fixture when a second plugin is developed; no marketplace certification framework is needed now.

## Today's state and evidence

- Settings now use Plugins → Text Box → Apply plugin → Save draft. Legacy v1 static records remain compatible; v2 saves capability only.
- Text Box supports user dictation and delegated local operations, Stop/Clear/Undo/Copy/Hide, bounded history, stale-edit protection, on-demand mounting and after-call retention. The selected compact desktop row and viewport-fit panel are implemented.
- GPT-6 Luna replaced GPT-5 nano as Studio's delegation default, with no fallback or automatic paid retries. GPT-Live handles speech. News source was not changed.
- Real startup exposed a missing nested `response_event` selector. `bd24198` corrected it, with regressions that failed against the old request and passed after correction.
- The correction passed lint/types/build, 288 unit tests and 52 standard browser tests. Six paid browser regressions passed for the initial plugin integration. An actual coordinator-started Brave/Google-account call connected; user starts also connected. Full delegated-edit correctness and latency remain unmeasured.
- The user subsequently confirmed basic dictation works: user-reported live evidence, distinct from automated checks. Earlier coordinator End/Escape clicks overlapped user speech, so they do not establish a separate Start-writing shutdown defect.

The initial concept step changed documentation/mockups only. The subsequent user-approved implementation changes the host, Text Box lifecycle/layout and focused tests. No push, deployment or main merge is included.
