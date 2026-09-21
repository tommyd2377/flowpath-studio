# Evolving information surface

FlowPath Studio's voice/chat layer is one persistent card. The normal website stays mounted, inert and softened beneath it. Assistant changes never write the website's filters, browsing state or scroll. Closing returns focus without scrolling the page.

## Architecture and code map

| Responsibility | Code |
| --- | --- |
| Surface snapshots, transaction history, byte accounting | `lib/visitor-surface-history.ts`, `packages/platform-ui/src/surface.ts` |
| Semantic composition, Back/Forward, selections, scroll and display receipts | `components/VisitorWorkspace.tsx` |
| Desktop/mobile art direction | `components/VisitorCarousel.module.css` (legacy filename only) |
| Request boundaries and modality coordination | `components/VisitorAssistant.tsx`, `lib/use-visitor-session.ts` |
| Shared geometry/region motion | `packages/platform-ui/src/InformationSurface.tsx`, existing `motion.tsx` |
| Media identity and last playback state | `packages/platform-ui/src/MediaVideo.tsx` |
| Approved numeric charts | `packages/platform-ui/src/PublishedChart.tsx`, `workspace.ts` |
| Retained query/result restoration | `components/VisitorTasks.tsx`, `lib/visitor-task-store.ts`, `lib/visitor-capabilities.ts`, visitor tasks route |
| Context validation and server-resolved facts | `lib/visitor-request.ts`, `visitor-realtime-context.ts`, `visitor-carousel-control.ts` |
| Shared composition choices | `lib/visitor-answer-composition.ts`, `visitor-chat-task.ts`, `visitor-realtime-control.ts` |
| Current context each tool round | `lib/visitor-task-runner.ts` |
| Retained authorized research across channels | `lib/visitor-research-cache.ts`, `lib/explore-service.ts` |
| Bounded prose and approved transcript retrieval | `lib/visitor-workspace.ts`, `visitor-published-content.ts`, existing knowledge retrieval |
| Acceptance | `tests/information-surface.test.ts`, `tests/browser/ai-carousel.spec.ts` (replaces obsolete carousel assertions) |

## History and cancellation

One typed question or delegated voice request starts one presentation transaction. Its pre-request stable state is retained; intermediate tool displays enrich the live surface and receive real browser acknowledgments. Completion checkpoints the prior state once, only if meaningful presentation changed. Partial successful displays remain useful when a subsequent step fails. Back during pending work restores the pre-request state and cancels the pending transport; publication, generation and revision checks prevent late work from repainting it.

A snapshot contains validated workspace objects/references, task view, answer, primary region, expansion, external findings, local selections and reading position. It contains no React nodes, DOM, binary media or continuous playback. Scrolling, observation/geometry, loading, tokens, narration and playback do not create history entries. The empty invitation is not a meaningful Back destination after the first answer. A manual information change (opening a record, selecting a chart value, moving within a gallery, changing query criteria) makes the same kind of checkpoint. Mode changes do not. Back is briefly disabled while a restoration commits, and new requests wait for that restoration. The compact Back and Forward controls always restore a whole snapshot; local gallery controls are explicitly labeled as photo navigation.

History is memory-only for this visit, bounded to **16 saved states across Back and Forward and 1,000,000 serialized UTF-8 bytes**. The farthest state in the longer stack is discarded first. Immutable data is shared between snapshots; conservative serialized accounting counts repeated references. Reload discards browser history. Server-owned task receipts retain at most **32 projections and 300,000 bytes**, with additional eviction when the whole session exceeds 680,000 bytes. Task sessions retain the existing two-hour lifetime / 30-minute idle expiry. A server-restored result can therefore expire before its browser snapshot; the surface reports that explicitly and keeps the current useful view.

There are at most six retained external result sets and 64 local selection keys in a browser snapshot. Selected research images/sources and controlled map overview zoom use those same selection keys, including research displayed through generalized visitor tasks. Continuous iframe pan gestures are owned by the map provider and remain intact while that iframe stays mounted; the provider does not expose them for restoration after removal.

Back and Forward move through complete saved compositions. A committed new information change clears the Forward branch; no-op requests and cancelled work preserve it. An unfinished detail request cannot commit while Back is restoring its prior state. A new navigation command waits for any current restoration before choosing its destination. Completed dialogue and applicable researched findings remain available, while unfinished work and late writes are cancelled. Server restoration validates the session's exact site/publication identity and uses its retained query, result order and selection. It never reruns external search, calculations or actions. Business effects and saved artifact contents remain current: **Back restores presentation; it does not undo real-world actions.**

Home dismisses the surface while retaining its useful state; Start over clears the current surface before dismissal. A voice-issued dismissal preserves the active voice connection, whereas the manual Close assistant control still cancels and ends that interaction. Reopening an already retained record explicitly reveals the layer before acknowledging visibility, even when its primary ID did not change. The September 19 combined QA adds a mocked Home → reopen → Start over regression; see [real-content acceptance](qa-real-content-2026-09-18.md) for live-versus-mocked evidence and remaining checks.

## Composition and motion

One primary region and at most two supporting regions are visible. New primary information appears on the desktop right; retained support occupies the left. A reading answer is comfortably narrow, media gets a wider reserved aspect ratio, and collections can expand to 90vw on desktop while reserving 64px on either side for history controls. One- and two-result collections contract to comfortable 600px and 880px widths. Comparisons, maps and mixed compositions retain their 80vw limit. No neighboring peeks, whole-card next/previous buttons, history counter, global arrow keys or horizontal-swipe navigation remain.

At widths up to 800px, the surface uses the existing 14px side gutters. Its composition is vertical: new information first, retained context afterward, with a retained video above the related answer. Body typography inherits publisher fonts, colors and text scaling. A single reading container uses the actual space below the measured voice/chat dock; `visualViewport` handles keyboard/browser-chrome changes. Safe-area padding and 44px custom controls preserve reachability. Back and Forward sit just outside the desktop card's upper left and share its compact upper-left control row on narrow screens; dismissal is always available.

Collection headers use a small item count; reset/filter chips do not occupy the assistant card. On narrow screens the count shares the existing Back/Close row. Loading, errors, necessary clarification and empty-result notices remain available. A nonblocking notice about records with unknown filter values follows the results instead of pushing them down. These controls do not change the regular website layout or remove the query state supplied to the assistant.

The shared `InformationFrame` animates real height; the shell changes real width with the shared reflow timing. Desktop grid tracks open together with that expansion. The primary region reserves its readable destination width while it is revealed, avoiding narrow intermediate text columns; retained media resizes with the track at its original aspect ratio. Text and video are not scaled. `InformationRegion` uses Motion position projection and restrained reveals. Existing regions have canonical keys; video regions keep a stable DOM order even when their semantic role changes, protecting iframe identity as well as React identity. Entering and leaving regions use opposite travel directions for Back and Forward. Retained regions keep their keys and position projection. No exit-before-enter gap occurs. Measurements are bounded and observe content independent of the animated frame height. Reduced motion removes travel and dimensional animation.

The frame's perimeter fades into the softened website without a visible outer border or dark drop shadow. Shared `styles.css` gives `InformationFrame` a separate, non-interactive backdrop: an opaque publisher-colored center with a small static shadow in that same color feathering its edges. Text, photos, videos, controls and the reading scrollbar receive no filter, mask or opacity treatment. The shell keeps its existing dimensions and insets, permits focus outlines to paint outside the frame, and leaves Back/Close unobstructed. Surface focus rings retain the accessible palette accent instead of the broader assistant's brand color. The treatment inherits light/dark palette colors and adds no animation, including under reduced motion. See the [September 19 before/after evidence and scoped checks](screenshots/information-surface/README.md#soft-perimeter-note-13-september-19-2026).

Native players retain position, volume, mute, playback rate and available caption selection outside history. Reflow does not seek/pause/remount a retained player; Back retaining the same video does not rewind it. Removed media pauses. Restored media requires explicit playback. Provider iframe settings remain subject to provider APIs; the supported position/pause behavior is retained. The existing voice/media audio policy remains in effect.

`chart` is a narrow registered workspace component. It accepts approved entity references and an optional approved numeric metric, uses the projected published values, and retains its selected datum. It cannot accept invented values, markup, arbitrary CSS or executable components. Other registered semantic components and task renderers remain the rendering vocabulary.

Collection and gallery requests initially display a grid. Opening a photo switches to its existing local viewer; Back/Forward can restore either composition. Stable record keys allow Motion to remove excluded items downward and reflow retained items upward; Back reverses this travel. Exiting nodes become inert and disappear from the assistant's visible-record observations. Desktop collections can use 90vw; supporting collections use denser two-column layouts when space allows. Mobile photo grids use two columns and ordinary records retain a readable single column. Grid images reserve a consistent frame capped at 300px or 32dvh, including unusually wide source images. An illustrative-image label remains visibly attached to its image without adding a separate row. Exact duplicate importer summaries and price fields are compacted without dropping authored descriptions or qualified price terms.

Standalone external image-search grids use the same desktop width up to 90vw while retaining their research provenance. One or two images keep the narrower collection sizes; mobile uses two columns inside the existing gutters. A small count leads directly into the images. Number/code guidance remains screen-reader accessible and each image keeps its visible label and source link. Accompanying answers and qualifications follow the grid; empty searches and ordinary web answers retain their explanatory presentation.

## Model context and authority

The shared `surface` receipt includes state/request/publication/tenant identity, committed versus pending status, primary/supporting regions, actual visibility, canonical subject references, selections, answer text, reading position and at most eight concise summaries in each history direction. A compatibility `carousel` receipt/tool name remains for older transports; it does not represent slide history. Scene revision ignores harmless progress and geometry changes.

Both channels receive the same surface after Back or Forward. Exact source text and qualified published facts are resolved server-side from authorized records. Task records continue through the authorized task index; browser labels and answers are not factual authority. Approved transcripts are available through bounded published-content retrieval. Captions, metadata and playback time never imply video understanding; actual photo inputs are separately labeled. `present_answer` makes an explicit related/new-subject choice. An ordinary final answer is displayed automatically only when this request has not already confirmed a visual result. A confirmed query, comparison or other display sets the typed `displaySatisfied` result across subsequent tool rounds, so final confirmation text does not add a redundant card. Substantive new explanations or calculations after a display use `present_answer`, reserving a step within the existing tool budget. Read-only research never satisfies a display and still reaches answer synthesis with its sources. Existing bounded multi-step execution, search permissions, annotation permissions, cancellation and display acknowledgment still apply.

Authorized external results also enter a process-local server evidence cache, keyed by tenant, exact publication and result ID: **64 results, 2,000,000 bytes, two-hour expiry**. Only requested retained IDs are retrieved, at most six, with bounded answer/source excerpts. Missing/evicted evidence is explicitly identified to the model; browser prose never fills that authority gap and restoration does not initiate another search. Current task research additionally resolves from its retained server presentation. Server restart/worker changes can evict this optional evidence cache while the browser still retains the presentation.

Conversation research also has a separate session-owned store, independent of current-view references and Back snapshots. Both channels receive complete prior findings when they fit, or bounded recall metadata. Home, Back, filtering and voice reconnects preserve still-valid memory in the same visitor session/publication; action handles retain their existing generation checks. Sources, acquisition dates and conditions remain attached, and reuse does not imply that an old rule applies to every new subject. See the [noon QA report](qa-voice-2026-09-19-noon.md) for limits, completed-dialogue retention and verification.

Long live-voice updates are split into labeled bounded transport parts so exact facts at the end are not truncated. The Studio context channel allows one fragment awaiting a matching provider acknowledgment; the newest snapshot replaces unsent older parts. Screen deduplication compares semantic state before resolving facts with time-dependent metadata, so unchanged heartbeats do not resend the composition. Reference content is delivered separately from the concise visible composition, so gallery paging does not repeat unchanged facts, answers or history summaries. New visible selections take priority over queued reference prose without discarding that complete reference context. Reading-position observations are separate; a changed scene discards unsent reading updates from the old scene. Rejections stop the channel without automatic retries. An acknowledgment estimates context delivery; it is not proof of comprehension or audible playback. Restored task records include both primary and supporting canonical references in the backend's authorized context, independently of this voice delivery queue.

Manual interruption applies to superseded work. The first fresh substantive speech after a click supplies one instruction restoring normal response and delegation; it does not execute an action, guess a completed utterance or retry old work. The shared transport is unchanged.

When exact requested material is unavailable, a useful alternative is chosen in context. A general gallery may be helpful for a picture request with an honest explanation, but no missing-result case automatically requires that gallery or any other fixed fallback.

Development-only recorder events add `surface.request.started`, `surface.request.committed`, `surface.observed`, `surface.confirmed` and `surface.restored`. They retain the existing consent/redaction controls and record supplied context and outcomes, not hidden reasoning.

## Verification and walkthrough

See the [visual review and screenshots](screenshots/information-surface/README.md). The September 18 acceptance below used synthetic publishers and mocked provider/player responses. The subsequent [September 19 labeled-photo and live-chat QA](qa-history-grid-2026-09-19.md) records the separately authorized publication and bounded live API run; it does not establish real speech acceptance.

Verified with Node 24.6.0 on September 18, 2026:

- `npm run check` passed: lint, typecheck, **559 server tests, 22 rendering tests**, packed independent consumer verification and the production build.
- **17 selected isolated browser scenarios passed**: 12 information-surface cases, one template integration case and four voice lifecycle safeguards. They cover request coalescing, cancellation through button and typed Back, model-issued Back, retained video identity, chart/gallery/map selections, reading position, query ordering, branching, authoritative facts, errors, responsive geometry, reduced motion and website restoration. This was the relevant focused suite, not the entire browser suite.
- Transition sampling recorded **82 frames over 1,350ms**, 30 distinct widths from 860px to 1,152px at a 1,440px viewport, and zero empty frames. Intermediate captures were reviewed and the grid expansion refined after the first pass.

Reproduce the focused browser verification after `npm run check`:

```sh
npm run test:browser -- tests/browser/ai-carousel.spec.ts tests/browser/templates.spec.ts tests/browser/visitor-realtime.spec.ts --grep 'one persistent|research, local|whole-state|initial prose|failed media keeps|disabled external search|gallery gestures|queries, ordering|mock voice shares|transition sampling|assistant information shares|cancelling pending microphone|readiness waits|a failed control update|speed: cold'
```

1. Open the assistant and ask for a published video. Play it.
2. Ask a related question, then request a published numeric comparison chart. The player remains in place while the right side changes.
3. Press Back twice. The chart and explanation disappear in separate request steps; the retained video keeps its current position.
4. Replace the subject, then Back. The previous composition returns; a video that had left is paused.
5. Add/remove a photo, explore a collection and open a record. Back restores the entire previous composition and query order.
6. Start a slow request, then Back. Its late results cannot overwrite the restored surface.
7. Switch voice/chat, rotate or resize, increase text size, and use keyboard-only controls. Close the assistant to return to the website exactly where you left it.
