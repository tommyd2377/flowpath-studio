# FlowPath Studio component and interaction system proposal

**Work item:** 5
**Status:** research and design only
**Date:** 2026-09-11

## Implementation update — assignment 2

The proposal below remains reviewed design input and historical rationale. The later assignment expressly superseded its first-slice limit. Studio now implements the [adaptive workspace](adaptive-workspace-architecture.md): multiple independently addressable objects, validated atomic operations, graph-backed facts/media, actual structural screen awareness, symmetric focus/return, ordinary no-AI browsing, three layouts/palettes and three optional spoken greeting points. PresentationPlan v1 and strict published-reference validation remain; Motion 13.2.0 is the only animation runtime. FocusStage, FocusSurface, DisclosureStack, ReturnAnchor and VoiceFocusBridge remain the vocabulary. Workspace focus is nonmodal; the photo lightbox is modal.

The richer card/context/comparison behavior is composed from existing registered components; the proposal's aspirational names do not imply a second set of components or invented contracts. Annotated media, diagrams and freeform 3-D remain deferred pending reviewed data/authoring contracts. See the [offline acceptance ledger](adaptive-workspace-acceptance.md), not this original research status, for implementation evidence and live-testing limitations.

This proposal is intentionally compatible with the existing FlowPath Studio and
`@thevoice/platform-ui` architecture. It does not change runtime code, add a
dependency, change a published contract, or decide the animation supplement
being investigated in item 4.

## Decision summary

FlowPath should **evolve the current semantic runtime selectively**, rather than
rebuild the visitor experience or introduce a second animation system. The
current package already has the hard parts of a good foundation: strict
published-reference validation, a catalog interaction state, `layoutId`-based
card/detail continuity, measured disclosure, settled reveal, interruption
cancellation, focus restoration, and reduced-motion handling.

The first implementation slice should make those behaviors feel like one
coherent system:

1. `FocusStage` + `FocusSurface`: one active object becomes the visual center,
   while the collection remains a legible, recoverable context.
2. `DisclosureStack` + `ReturnAnchor`: information arrives in a deliberate
   glance -> focus -> evidence -> action ladder, and Back/Escape returns to the
   exact card, selection, scroll position, and focus origin.
3. `VoiceFocusBridge`: voice and chat produce the same typed intent as tap and
   keyboard input, with visible acknowledgement before a validated view change.
4. `MultimodalCard`, `ContextRail`, and `DecisionBoard`: use the existing
   entities, attributes, relationships, approved media, and links in richer
   compositions without inventing new facts.
5. `AnnotatedMedia` and bounded `DiagramPanel` are later additions, only after
   publisher authoring, provenance, and fallback behavior are designed.

The visual ambition should be **2.5-D rather than a free-form hologram**: dark
depth layers, restrained edge light, a strong active surface, synchronized
shared-element motion, and a quiet receding context. The content remains a
normal semantic document underneath. WebXR, gesture-only navigation, arbitrary
model-generated SVG/HTML, and an auto-rotating “show” are not prerequisites for
the desired effect.

## Scope and evidence posture

I reviewed the repository guidance, product philosophy, architecture, search and
explore behavior, photo workflow, current React hosts, the visitor/provider
boundary, and the complete shared `platform-ui` surface. The most relevant files
are:

- [architecture.md](/Users/thomasdevito/Projects/theVoice/docs/architecture.md)
- [product-philosophy.md](/Users/thomasdevito/Projects/theVoice/docs/product-philosophy.md)
- [platform-foundation.md](/Users/thomasdevito/Projects/theVoice/docs/platform-foundation.md)
- [search-and-explore.md](/Users/thomasdevito/Projects/theVoice/docs/search-and-explore.md)
- [photo-library.md](/Users/thomasdevito/Projects/theVoice/docs/photo-library.md)
- [contracts.ts](/Users/thomasdevito/Projects/theVoice/packages/platform-ui/src/contracts.ts)
- [interaction.ts](/Users/thomasdevito/Projects/theVoice/packages/platform-ui/src/interaction.ts)
- [Runtime.tsx](/Users/thomasdevito/Projects/theVoice/packages/platform-ui/src/Runtime.tsx)
- [components.tsx](/Users/thomasdevito/Projects/theVoice/packages/platform-ui/src/components.tsx)
- [MediaViews.tsx](/Users/thomasdevito/Projects/theVoice/packages/platform-ui/src/MediaViews.tsx)
- [motion.tsx](/Users/thomasdevito/Projects/theVoice/packages/platform-ui/src/motion.tsx)
- [SiteExperience.tsx](/Users/thomasdevito/Projects/theVoice/components/SiteExperience.tsx)
- [VisitorAssistant.tsx](/Users/thomasdevito/Projects/theVoice/components/VisitorAssistant.tsx)
- [catalog-presentation.ts](/Users/thomasdevito/Projects/theVoice/lib/catalog-presentation.ts)
- [media-store.ts](/Users/thomasdevito/Projects/theVoice/lib/media-store.ts)

“Established” below means a documented web/platform/accessibility technique or a
tool already used by the repository. “Proposed” means a FlowPath product
composition or contract that still needs design validation. Item 4’s eventual
Motion/open-source findings are a technical input to implementation, not a
research dependency for this proposal.

## Existing component inventory

| Purpose | Existing components and contracts | Current capability | Gap or opportunity |
| --- | --- | --- | --- |
| **Visitor host and command surface** | `SiteExperience`, `VisitorAssistant`, `ConversationDock`, `Waveform`, visitor view context | Opening experience, chat/voice modes, typed fallback, continuous voice commands, busy/error states, published-only data, stale-request cancellation, bounded history | There is no single named lifecycle for “acknowledge -> resolve -> focus -> reveal -> ready”; each surface has some of the behavior. |
| **Catalog composition** | `CatalogExplorer`, `CatalogCanvas`, OpenUI `CollectionView`, `EntityDetail`, `AttributeComparison`, `SelectionTray`, `RelatedEntities`, `ActionGroup`, `PhotoGallery` | Grid/list collections, filters, selection up to six, detail, comparison, relationships, explicit links, galleries, deterministic offline planning, validated model plans | The vocabulary is intentionally small and flat. There is no first-class focus shell, fact group, diagram, image-region annotation, staged evidence block, or context rail. |
| **Card and detail surfaces** | `PresentCard`, `DetailContent`, `EntityMedia`, `DetailProgress` | Cards show image, summary, up to three attributes, a detail action, and comparison affordance. Detail has shared layout IDs, media, known attributes, comparison and related/action sections | The card-to-detail path is good but detail is still mostly a larger text/media surface. It does not express a reusable visual “glance/evidence/action” composition. |
| **Motion and disclosure** | `InterfaceMotion`, `MotionHeight`, `Disclosure`, `SemanticSurface`, `layoutId`, `useSettledReveal` | Semantic `focus`, `reveal`, `replace`, `expand`, `workspace-shift`, `restore`; stable-geometry scroll; user-input interruption; `inert`/`aria-hidden` during exits; `prefers-reduced-motion` | Motion is implemented in several primitives but lacks a public choreography model that says which state is active, what recedes, and which element receives focus. |
| **History and navigation** | `CatalogExplorer` history, `back`, `reset`, scroll snapshots, visitor view context | Back restores plan/state/scroll; manual input cancels pending model work; malformed or late plans preserve the useful current view | No explicit `ReturnAnchor` records the origin card, origin component, selection, or focus target as a reusable contract. |
| **Media** | `MediaProvider`, `MediaImage`, `EntityMedia`, `MediaGallery`, full-size viewer, `ExternalSearchResults` | Safe URL resolution, approved/public media, actual/example labels, captions/alt/credit, album/list/grid, keyboard lightbox, focus restoration, no AI-required browsing | Assets have no approved region geometry, annotation IDs, linked facts, or image-to-entity evidence map. The current viewer is a gallery/lightbox, not a fact-bearing image surface. |
| **Legacy source presentation** | `SitePresentation`, `SourceCard`, `MotionHeight`, source presentation schema | Overview/section/hours/contact/album/photo cards, expandable long copy, source-based details and galleries | This is a second visual grammar beside the catalog path. A shared `FocusSurface` and `DisclosureStack` can make the two paths feel related without forcing a migration now. |
| **Published knowledge** | `SiteContent`, `KnowledgeCatalog`, `PresentationPlan`, `MediaLibrary`, immutable revision IDs | Published snapshots provide entities, typed attributes, collections, relationships, jobs, safe link capabilities, approved media, and exact references; model cannot create HTML/CSS/URLs/facts | Entities do not yet contain reusable fact groups, diagram datasets, or annotation references. Any richer content must remain bounded, source-grounded, reviewed, and published. |
| **Studio authoring/review** | `Dashboard`, `Workspace`, `EditorPanels`, `KnowledgeReview`, `MediaPanel`, `OpeningSettings` | Draft proposals, corrections, apply/publish/undo, media metadata, opening highlights, chat/voice settings | There is no authoring flow for image regions, evidence blocks, diagram data, or a preview of the future focus choreography. |
| **Safety and fallback** | Zod schemas, `validatePlan`, `preflight`, `inert`, dialog focus return, reduced motion CSS, deterministic planners and offline fixtures | Invalid/stale plans are rejected; browsing, typing, keyboard and galleries work without AI, voice, or provider access | The same strong guarantees need to be carried into any new visual primitive; no “futuristic” affordance should become a new availability requirement. |

## Established techniques and useful references

These are implementation and design precedents, not a recommendation to add all
of them.

| Technique or tool | What it establishes | FlowPath implication |
| --- | --- | --- |
| [OpenUI Lang introduction](https://www.openui.com/docs/openui-lang) and [`react-lang` API](https://www.openui.com/docs/api-reference/react-lang) | A component library can constrain model output while a renderer progressively parses a controlled stream. | Keep FlowPath’s registered components and strict Zod/reference validation. If streaming is explored later, incomplete output must remain provisional until it passes the same validation. |
| [MDN View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API) and [element-scoped transitions](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using_element-scoped) | Browser-managed transitions can connect old/new DOM states, and element-scoped transitions can leave the rest of the page interactive. | A possible future adapter for the existing semantic transition vocabulary; not a second runtime or an item-5 dependency decision. |
| [Motion layout animations](https://motion.dev/docs/react-layout-animations) and [LayoutGroup](https://motion.dev/docs/react-layout-group) | `layout` animates position/size and `layoutId` connects different elements; scoping prevents unrelated IDs from colliding. | This is already the right conceptual basis for card -> focus -> return. Preserve it behind `SemanticSurface`; let item 4 determine any supplement. |
| [Material container transform](https://developer.android.com/reference/com/google/android/material/transition/MaterialContainerTransform) | A list item can transform into a detail container with shape/mask, content continuity, and a meaningful return path. | Use the pattern as a cross-platform precedent: the object should appear to travel, not disappear and reappear in an unrelated page. |
| [WAI-ARIA Disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) | A disclosure is a button controlling content with `aria-expanded` and optionally `aria-controls`; Enter/Space are predictable. | `DisclosureStack` should use native buttons and explicit states. Rich motion is decoration around a semantic disclosure. |
| [WAI-ARIA Dialog Modal pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Modal content needs a label, contained focus, Escape dismissal, and an inert/dimmed outside context. | Use a dialog only for a truly blocking viewer. A focused catalog surface should normally be a page region, not an accidental focus trap. |
| [WAI-ARIA Grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) and [keyboard interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) | Dense interactive collections can use one tab stop plus arrow/Home/End movement, but composite widgets require careful focus management. | Use a grid only when arrow navigation materially helps. Otherwise keep a plain semantic list of cards; never make a visual canvas the only route. |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html), and [Pause/Stop/Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) | Nonessential interaction motion must be suppressible; long moving content needs a way to pause/stop/hide. | Reduced motion changes the choreography to instant/crossfade states. No auto-rotation, pulsing text, camera zoom, or motion that carries meaning only through movement. |
| [W3C status messages](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22) | `role="status"`/polite live regions can announce result/progress updates without stealing focus. | Announce compact states such as “Opening House Blanco” and “Details ready”; do not stream every character into a live region. |
| [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/) | An annotation can identify a target with reusable selectors (including SVG/data-position selectors) and structured bodies. | Use it as the conceptual data model for reviewed image regions. The runtime still needs a smaller, exact, published schema. |
| [OpenSeadragon](https://openseadragon.github.io/) and [overlay examples](https://openseadragon.github.io/examples/ui-overlays/) | Deep-zoom images can carry overlays that stay attached to image coordinates; annotation plugins can use SVG or Web Annotation. | A candidate for a later high-resolution photo workflow, not needed for the first focus-surface slice and not a reason to add a dependency now. |
| Native [`<details>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details) and [Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using) | Browsers provide disclosure and top-layer contextual surfaces with keyboard/Escape/light-dismiss behavior. | Use native semantics as the no-motion/no-JavaScript fallback. Popovers are for short contextual facts, not the primary detail surface. |
| [Nielsen Norman Group progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Show the few important choices first, then reveal specialized detail on request; staged steps are not automatically better. | Use a short evidence ladder with obvious labels; do not force every visitor through a wizard or hide essential facts behind voice. |
| [OpenAI voice agents: build](https://openai.github.io/openai-agents-js/guides/voice-agents/build/) and [quickstart](https://openai.github.io/openai-agents-js/guides/voice-agents/quickstart/) | Browser voice uses explicit WebRTC/session setup, supports interruptions and typed input, and can carry multimodal context; a server mints ephemeral access. | The voice layer should request a typed visual intent and receive a visual acknowledgement. It must remain optional and host-controlled; this does not authorize a new SDK integration. |
| [Apple Siri guidance](https://developer.apple.com/design/human-interface-guidelines/siri/) and [accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility/) | Spoken responses should stand alone, while visual content and audio reinforce one another; do not rely on one modality. | Every voice result gets a readable surface and a transcript/status path. Every visual annotation has a text/list equivalent. |
| [CSS Spatial Navigation Level 1](https://www.w3.org/TR/css-nav-1/) | Directional navigation is a useful model for spatial layouts, but browser support and interaction details remain variable. | Treat directional navigation as an enhancement inside a bounded grid, not as the product’s only navigation model. |

## Proposed interaction grammar

### A bounded spatial model

The visitor sees a **2-D semantic collection with depth cues**, not an infinite
coordinate plane:

- a stable header/command dock;
- a collection or source list that remains the origin;
- one active `FocusSurface` with an edge-lit or haloed boundary;
- an optional `ContextRail` for related items and next actions;
- a local panel scroll when the focused content is taller than the viewport.

The surrounding collection may visually recede through opacity, tone, and a
small amount of depth, but it must not become an unreadable blur. If it is only a
backdrop, it is `inert` and removed from the accessibility tree. If it remains
useful context, it stays a normal semantic region and the active surface is
identified as the current region.

### State sequence

```text
resting
  -> intent acknowledged ("Opening ...")
  -> target validated
  -> focus transition (card and title retain identity)
  -> focused glance
  -> evidence/action disclosure (only when requested)
  -> related/compare/action state
  -> return (reverse transition or instant restore)
```

All inputs dispatch the same bounded intent shape. The model may select a
registered target and operation; the runtime resolves geometry, focus, content,
permissions, and action routing.

| Input | Intent examples | Required behavior |
| --- | --- | --- |
| Voice | “Open the white agave,” “tell me more,” “what is that region?”, “compare these,” “go back” | Acknowledge immediately, clarify if ambiguous, validate against the current published snapshot, then apply the same local action as a button. |
| Chat | The same phrases in text | Reuse the voice/typed planner and show the same visual status and result; no separate chat-only card grammar. |
| Tap/click | Card, More, hotspot, compare, Back | Direct manipulation cancels pending model work and wins over a late plan. |
| Keyboard | Tab, Enter/Space, arrows in an optional grid, Escape, Back | Preserve visible focus, predictable order, and a non-spatial route through every state. |

### Disclosure ladder

1. **Glance:** image or mark, name, one-line summary, two or three high-value
   typed facts, and the next obvious action.
2. **Focus:** the selected object becomes the reading target; title, full
   summary, approved media, and key attributes are visible.
3. **Evidence:** explicit “More context” reveals fact groups, annotations,
   diagrams, source/provenance labels, or comparison detail.
4. **Action:** registered links, related entities, gallery navigation, or a
   comparison decision surface.

This is not a forced linear wizard. Voice may jump directly to a requested
level, and every level has a visible control. A no-motion mode renders the same
levels immediately.

## Proposed components

The following proposals are deliberately small, composable, and split between
the portable package and the host. Each item covers the requested initial view,
activation, transformation, content, return path, ownership, and degraded mode.

### 1. `FocusStage` (P0, shared orchestration primitive)

1. **Initial view:** The existing collection/source cards, selection tray, and
   conversation dock remain visible in a stable 2-D layout.
2. **More-information request:** A card button, Enter/Space, voice, or chat
   dispatches `focus(targetId)`; the stage immediately exposes a compact status.
3. **Transformation:** The target receives the active slot; the collection
   recedes visually, the active surface gets a clear boundary, and the stage
   waits for settled geometry before scrolling.
4. **Contents:** Any registered surface: `FocusSurface`, comparison, gallery,
   annotated media, or a source detail. The stage owns placement, not facts.
5. **Return:** Back, Escape, close, or a related-item reverse action restores
   the prior stage snapshot and origin focus.
6. **Package/host:** The package owns state markers, semantic transitions,
   responsive layout, and callbacks. Studio/visitor hosts supply the published
   plan, resolver, provider state, and whether the context is non-modal or a
   true dialog.
7. **Unavailable behavior:** Render the existing page-region detail or a
   normal route with no transform. No visual recede is required for correctness.

### 2. `FocusSurface` (P0, shared composed surface)

1. **Initial view:** A card remains recognizable: same image, title, and short
   summary, with a “Open details” affordance.
2. **More-information request:** Tap/click, keyboard activation, “show me more,”
   or a named voice request selects the one validated entity/source.
3. **Transformation:** The card and focused panel share stable identity IDs;
   the image/title can enlarge while the surrounding layout reflows. The panel
   is a page region by default, not an accidental modal.
4. **Contents:** Heading, summary, `FactCluster`, approved `EntityMedia`,
   `DisclosureStack`, `ContextRail`, comparison affordance, and registered
   links/actions.
5. **Return:** Close/Back reverses to the card when possible, retaining
   selection and filters; if the origin no longer exists, return to the nearest
   valid collection and announce the change.
6. **Package/host:** The package provides the shell, slots, IDs, semantics and
   transitions. The host supplies entity data, published references and action
   callbacks.
7. **Unavailable behavior:** Existing `detailPlan`/`DetailContent` remains the
   fallback; if media is missing, preserve its caption/alt and show a stable
   placeholder.

### 3. `DisclosureStack` / `EvidenceLadder` (P0, shared semantic primitive)

1. **Initial view:** Show only the most useful facts and one clearly labeled
   “More context” or “Show evidence” control.
2. **More-information request:** Voice/chat can say “tell me more” or “show the
   evidence”; tap, click, Enter, or Space activates the same disclosure.
3. **Transformation:** The surface grows with measured height. Blocks appear in
   a short, interruptible sequence; no per-character typewriter is required for
   comprehension.
4. **Contents:** Typed fact groups, small metrics, text, citations/provenance,
   a registered diagram, image annotations, or safe actions. Each block has an
   explicit semantic type and bounded references.
5. **Return:** The same control collapses while preserving the focused object;
   Back returns to the prior surface and history snapshot.
6. **Package/host:** The package owns disclosure semantics, `aria-expanded`,
   keyboard behavior, measured layout, skip/instant mode, and slots. The host
   chooses which published blocks are available.
7. **Unavailable behavior:** Use native `<details>` or render all approved
   blocks in order. If the provider is unavailable, show the published facts;
   if motion is reduced, disclose instantly.

### 4. `MultimodalCard` / `FactCluster` (P1, shared content primitive)

1. **Initial view:** A visually distinct card combines an approved image/logo,
   title, summary, two or three high-value attributes, and one primary action.
2. **More-information request:** “Why this one?”, “show the differences,” or a
   normal open/compare action promotes the card into focus or comparison.
3. **Transformation:** The same image/title identity remains in place while
   facts regroup into labeled clusters; static bars or chips may appear only
   from typed values.
4. **Contents:** Text, media, typed attributes, source labels, relationship
   chips, and registered links. Do not add a model-written confidence score or
   a visual resemblance claim.
5. **Return:** Back returns to the card and keeps the selection/filters; closing
   a fact cluster does not reset the visitor’s place.
6. **Package/host:** The package owns layout, density variants, and semantics;
   the host supplies the catalog projection and approved media URL resolver.
7. **Unavailable behavior:** Collapse to the current `PresentCard` with text
   attributes. A missing image never removes the entity from the catalog.

### 5. `AnnotatedMedia` / `ImageFactMap` (P1/P2, shared runtime plus Studio authoring)

1. **Initial view:** The card shows a normal approved image. In a focused panel,
   a small legend or “Explore image” control signals that reviewed regions exist.
2. **More-information request:** A visitor taps a marker, uses keyboard focus,
   says “what is that?”, or chooses a labeled item from the annotation list.
   Ambiguous voice references produce a clarification, not a guess.
3. **Transformation:** The image gains a stable focus frame; the selected region
   is outlined or softly highlighted while the fact panel updates. On mobile,
   the image and list stack vertically.
4. **Contents:** Asset ID, normalized rectangle/polygon/SVG selector, label,
   description, optional exact entity/attribute references, caption, alt text,
   and provenance. The list below the image mirrors every marker; color is never
   the only distinction.
5. **Return:** Back returns to the focused image/card; closing the image restores
   the opener and previous annotation selection when possible.
6. **Package/host:** The package renders the image, markers, list, focus and
   keyboard model. Studio eventually needs a reviewable annotation editor in
   `MediaPanel`; the host stores annotations in a staged media revision and
   publishes only approved references.
7. **Unavailable behavior:** Show the image with its normal alt/caption and a
   plain ordered fact list. If the image is unavailable, show the list without
   pretending the visual region was identified. Do not infer identity from
   pixels.

### 6. `ContextRail` / `RelatedCluster` (P1, shared relationship primitive)

1. **Initial view:** A compact “Related” affordance or a few nonintrusive chips
   sit beside or below the focused object; the collection remains the origin.
2. **More-information request:** “What else is connected?”, a click, or a
   keyboard action reveals the rail.
3. **Transformation:** The rail enters as a bounded side/bottom region while
   the main surface stays stable. Selecting a related item pushes a new history
   frame rather than destroying the first object.
4. **Contents:** Explicit relationships, collections, safe publisher links,
   related media, and next-step actions. No inferred relationships from visual
   similarity.
5. **Return:** Collapse the rail to keep the current object, or Back pops the
   related focus and restores the previous rail state.
6. **Package/host:** The package owns layout, list semantics, and transitions;
   the host supplies relationship IDs and capability policy.
7. **Unavailable behavior:** Render an inline list of links or omit the rail if
   no relationships are published. The main detail surface remains complete.

### 7. `DecisionBoard` / `CompareDeck` (P1, shared decision primitive)

1. **Initial view:** Selecting two or more cards adds them to the existing
   selection tray; the visitor can still browse normally.
2. **More-information request:** Compare button, voice (“compare these”), chat,
   or keyboard activation opens the board.
3. **Transformation:** Selected cards recompose into the existing semantic table
   plus a visual difference strip. On small screens it becomes stacked cards;
   no horizontal data maze is required.
4. **Contents:** Typed attributes, shared/different values, approved media,
   relationships, and safe actions. Any ranking or score must be a publisher
   supplied formula, never an unexplained model judgment.
5. **Return:** Back restores the collection and selection tray. Removing an item
   updates the board locally and does not invoke the model.
6. **Package/host:** The package owns table/mobile semantics, comparison focus,
   and layout. The host supplies entities, attribute definitions, and any
   explicitly published comparison rules.
7. **Unavailable behavior:** The current `ComparisonContent` table is the
   complete fallback; no chart or animation is necessary.

### 8. `VoiceFocusBridge` / `IntentCue` (P0, host integration plus shared status)

1. **Initial view:** The existing waveform/composer remains visible with a few
   concrete prompts (“Open an item”, “Compare two”, “Show photos”).
2. **More-information request:** Voice and typed chat map to a shared intent;
   tap/keyboard actions can also enter the same command path.
3. **Transformation:** Show a short, visible sequence such as “Finding item” ->
   “Opening House Blanco” -> “Details ready”. Apply the view only after current
   snapshot/reference validation; manual input cancels stale work.
4. **Contents:** Transcript, status, clarification choices, cancel/stop, the
   visual result, and a concise spoken/readable summary. Voice is a controller,
   not a separate visual application.
5. **Return:** The dock persists for the next command; Back/close returns through
   `FocusHistory`; stopping speech does not discard the already-rendered visual
   result.
6. **Package/host:** The package owns intent callbacks, status slots, and
   cancellation semantics. The visitor/Studio host owns provider calls, usage
   bounds, browser permission, credentials, and transcript policy.
7. **Unavailable behavior:** Keep typed input, tap, keyboard and deterministic
   browsing. If a provider is unavailable, say so once in the status and leave
   the last useful view intact; never require a microphone for discovery.

### 9. `ReturnAnchor` / `FocusHistory` (P0, shared state helper)

1. **Initial view:** Each focusable card/source has a stable origin marker and
   accessible name; the marker is not visible chrome unless useful as a
   breadcrumb.
2. **More-information request:** Any focus, annotation, comparison, or nested
   related selection records an origin snapshot.
3. **Transformation:** Capture origin ID, component kind, entity/asset ID,
   filters, selection, scroll container/offset, and the intended focus target.
4. **Contents:** Back/Close label, “Back to results” count, breadcrumb, and
   optional current surface name. This is navigation metadata, not publisher
   content.
5. **Return:** Reverse the transition where geometry is valid; otherwise restore
   the nearest valid state, scroll there, focus the first useful control, and
   announce what changed.
6. **Package/host:** The package provides snapshot types and restoration hooks;
   the host decides whether history is in memory, URL state, or visitor session
   state. No URL/deep-link requirement is introduced in P0.
7. **Unavailable behavior:** A normal Back button and ordinary document order
   remain sufficient. If a card was removed by a new published revision, return
   to the collection rather than resurrecting stale content.

### 10. `DiagramPanel` / `DataStory` (P2, shared renderer with host-registered data)

1. **Initial view:** A focused surface offers a small “See the pattern” or
   “Show how these relate” control only when a publisher-approved dataset exists.
2. **More-information request:** Voice/chat, tap, or keyboard disclosure reveals
   the diagram.
3. **Transformation:** A static, bounded SVG/CSS diagram or metric strip appears
   inside the evidence ladder. It does not pan/zoom automatically or require a
   canvas gesture.
4. **Contents:** Typed values, labels, legends, relationship lines, and a full
   text/table alternative. Arbitrary model-generated SVG, scripts, and external
   URLs are excluded.
5. **Return:** Collapse returns to the evidence ladder; Back returns to the
   focused entity or comparison.
6. **Package/host:** The package owns a few registered diagram types and their
   accessible alternatives. The host publishes the dataset and provenance; the
   model may select a diagram type but cannot invent its values.
7. **Unavailable behavior:** Render the same data as text, a table, or a list.
   With reduced motion, display the complete static diagram immediately.

## Wireframe-level interaction concepts

### Concept A: image card -> annotated visual panel

```text
RESTING COLLECTION                         FOCUSED IMAGE PANEL
┌───────────────┐  ┌───────────────┐       ┌────────────────────────────┐
│ [photo]       │  │ [photo]       │       │ ← Back to 12 items          │
│ House Blanco  │  │ House Reposado│  ==>  │ [large approved photo]      │
│ 40% agave     │  │ 18 months     │       │  ① neck   ② label   ③ barrel│
│ Open details  │  │ Open details  │       │ ───────────────────────────  │
└───────────────┘  └───────────────┘       │ House Blanco                 │
       (context becomes quiet)             │ 40% agave · Jalisco          │
                                           │ [Show evidence] [Compare]    │
                                           │ Annotation list (keyboard)   │
                                           │ ① Neck: ...                  │
                                           │ ② Label: ...                 │
                                           └────────────────────────────┘
```

The card image and title keep their identity during the transition. The
annotation list is always present as an alternative to clicking a marker. A
voice request such as “what is number two?” is accepted only when the visible
numbered set is unambiguous.

### Concept B: catalog item -> focused information surface

```text
┌ collection grid ┐  Enter / "open the first one"  ┌ focused surface ┐
│ card card card  │ ─────────────────────────────>  │ title + summary │
│ card card card  │                                 │ key facts       │
│ selection tray  │   "tell me more"               │ More context    │
└─────────────────┘ ─────────────────────────────>  │ evidence blocks │
                                                    │ related/actions │
                                                    └───────┬────────┘
                                                            │ Back / Esc
                                                            ▼
                                                    exact origin card
```

The focused surface is not a route to a separate “normal website” page. It is a
state of the same semantic canvas, with a visible Back affordance and a bounded
local reading region.

### Concept C: voice request -> visual confirmation

```text
visitor speaks       dock: "Opening House Blanco"       visual focus surface
      │                         │                                  │
      └── typed intent ────────>│ validate current snapshot ──────>│
                                  role=status: "Details ready"      │
                                  spoken summary + readable text     │
```

The visual acknowledgement is useful even when voice is working, and the
spoken response is still understandable if the visitor is not looking at the
screen.

## Data and package boundary

### P0: compose what already exists

No schema change is required to prove the first slice. Compose the existing
`detail`, `gallery`, `relationships`, `actions`, `selection`, and `comparison`
components with:

- the current `spotlightId`/focus state;
- `layoutId` identity for card/title/photo continuity;
- `MotionHeight`/`Disclosure` for the evidence ladder;
- the existing history, settled reveal, scroll cancellation, and focus return;
- current `KnowledgeCatalog`, `MediaLibrary`, and safe capability references.

This is the lowest-risk way to make the interface feel richer without changing
what models are allowed to produce.

### P1/P2: versioned, reviewed extensions only if needed

If real use cases prove that the current data cannot express the compositions,
add small versioned contracts rather than a general “blocks” escape hatch:

| Extension | Required boundary |
| --- | --- |
| `FocusRequest` (interaction state, not free-form plan markup) | Operation plus exact entity/asset/annotation ID, current snapshot, origin, and return policy. The host validates it before rendering. |
| `FactGroup`/`DiagramDataset` | Bounded typed values and labels, with source/provenance and publication revision. A model can select a registered presentation, not write facts or SVG. |
| `MediaAnnotation` | Exact asset ID, normalized geometry/selector, accessible label/description, optional exact entity/attribute refs, and review status. Originals stay private; only published variants are exposed. |
| `PresentationPlan` v2 (only if composition cannot be represented locally) | Registered block kinds and exact references, bounded count/depth, explicit semantic transition, and the same parse/preflight/revision checks. |

The package remains independent of Next.js, Firebase, Studio aliases, and
provider credentials. Studio/visitor hosts continue to own persistence,
publication, provider calls, URL resolution, quotas, and capability policy.

## Accessibility and resilience requirements

- Use native headings, lists, buttons, links, tables, `<details>`, and `<dialog>`
  where they match the behavior. Add ARIA only to expose a real state.
- A disclosure button has an accessible name plus `aria-expanded` and, where
  useful, `aria-controls`. A focused surface has a stable heading and a visible
  Back/Close control.
- Capture the activation origin. Move focus to the focused heading only after a
  deliberate focus/open action; do not steal focus for a background model update.
  Restore the origin if it is still connected and not inert.
- Use `role="status"` for short progress/result messages. Keep the status node
  mounted before updates, and do not put a character-by-character stream into a
  live region.
- Use an APG-style grid only for dense card navigation that benefits from arrow
  movement. Otherwise preserve ordinary document order and tab stops.
- A modal image viewer is the existing dialog pattern: Escape, contained Tab
  navigation, a visible close control, and opener restoration. A catalog focus
  surface is normally non-modal.
- Every image annotation has a mirrored text/list representation. Alt text
  describes the image’s purpose; it does not claim that a model recognized an
  object. Actual/example media labels remain visible.
- `prefers-reduced-motion` removes travel, zoom, parallax, and staged timing;
  content and state remain. A visible “Show all”/“Skip animation” control is a
  useful opt-in even for users who do not set the system preference.
- No auto-rotating carousel, pulsing status, or indefinite camera movement. If a
  future story rail ever rotates, it needs explicit controls and pause behavior.
- Voice is optional. Typed input, tap, keyboard, browsing, and published
  fallback views are complete paths. Browser
  [`SpeechRecognition`](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
  availability varies, so it must not be the only input path.
- When AI, voice, media, or animation fails, preserve the last valid view, show
  a compact status/error, and leave local navigation usable. Never silently
  replace a valid view with an empty shell.
- Do not rely on blur, color, transparency, sound, or motion alone to communicate
  focus or state. Provide labels, borders, text, and focus indicators that work
  at high zoom and in high contrast.

## Prioritized implementation roadmap

| Priority | Scope | Why now | Exit criteria |
| --- | --- | --- | --- |
| **P0** | `FocusStage`, `FocusSurface`, `ReturnAnchor`, `DisclosureStack`, and `VoiceFocusBridge` as compositions of current primitives | Delivers most of the futuristic feeling with the least contract risk | Existing catalog/source paths share one focus choreography; keyboard, screen reader, reduced motion, interrupted transitions, stale voice plans, and exact Back restoration are covered by offline/browser tests. |
| **P1** | `MultimodalCard`/`FactCluster`, `ContextRail`, `DecisionBoard` refinements | Makes published entities feel information-rich without inventing new data | Fixture catalogs show image/text/attribute/relationship/action combinations; comparison remains a real table on mobile and with motion disabled. |
| **P1/P2** | Reviewed `AnnotatedMedia` plus Studio annotation editing/review | Enables the strongest “image reveals facts” concept, but requires provenance and authoring first | Annotation geometry survives publish/reload, every marker has a text equivalent, actual/example labeling is preserved, and missing media never blocks facts. |
| **P2** | `DiagramPanel`/`DataStory` for proven datasets | Useful for relationships and comparisons, but easy to overbuild | Every diagram has a typed source, text/table alternative, bounded size, and a non-animated fallback. |
| **Deferred** | WebXR/freeform 3-D, gesture-only canvas, arbitrary model SVG/HTML, auto-rotating story rails, per-character typewriter as primary content, runtime pixel-based identity inference, new executable capabilities | High complexity or safety/accessibility risk without evidence of a user need | Reconsider only after real visitor tasks show the simpler system is insufficient. |

### Verification plan for the first implementation slice

Use the repository’s existing checks rather than a new test harness:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run test:package`
- `npm run check`
- targeted browser suites for platform interaction, shared reveal, media,
  visitor quality/realtime, and reduced motion after a production build.

The offline/demo path should block external requests, microphone access, and
provider calls as it does today. A successful offline check proves interaction
correctness, not live provider quality or production voice latency.

## Recommendation to carry into item 4

Keep Motion as the current implementation owner and keep the existing semantic
transition vocabulary stable. Item 4 can evaluate whether a native browser
transition or an open-source supplement improves a particular adapter, but item
5 should consume that result through `SemanticSurface`/`FocusStage` rather than
exposing a new animation API to every component. The product decision is about
focus, evidence, and return semantics; the animation engine is an implementation
detail.

No runtime files, dependencies, deployment settings, secrets, or concurrent
gpt-live changes were modified for this item.
