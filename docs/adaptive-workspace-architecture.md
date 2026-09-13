# Adaptive visitor workspace

Implemented in Studio for assignment 2 (September 2026). This replaces the visitor's single active presentation with a bounded set of independently addressable objects. The independent FlowPath app and shared GPT-Live transport core are unchanged. See the [acceptance ledger and offline demo](adaptive-workspace-acceptance.md) for verification and limitations.

## Identity and state

`packages/platform-ui/src/workspace.ts` is the framework-independent contract and pure reducer. A registered **component** (`information`, `detail`, `photo`, `map`, `collection`, `gallery`, `comparison`, `actions`, `external`) is a rendering vocabulary entry, not an object ID. A **reference** is `{kind, id, revisionId}` identifying current published content or an accepted, session-only external result. An **instanceId** identifies one object in the visitor's session; two objects may use the same component and even the same published reference.

Each object retains references, selection, expansion, layout intent, query, typed attribute filters, reading scroll, and an origin containing the parent object/reference, opener key and scroll position. Workspace state retains ordered objects, current focus, bounded nested focus history, publication identity, mutation revision, and recent idempotency receipts. Focusing an object changes emphasis, not the open-object set. Back restores the parent/overview; Close removes only that object. Offscreen objects remain open. This is not a larger single detail panel.

| Boundary | Limit |
| --- | --- |
| Open objects / focus history | 12 / 12 |
| References per object / workspace | 12 / 36 |
| Atomic batch | 16 operations; 20,000 serialized characters |
| Workspace state sent as context | 24,000 characters excluding receipts |
| Recent idempotency receipts | 24; not sent to providers |
| Scene objects / total reported child items | 12 / 24 |
| Accepted external result sets | 6 recent searches; successful new searches rotate older temporary results; Home/Clear release them |
| Provider content projection | 40 records / 32,000 characters; active references prioritized, omissions explicit |

Capacity errors retain existing objects and ask for narrowing, closing, or explicit replacement. Published collection/album references represent their ordered membership without creating one object per member. Ordinary browsing is a [complete responsive website](home-and-published-website.md) with progressively expanded collections and a searchable published index; it reaches all approved records independently of workspace capacity. Legacy opening snapshots retain a bounded opening selection with ordinary browsing for the rest. New and republished sites default to intro-only unless the publisher selected opening content.

## Operations, revisions and compatibility

`WorkspaceBatch` carries schema version 1, a request ID, publication ID, base workspace revision, optional acknowledged scene revision, and ordered operations. Supported operations are add, update, focus, expand, collapse, select, filter, scroll, return, close, replace and reset. Every operation uses the same reducer whether it originates in an ordinary control, typing, a demo intent or a voice tool.

The reducer validates the whole candidate state before returning it: no partial application. Unknown IDs, wrong revisions, incompatible component/reference combinations, invalid filters, inappropriate comparisons and unsafe origins are rejected. A matching repeated request is idempotent; reuse of its ID for different content fails. An old base or publication revision fails. An old scene revision also fails except when an empty reset/replace or an all-close batch empties the entire unchanged object set: card positions do not affect that operation. Partial closes and mixed batches retain the scene guard. Adding an existing identical instance retains its local state; an explicit new origin refreshes its return context. Replace/reset are explicit and never inferred from an ordinary additive request.

Simple typed clear commands run locally through the same reducer, even when AI or task storage is unavailable. Voice has an acknowledged `navigate_view` target `clear`; other model-generated bulk closes use the validated batch path. Clear empties temporary visitor surfaces; Home restores the publisher's opening. Neither changes published content. See [clearing the visitor workspace](visitor-task-execution.md#clearing-the-visitor-workspace) for the code map and regression evidence.

PresentationPlan v1 remains supported. Its original component-ID/type rule still applies unless the plan explicitly opts into `identityMode: 'instances'`. The compiler uses runtime-generated OpenUI variable names and maps them back to validated instance IDs. Studio lifts validated v1 plans and older SitePresentation source plans into workspace operations. A repeated legacy slot/content maps to a stable object instead of accumulating duplicates; omitted filters preserve that object's constraints. The `/lab` compatibility renderer still exercises v1/OpenUI directly.

## Published graph to semantic components

`lib/visitor-workspace.ts` builds authority exclusively from the current public site, catalog and media revisions. It consumes assignment 1's `retrieveKnowledge`/`selectFactValue` boundary; no second graph model or source-artifact interpretation is introduced.

| Published data | Runtime presentation |
| --- | --- |
| Site overview/section/hours/contact; singleton fact | Readable information object with qualified value |
| Entity | Detail with attributes, reviewed photos, expandable facts, relationships and registered HTTPS links |
| Collection / album | Independently filtered collection / ordered gallery |
| Photo | Image, caption, alt text, credit, actual/example labeling, related entity and return origin |
| Several entities with a known shared attribute | Meaningful comparison using the existing shared comparison renderer |
| Location fact/entity | Approved address and, only when unambiguous, schematic coordinate overview |
| Accepted external result | Existing search/image/map renderer inside a noncanonical external object |

Facts are resolved against competing assertions, validity times, conditions and uncertainty before display. `knowledgeFacts` registers the same revision-scoped attribute compatibility references used by retrieval, so ordinary CSV/TXT imports support standalone facts. Public page, chat and voice inputs retain the complete approved snapshot; legacy attribute projections never discard the relationship graph. `lib/knowledge-display.ts` supplies consistent qualified text to objects and greetings. Missing coordinates produce a visible explanation, never a guessed pin or automatic geocoding. `workspaceLocation` keeps address/coordinates on one entity or one unambiguous, directed, currently valid location relation. A photo may select only its single reviewed depicted subject; examples and multiple locations require clarification. The coordinate view is explicitly **not a street map or directions**. Existing external map support remains separately opted-in and attributed. External IDs never become publisher graph IDs. Original uploads, private evidence, unapplied proposals and source filenames are not placed in visitor state; image URLs continue through current-publication authorization.

The offline planner recognizes bounded explicit names/contact facts, additive photo/map requests, comparison, replacement, expansion and current-scene references. It is a reproducible control equivalent, not a claim of general language understanding. Ambiguous or missing data asks for clarification. Deictic collection requests require a matching acknowledged visible collection; they cannot fall back to all albums. The connected provider can compose one validated operation batch using the retrieved published projection; it cannot supply markup, CSS, arbitrary URLs or executable actions.

## Actual screen context

`lib/workspace-screen.ts` observes the committed DOM, the workspace's body-portalled focused surface, clipping ancestors (including each child's inner reading container) and active modal. It reports publication-bound object references and names, order, focus, selection, expansion, supported controls, rectangle, relative position, mounted/open state, object scroll and page scroll. Visibility distinguishes full, partial, offscreen, hidden, obscured and unmounted. A modal photo/external image has its own validated reference. A child fully covered by a focused portal or clipped behind a reading header is not reported visible. A focused object does not imply that every other open object is visible.

Mutation/resize/scroll/visibility signals coalesce at 150 ms, and unchanged snapshots keep their scene revision. The adapter deduplicates semantic summaries, ignoring geometry-only noise for spoken-frontend context. Large summaries are split into at most three quiet, bounded appends so the transport cannot truncate the last object IDs. This does not initiate model responses or paid retries. Delegation receives the full bounded current scene. Names are re-derived from authority on the server, and child/modal references are validated again. Spatial/deictic resolution uses the acknowledged current workspace/scene revision; ambiguous left/second/that requests clarify rather than guessing an old array ordinal.

This is structural browser awareness, not screenshot vision. Geometry accounts for runtime portals and clipping, not arbitrary third-party occlusion or proof that a human read an object. The 24-child observation bound is explicit; unreported children remain browsable.

## Voice, typing and acknowledgment lifecycle

`VisitorAssistant` and `use-visitor-session` connect to the `VisitorWorkspace` imperative boundary. The server-side Studio adapter adds `update_workspace` alongside compatible presentation/navigation/search tools; there remains one bounded tool call per delegation, and one tool-free continuation. Several requested objects fit in that one batch.

1. **Accepted:** validated intent/batch, not a claim of display.
2. **Applied:** the browser has committed the matching revision, observed mounted objects and a visible requested focus, waited for stable geometry and any return flight to finish, then acknowledged the matching request.
3. **Failed:** invalid/hidden/disconnected/expired display terminates with a useful retained view and no success claim.
4. **Cancelled:** newer manual interaction, revision or abort supersedes the request; late/duplicate acknowledgments cannot revive it.

The local geometry guard is 2.5 seconds, with a timer independent of animation frames so a hidden tab cannot hang. The existing server browser-ack guard is eight seconds. Event-stream reading does **not** await the animation: speech/manual cancellation and End must remain responsive during the flight. The assistant is instructed not to claim that an object is displayed until applied, and never to speak tool preambles. Useful factual speech may proceed independently. Existing playback, microphone lifecycle, inactivity, quota, publication and graceful close controls remain in place. No shared `lib/gpt-live/*` transport changes or new automatic calls are needed.

## Shared motion, accessibility and mobile

`AdaptiveWorkspace` uses FocusStage, FocusSurface, DisclosureStack, ReturnAnchor and VoiceFocusBridge. Motion 13.2.0 remains the only animation runtime. The focused surface travels from the measured source bounds to a viewport/preview-constrained center and returns over the same 800 ms cubic-bezier curve used by ConversationDock. The grid retains its objects and space; the focused duplicate and departing surface are inert. The reading area scrolls internally; the page is not scrolled to a newly mounted panel. Chat/waveform space is reserved rather than expanded for status updates. Typing stays docked while a workspace object is focused, so the send control cannot travel behind it. The focused geometry observes changes in input/dock size.

Nonmodal focus has visible Back/Close and no focus trap. Manual opening moves keyboard focus without scrolling; automatic updates do not steal a newer keyboard choice. Nested return restores parent state and the opener; ordinary return restores the actual card/directory control, with a connected fallback if it disappeared. Escape returns the focused object before ending voice; Escape on the voice/chat controls preserves their existing behavior. Photo lightboxes are the modal exception: body portal, Tab containment, Escape and opener restoration. Reduced motion removes travel/reflow but retains the same state and keyboard results. Text is accessible immediately; there is no simulated typing gate.

Desktop supports a multi-column workspace. Phone and narrow Studio previews use a single stack, constrained focus geometry and internal overflow; offscreen does not mean closed. Ordinary browse and retained objects remain usable after provider failure, disabled AI or exhausted allowances. An oversized/unavailable detail renders a local narrowing fallback; its browser acknowledgment fails rather than claiming successful content display. Exact fact retrieval omits unrelated attributes while retaining competing claims, so ordinary browsing can still open a single fact. Expanded entity details expose all incident approved relationships, including their conditions, negation and validity, independently of the provider context cap.

## Publisher controls

Branding offers three token-backed layouts (balanced, editorial, compact) and palettes (midnight, forest, parchment), shared by draft preview and published visitors. These are finite platform choices, not arbitrary publisher themes. Existing sites receive the established defaults and existing Studio brand assets are retained.

Greeting settings provide exactly three optional slots: empty, approved source/entity/fact reference, or bounded publisher-written draft text. Preview is deterministic and costs no new model call; existing local speech preview remains optional. Selected points feed the existing voice greeting with tone and transitions but no invented facts. Save/Publish validate selections. Source changes and graph review prune/remap invalid selections; Undo restores the associated draft state. Visitor-speaks-first still suppresses the opening speech. All-empty selections preserve the existing greeting.

When opening audio begins, the selected points appear in a shared carousel as ordinary, publication-scoped workspace cards, including existing related photos. Publisher-authored points have public source references bound to that publication. Opening caption fragments travel over a visual-only event; matching published names or distinctive words bring the corresponding card forward using the existing 800 ms focus/return motion. The observer changes neither the voice prompt nor its requests. Focus advances on caption evidence, never a timed rotation; captions are not word-aligned playback guarantees, and substantially different phrasing may leave a card unfocused. Device-voice previews use speech boundary events where available. Reduced motion uses the existing immediate transitions.

Once the last selected point has been introduced and output is detected as quiet, its card returns immediately using the same 800 ms motion as its entrance. Earlier points retain a 1.5 second grace period so brief pauses can resume observation; a 60 second guard bounds it. Manual browsing, visitor speech, a new task, voice stop, hiding the page or leaving it cancels pending visual work. Empty selections, visitor-first and resumed conversations do not start the carousel automatically. The horizontal rail moves without scrolling the page or taking keyboard focus. Synthetic unit and browser tests cover the visual lifecycle; live caption/audio timing requires separately authorized verification.

## File and test map

| Concern | Implementation | Verification |
| --- | --- | --- |
| State / authority / compatibility | `workspace.ts`, `visitor-workspace.ts`, `contracts.ts`, `compile.ts` | `tests/adaptive-workspace.test.ts`, package consumer |
| Browser rendering / motion | `AdaptiveWorkspace.tsx`, `VisitorWorkspace.tsx`, `MediaViews.tsx`, shared styles | `adaptive-workspace`, `media-runtime`, `motion`, `shared-reveal`, `platform` browser specs |
| Real scene / asynchronous ACK | `workspace-screen.ts`, `visitor-realtime-context.ts`, `visitor-realtime-control.ts`, `use-visitor-session.ts` | `visitor-realtime-control.test.ts`, `visitor-realtime` / `visitor-quality` browser specs |
| Typed/provider integration | `visitor-provider.ts`, `visitor-request.ts`, visitor route, `VisitorAssistant.tsx`, `SearchExplore.tsx` | workspace/voice/search browser suites and provider tests |
| Publication / greetings / style | `site-greeting.ts`, `site-style.ts`, `site-model.ts`, `site-commands.ts`, `ingestion.ts`, site route, `GreetingSettings.tsx`, `EditorPanels.tsx` | adaptive contracts, semantic lifecycle, Studio/publication browser tests |
| Privacy / media / graph handoff | existing public projections/routes, shared retrieval | semantic, source-review, media, adaptive browser and server tests |

Paths in the shared-package column refer to `packages/platform-ui/src/`; host logic is in `lib/` or `components/`. The [acceptance ledger](adaptive-workspace-acceptance.md) records exact commands and the boundary between offline evidence and still-unverified live behavior.
