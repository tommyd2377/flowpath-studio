# Waveform experience: desktop design direction

October 26, 2026. Initial design baseline: `bd24198` on `codex/mvp-integration`; concepts were saved in `28be2a6`. The user then selected the first mockup (portrait left) and authorized implementation plus actual-local-app acceptance in Brave. The compact row and on-demand Text Box are now implemented locally. Verification is recorded in [Text Box](text-panel.md). No deployment is authorized.

## Product direction

Studio is the place to create/configure a waveform. An individual waveform is a focused voice experience with a visual display used when needed. Creators apply curated, quality-tested capabilities from the Plugins dropdown. Applying a plugin grants availability; it does not open its interface for every visitor. The first capability is the safe Text Box. Future developer contributions do not imply executable uploads or an open marketplace.

The News example link belongs on the Studio homepage only, never on private `/w/` or public `/p/` waveform experiences. The individual-waveform link is removed; the homepage retains it. News source is untouched.

The user first requested brainstorming and desktop mockups, then approved the left-portrait design for implementation. It includes an explicit End conversation control. Future multi-plugin arrangements remain proposals.

Knowledge is now a second built-in, nonvisual capability. Its document management is separate from persona settings; it supplies spoken answers without automatically opening Text Box. An explicit request to show passages opens the existing panel and immediately shows a calm “Finding sources…” state while retrieval runs. Exact excerpts/filenames then replace that pending state. Hide remains immediate; a late search cannot reopen the panel or overwrite newer dictation. Source details expand inside the scrolling body, preserving the fixed toolbar and reduced-motion behavior. See [Knowledge](knowledge.md).

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

- Settings now use Plugins → Text Box → Apply plugin → Save waveform. Legacy v1 static records remain compatible; v2 saves capability only.
- Text Box supports user dictation and delegated local operations, Stop/Clear/Undo/Copy/Hide, bounded history, stale-edit protection, on-demand mounting and after-call retention. The selected compact desktop row and viewport-fit panel are implemented.
- GPT-6 Luna replaced GPT-5 nano as Studio's delegation default, with no fallback or automatic paid retries. GPT-Live handles speech. News source was not changed.
- Real startup exposed a missing nested `response_event` selector. `bd24198` corrected it, with regressions that failed against the old request and passed after correction.
- The correction passed lint/types/build, 288 unit tests and 52 standard browser tests. Six paid browser regressions passed for the initial plugin integration. An actual coordinator-started Brave/Google-account call connected; user starts also connected. Full delegated-edit correctness and latency remain unmeasured.
- The user subsequently confirmed basic dictation works: user-reported live evidence, distinct from automated checks. Earlier coordinator End/Escape clicks overlapped user speech, so they do not establish a separate Start-writing shutdown defect.

The initial concept step changed documentation/mockups only. The subsequent user-approved implementation changes the host, Text Box lifecycle/layout and focused tests. No push, deployment or main merge is included.
