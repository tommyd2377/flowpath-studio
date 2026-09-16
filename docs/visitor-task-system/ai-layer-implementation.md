# AI carousel layer — implementation

September 15, 2026. Implements the approved [revision 2 design](ai-layer-design.md). This supersedes the **visitor UI** described in `whole-website-filtering.md`; the query and publication infrastructure from that work remains.

## What visitors get

The normal website stays browsable with its published layout, brand, navigation, imagery and sections. The top waveform is the default interaction. Voice and Chat share a small switch at that anchor. Activating either reveals large cards above a softened, inert website. Chat expands for composition and returns immediately on Enter; there is no transcript thread, filter form, global assistant header, X or bottom composer.

Cards have Previous/Next, a global position and expansion. Escape or a deliberate outside tap dismisses the layer. The backdrop consumes the tap; a drag ending outside does not activate the page. Dismissal cancels pending work and stops voice and media. Website scroll, the selected carousel position and the unsent draft survive. Card changes restore keyboard focus; arrow keys and touch swipes navigate. Media controls and typing retain their own key handling. Reduced motion removes travel/blur, and mobile uses a scrim instead of blurring the entire page.

## State ownership

| State | Owner | Purpose |
| --- | --- | --- |
| Website sections, page and ordinary detail | `WebsiteSurface` | Normal website browsing, independent of AI |
| Open/closed assistant, input mode and composer | `SiteExperience`, `VisitorAssistant` | Persistent top interaction, lifecycle and focus |
| Scope, predicates, sort, canonical results, selected references and query/detail history | Existing `VisitorTaskStore` and validated capabilities | Authoritative collection semantics; shared across voice/chat |
| Semantic published cards and external research | Validated `WorkspaceState` | A data source for the carousel; no website geometry or mutations |
| Active card, expansion, previous selection and per-result position | `CarouselPosition` in `VisitorWorkspace` | One foreground carousel, regardless of its data source |
| Confirmed context | `CarouselContext` | Ordered current page, exact active/previous/narrated IDs, recent descriptors, reading position and media state |

Task results and semantic plans are mutually exclusive carousel projections. They are not separate visible workspaces. The existing `VisitorWorkspace` name remains for transport compatibility; its old whole-website composition has been removed.

`CarouselContext` carries at most 48 current card descriptors and 12 recent descriptors. Position restoration retains 20 result keys; semantic Back retains 12 frames. Only the active rich card is mounted. Paginated queries use stable global result ordinals, accurate totals and server cursors. An ordinal outside the loaded page resolves through the server's confirmed result set, not through DOM position.

**Navigation:** Next/Previous changes the selected card, not Back history. Expand/Collapse stays in that card. Back collapses, returns from detail, or restores the prior query/semantic frame. “Back to those results” restores the originating result page and order. “Show everything again” resets the existing query; “Search the whole site” explicitly changes scope. “Start over” clears the assistant. Home closes it and returns to the website top. Closing retains the session for explicit resume.

## Query → render → acknowledgment

1. Both modalities normalize finalized navigation through shared `carouselCommand`. Clear publication-driven filter requests use the same server `query.command` capability. Compound requests and ordinary questions retain the existing bounded model/tool runner.
2. The server queries the complete authorized publication index, including nested memberships and full indexed reading text. Typed predicates retain unknown/conditional/conflicting distinctions; canonical IDs deduplicate overlapping collections.
3. A validated task view or semantic batch reaches the client. The previous useful card remains during asynchronous preparation. `beforeShow` opens the assistant; it no longer changes website composition or page position.
4. The client renders the selected card, checks visibility/current generation, then acknowledges. The task viewport observes only the active carousel. Its subscriptions pause while the layer is closed.
5. The server records the result receipt. Subsequent assistant context includes the exact active card and bounded authoritative content. Voice completion follows both the card receipt and its answer-card receipt. Cancelled or failed displays cannot become successful spoken claims.
6. Manual movement, typing, switching modes, dismissal, Home and newer requests abort or invalidate earlier work. Query generation and interaction revision checks reject late responses. Invalid responses and errors leave the last useful view intact.

`VisitorAssistant.getContext()` no longer captures the website or installs whole-body mutation/resize/scroll observers. Legacy screen helpers remain for shared lab/tests and old protocol compatibility; the active visitor path supplies carousel context and strips stale background screen data.

### Gallery scene revision fix (September 16, 2026)

The carousel originally reused its observation counter for `scene.revision`. Answer/status updates, narration callbacks, and display acknowledgments advanced that counter without changing any published card. An otherwise valid gallery batch prepared from the earlier scene was therefore rejected with “The workspace changed.” An isolated mocked voice test reproduced that exact alert on both desktop and mobile before the fix.

`VisitorWorkspace` now tracks the scene independently from carousel observations. Its scene signature includes the workspace revision, visibility, actual active card, task result, expansion, reading position, and external selection. Answer/loading placeholders and acknowledgment-only updates do not change it. `apply` checks the current signature; publication, workspace-revision, interaction/generation, and actual scene-change protections remain enforced. This is shared client behavior for all publishers and both input channels; it adds no provider calls or retries.

Verification: 88 focused workspace/carousel/voice-control tests, seven isolated browser cases, targeted lint, typecheck, and production build passed. The new browser cases cover answer-before-gallery receipts in voice and chat, desktop/mobile reduced motion, and rejection after a real manual expansion. Existing cases cover photo movement, dismissal, mode switching, pending work, newer input, and Home. Browser transports and speech were mocked with synthetic publications on port 3225; live microphone/model behavior and the full browser suite were not tested in this fix. The user's server on port 3220 was left running. Refresh the visitor page to replace any already-open session using the old revision counter.

No-catalog publications gain derived information/photo/video records from approved content. Native sources use a child collection, so a navigation-only root remains valid. The compiled view permits 10,160 records to accommodate approved derived content alongside a 10,000-record imported catalog; import/storage limits remain 10,000. No provider retry or quota increase was added.

## Normal and preserved website presentation

Both generated content and the current preserved/imported path use the native `PublishedWebsite` renderer and existing `websiteSections` adapters. This repository's active published visitor path normalizes imported source markup into native content; it is not an arbitrary HTML iframe that must be rearranged.

`WebsiteComposition`, task-result insertion and filtered section replacement were removed from `PublishedWebsite`. Hero, sections, photos, navigation and footer remain website-owned. Normal clicks open an ordinary native detail dialog, with no task session or AI request. V2 catalog publications have a separate **read-only data endpoint** for normal website paging (24 records), rendered as a native website collection. This is normal page navigation, not a second filtering interface. Full details are fetched only when opened. Brand Home returns to the page top; Ask the assistant opens the overlay.

The detached results form is gone. Task result heading/criteria/detail/research/artifact renderers that still serve useful content are reused **inside** the selected card. The obsolete website result adapter and unused assistant presentation styles were removed. Shared lab/Studio/OpenUI components and backend query, validation, publication and capability code remain.

## Media

- Photos retain their approved captions, alt text, credits and depiction/example labels. Unknown product facts are never inferred from appearance. Only a current public photo may be attached to the existing model turn: at most one 512px JPEG, capped at 200 KB, using the authorized public thumbnail rather than a private original. The runner replaces this attachment when the active card changes; it does not create an extra model request. See [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision).
- The media library now accepts up to 20 published videos: uploaded H.264 MP4, an HTTPS MP4 URL, or a normalized YouTube ID. Publisher review and Apply-to-draft precede publication. Uploads are limited to 50 MB, 10 minutes and 4096 pixels per side, within the existing 100 MB site limit. MP4 structure is inspected without executing a decoder.
- Native video and the [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference) report actual play/pause/time events. Default is explicit Play; publisher-enabled autoplay is muted and active-card-only. Departure pauses playback and retains time. Reopening does not restart speech or audible video automatically. Audible media stops assistant voice. Published transcript cues are readable; absent video/transcript knowledge stays explicit.
- Uploaded video originals remain private until their media revision is published. Public file delivery validates current-publication membership and supports bounded byte ranges. Local and cloud storage paths preserve their existing authorization boundaries.

## Code map

| Area | Files |
| --- | --- |
| Website / assistant boundary | `components/SiteExperience.tsx`, `WebsiteSurface.tsx`, `VisitorAssistant.tsx` |
| Card selection, rendering and motion | `components/VisitorWorkspace.tsx`, `VisitorCarousel.module.css`, `packages/platform-ui/src/carousel.ts` |
| Confirmed task projection | `components/VisitorTasks.tsx`, `lib/use-task-viewport.ts` |
| Shared commands, context, tools | `lib/visitor-carousel-control.ts`, `visitor-request.ts`, `visitor-realtime-context.ts`, `visitor-task-bridge.ts` |
| Chat/voice acknowledgment | `lib/visitor-chat-task.ts`, `visitor-realtime-control.ts`, `visitor-task-runner.ts` |
| Published adapters and query | `lib/visitor-task-context.ts`, `visitor-query-command.ts`, `visitor-workspace.ts`, `visitor-capabilities.ts`, existing `catalog-query*` |
| Native website paging | `app/api/visitor/[slug]/catalog/route.ts`, shared `PublishedWebsite.tsx` |
| Media contracts and playback | Shared `media.ts`, `collection-space.ts`, `MediaVideo.tsx`; `lib/visitor-active-image.ts`, `video-processing.ts` |
| Upload / review / public assets | `components/MediaPanel.tsx`, `Dashboard.tsx`, `lib/file-validation.ts`, `media-store.ts`, `site-store.ts`, `cloud-store.ts`, file routes |
| Acceptance | `tests/ai-carousel.test.ts`, `tests/browser/ai-carousel.spec.ts`, carousel fixture/voice helpers, carousel case in `visitor-realtime-control.test.ts` |

## Verification and remaining limits

Final verification on September 15, 2026:

- `npm run check` passed: lint, typecheck, **502 server/unit tests**, **21 rendering tests**, packed-consumer verification and the production build.
- `npm run test:browser -- ai-carousel.spec.ts` passed: **8 isolated browser cases**, with no retries. Desktop and mobile screenshots were visually inspected. A rapid Expand → Collapse check caught and fixed a race where completion of the first command erased the next draft; local commands now clear their input before waiting for the card receipt.
- The mocked voice regression verifies both card and answer acknowledgment before completion, and checks that the next turn receives the actual active card content. MP4 route tests cover private upload, draft-only privacy, publication, byte ranges and authorization removal on republish, using disposable synthetic data.

All automated provider, voice and player behavior uses synthetic data and mocks. Mocked audio is not evidence of live speech recognition. The local verification logs are `/private/tmp/flowpath-carousel-check-final.log` and `/private/tmp/flowpath-carousel-browser-final.log`; screenshots are under `test-results/platform/ai-carousel-*`.

- The isolated browser cases cover desktop, 390px mobile, reduced motion, photos, expansion, keyboard focus, outside/Escape return, unchanged website and scroll, products/services refinement, broadening, sorting, unknown prices, detail return, empty results, reset, delayed requests, failure recovery, Home cancellation, idle observer shutdown, voice card acknowledgment, and a mocked YouTube player.
- The 10,000-record nested catalog case imports in 100-record chunks, keeps the normal site at 24 rendered catalog records, finds 3,334 chocolate records, opens global result 999 and returns to its results. Existing unit tests cover canonical duplicate membership, typed unknown values and relationships.
- In-app browser inspection used the actual Doc's publication on localhost:3220: the normal About detail and Escape return, “Show me your photos” (58 published photos), first/second photo rendering and stable selection, and switching to the waveform while preserving card two. It did not publish or edit that content, start the microphone, or trigger a paid model request. The development server remains running on port 3220.

Remaining limits: live microphone/provider quality, active-image description quality, real YouTube networking and MP4 decoding/audio are not verified by these mocked checks. Website videos can be added through the reviewed media URL field; automatic discovery/import of arbitrary source-site video embeds is not implemented. Native audio files and arbitrary interactive embeds do not have new players. The existing registered chart/artifact renderers remain available; this change does not add arbitrary model-generated JavaScript. MP4 range delivery currently reads the bounded asset before slicing. Older browser suites that asserted whole-website filtering or multipanel visitor layout describe the superseded UI and have not all been migrated; do not cite the entire historical browser suite as passing.

## Manual sequence

1. Browse and scroll the normal website. Open/close a normal item.
2. Choose Chat, click the composer, enter “Show me your photos,” and press Enter. Observe its immediate return to the top and the large photo card.
3. Next → Expand → Collapse → open another item → “Go back to those results.” Use arrow keys too.
4. On a product/service publication: show a category, constrain price, broaden the category, sort, remove the price constraint and clear all filters. Try a no-match query.
5. Switch to Voice without changing the selected card. With live testing separately authorized, ask what is showing, then request the next card and ask again.
6. Escape or tap the backdrop. Confirm the original page and scroll return and playing media stops. Reopen to the retained position.
