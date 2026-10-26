# Waveform experience: desktop design direction

October 26, 2026. Design exploration following the user's confirmation that basic dictation works. Current application baseline: `bd24198` on `codex/mvp-integration`. This brief records requirements and proposed designs; it does not implement them or authorize deployment.

## Product direction

Studio is the place to create/configure a waveform. An individual waveform is a focused voice experience with a visual display used when needed. Creators apply curated, quality-tested capabilities from the Plugins dropdown. Applying a plugin grants availability; it does not open its interface for every visitor. The first capability is the safe Text Box. Future developer contributions do not imply executable uploads or an open marketplace.

The News example link belongs on the Studio homepage only, never on private `/w/` or public `/p/` waveform experiences. Remove the individual-waveform rendering path for that link in the next approved UI implementation; retain the homepage link and do not touch News source.

The user requested brainstorming and desktop mockups before application changes. On-demand display, full visible controls and homepage-only News are requirements. Portrait placement, final dimensions, explicit End control and future multi-plugin arrangement below are proposals awaiting selection.

## Recommended desktop layout

Recommend the portrait on the left of the raised waveform, on the same vertical level, in a compact conversation row. This establishes identity without consuming a separate tall row. A right-side portrait is the comparison option. Keep the waveform dominant and preserve the saved accent, existing dark palette and branding.

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

Proposed host state: available capability with presentation closed → opening → open → closing → closed. This visitor/conversation state is distinct from saved v2 plugin configuration, voice connection state and Writing/Paused. Presentation alone does not require a saved-data migration.

| Trigger | Proposed behavior |
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

Closed means absent from the rendered UI and accessibility tree: no opacity-only hiding, invisible pointer targets or focusable controls. While closing, disable interaction immediately and unmount after the exit transition. Opening must not steal keyboard focus. Respect reduced motion and announce state changes without announcing every transcript fragment. Restore focus sensibly after a keyboard dismissal.

The current `update_text_box` function has no show/hide actions. A presentation state and those spoken actions are proposed interfaces, not implemented ones. An internal tool read must not reveal UI. Plugin display actions must not end voice, start a new session, change payer consent, grant capability authority or affect usage accounting. Keep the existing bounded local executor; no extra model call per transcript fragment.

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

- Settings now use Plugins → Text Box → Apply plugin → Save waveform. Legacy v1 static records remain compatible; v2 saves capability only.
- Text Box supports user dictation and delegated local text operations, Stop/Clear/Undo/Copy, bounded history, stale-edit protection and after-call retention. It currently renders immediately; the on-demand layout above is next work.
- GPT-6 Luna replaced GPT-5 nano as Studio's delegation default, with no fallback or automatic paid retries. GPT-Live handles speech. News source was not changed.
- Real startup exposed a missing nested `response_event` selector. `bd24198` corrected it, with regressions that failed against the old request and passed after correction.
- The correction passed lint/types/build, 288 unit tests and 52 standard browser tests. Six paid browser regressions passed for the initial plugin integration. An actual coordinator-started Brave/Google-account call connected; user starts also connected. Full delegated-edit correctness and latency remain unmeasured.
- The user subsequently confirmed basic dictation works: user-reported live evidence, distinct from automated checks. Earlier coordinator End/Escape clicks overlapped user speech, so they do not establish a separate Start-writing shutdown defect.

This design step changes documentation/mockups only. No application change, push, deployment or main merge is included.
