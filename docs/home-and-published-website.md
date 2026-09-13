# Home, complete website browsing, and search recovery

Implementation: 2026-09-12. Local changes in the existing Studio checkout; no deployment, dependency replacement, billing change, or published-data migration.

## Experience

**Home** is available in the workspace toolbar, focused cards, the photo lightbox, and external image/source viewers. Typed home/main-page/start-over/beginning requests resolve locally, including when AI allowances are exhausted. Voice has explicit `home` and `browse` navigation tools. Home cancels pending client work, clears temporary searches, selections, filtering, focus history and client conversation context, dismisses viewers, and restores the publisher's configured opening. It preserves the publication and an active voice connection. Ordinary Back remains a one-level return.

**Browse published content** opens a complete responsive website: brand/navigation, a headline and approved photograph, publisher stories, knowledge collections, photo collections, search and a footer containing the actual published contact/hours. A publisher-selected/site-primary image takes precedence; otherwise the first published collection image is featured with its existing caption. Empty contact fields and absent media are not invented. The idle waveform is hidden in full browsing mode; Ask the assistant returns Home. The typed composer remains available when browsing in chat mode. Voice-preferred sites now always offer typing.

The composition is deterministic from the current public snapshot. There is no extra model call on page load and no new HTML/code generation. Existing palettes, controlled Motion choreography, public asset authorization and schema validation remain authoritative. Website cards and conversational collection cards share `ContentCard`; external sources use the same typography and spacing. Publisher facts and temporary web findings remain visibly distinct.

## Redundancy and semantics

Each reference is listed once across overlapping website collections. Individual facts are searchable and available in their parent detail rather than duplicated as default navigation cards. Exact same-name entity entries share one navigational listing, but their descriptions and facts remain separate inside that listing. Grouping names does **not** assert an identity merge or pick a winning price, date or description. Differently named aliases still require the existing publisher knowledge review/identity workflow; this change does not infer identity from photographs.

Repeated atomic adds with identical component/reference order reuse the existing unfiltered object, even if the model supplies a different instance ID. Later operations in that batch resolve to the retained ID. Different references, different comparison order and independently filtered views remain distinct. Details render projected attributes/facts once per field; qualifications and conflicting values are preserved.

The browser scene additionally reports `page` and up to 24 actually visible `browseItems`. The server validates each against published references. Website ordinal requests use measured reading order, not catalog array order. Hidden or offscreen content is not reported as visible.

## Search recovery

- Explicit image/web searches are routed before generic expansion commands. Adding web context requires an annotation request, rather than any phrase containing “expand.”
- Search uses its own allowance; exhausted chat allowance does not block it. “Images of this place” carries the focused published name (or the current search topic); a missing topic is clarified before any request.
- Up to six recent result sets are retained. A successful new search can rotate out the oldest temporary search; published objects are never automatically evicted. Atomic validation includes both retiring and arriving references, then removes the retired result.
- Capacity is checked before the paid request on both typed and voice paths. If all twelve slots contain published views, the visitor is asked to close one or use Home. No paid retry is sent automatically.
- Closing/resetting views releases their external context. Pending work is cancelled or suppressed after manual navigation. The browser still must acknowledge the actual display before voice claims success.
- Source cards adopt the provider's citation titles when the earlier search-source list contains only URLs. Tracking-only URL variants and page fragments share one source card; meaningful query parameters remain distinct and original citation links stay intact.

The existing provider request matches the official image-search contract: `search_content_types`, `image_settings`, `include: ["web_search_call.results"]`, and typed `image_result` entries. No model or library switch was necessary. [OpenAI image-search documentation](https://developers.openai.com/api/docs/guides/tools-web-search#image-search-results)

## Code map

| Responsibility | Files |
| --- | --- |
| Local Home/Browse aliases | `lib/visitor-navigation.ts` |
| Search capacity/rotation and grounded follow-up topics | `lib/explore-workspace.ts`, `lib/explore-model.ts` |
| Citation titles and source-card deduplication | `lib/explore-provider.ts` |
| Published page composition and same-name navigation grouping | `lib/website-presentation.ts` |
| Shared website, cards, visual tokens and responsive behavior | `packages/platform-ui/src/PublishedWebsite.tsx`, `styles.css` |
| Home lifecycle, typed routing, independent chat/search limits | `components/VisitorAssistant.tsx`, `SearchExplore.tsx`, `SiteExperience.tsx` |
| Workspace transitions, website entry points, external installation | `components/VisitorWorkspace.tsx` |
| Atomic object reuse and bounded scene contract | `packages/platform-ui/src/workspace.ts` |
| Focused/modal Home controls | `AdaptiveWorkspace.tsx`, `MediaViews.tsx`, `ExternalSearchResults.tsx` in the shared package |
| Measured page/card visibility and server validation | `lib/workspace-screen.ts`, `lib/visitor-realtime-context.ts` |
| Voice navigation and pre-search validation | `lib/visitor-realtime-control.ts` |
| Regression evidence | `tests/home-browse.test.ts`, `tests/browser/published-website.spec.ts`, existing workspace/search suites |

## Verification

Local verification:

- `npm test`: 334 server/unit and 21 rendering tests passed. Includes Home aliases, reset boundaries, same-object reuse, duplicate-name grouping with conflicting facts preserved, external rotation/capacity, measured website ordinals, contextual searches, and citation-title/tracking deduplication.
- `npm run lint`, `npm run typecheck`, `npm run test:package`, and `npm run build` passed. The independently packed package still renders without Next.js or provider dependencies.
- `tests/browser/search-explore.spec.ts`: all seven tests passed, including mocked voice Home acknowledgement, 24-image labels, cancelled/failed searches, hover/highlight, card-body dismissal and web additions. The existing story opener assertion was updated for the complete website; retained-card checks explicitly return to workspace mode.
- `tests/browser/adaptive-workspace.spec.ts`: all nine tests passed, including concurrent address/email/photo/map objects, mobile/reduced-motion focus return, published facts and keyboard lightboxes. The focus-trap assertion now includes the new Home button.
- `tests/browser/published-website.spec.ts`: both tests passed on the final build, including opening the first visible website match with zero chat allowance. These three browser suites total 18 passing tests.

Browser fixtures use isolated demo storage, synthetic illustrations and mocked providers; they do not create or alter customer publications. The complete-website suite covers desktop/mobile composition, footer, duplicate-name groups, photo Home, exhausted chat allowance, and seven successful searches retaining six recent sets.

Live verification used the already configured development server at `127.0.0.1:3220` and the explicitly authorized Brave tab. Exactly three paid API-triggering actions were performed, with no automatic retries:

1. “Find photos of the Catskill Mountains online” returned seven actual images, all visibly loaded.
2. With Dutchess County focused, “Find images online of this place” resolved to Dutchess County and returned seven loaded images. “Expand image A2” opened the second image without a new search; Home dismissed both the native viewer and retained workspace content.
3. “Add web context” on Dutchess County returned a cited web addition inside the card. This exposed the source-title/tracking duplication issue; its parser correction was then verified offline without spending a fourth request.

The built-in United States map also loaded actual OpenStreetMap tiles and zoomed from overview level 3 to 4 without an OpenAI call. It counts against the app's search-request allowance. Named-card opening, typed main-page/Home, and full browsing were verified in the same session. The actual GoSite page was visually checked at desktop and 390px mobile width, including photos and the published footer; no horizontal overflow occurred. The temporary viewport override was reset.

Real microphone/transcription behavior remains untested. Mocked voice navigation verifies the shared acknowledgement/control path, not live audio quality. These checks establish bounded live provider success, not universal image-host availability, relevance, production readiness, or a reconstruction of every earlier failed voice request. The server remains running for the publisher's next test.
