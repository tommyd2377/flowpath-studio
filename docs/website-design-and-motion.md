# Regular website design and motion

## Complete gallery images — 2 October 2026

Photo sections now use contained images with reserved proportions derived from approved asset dimensions, bounded between 4:5 and 2.2:1. This preserves the complete photograph or collage, including wide and portrait edges, instead of forcing every image into a 4:3 cover crop. Extreme proportions may leave space around the image. Gallery images omit frame zoom/depth choreography so hover and scrolling cannot crop that composition again; other website motion remains available.

When a reviewed opening photograph also belongs to a photo section, that section leads with its other photographs and keeps the opening image as a compact, clickable **Opening photograph** reference. Every entry, photo count, caption, credit and illustrative-example label remains available; larger albums retain their expand/collapse controls. Record and story illustrations keep their contextual images. A missing or unresolved hero does not remove album images, and unavailable image URLs retain the existing fallback and photo action.

Sparse photo sections with zero or one remaining image use a 720px maximum content width, keeping desktop photography proportionate while retaining the mobile stack. Photo cards and opening references display **View photograph**, with an underline on keyboard focus as well as hover; photo counts stay on one line. Full-image fitting, metadata, detail actions and reduced-motion behavior are unchanged.

These are deterministic shared-renderer rules for generated and existing websites, including Studio previews. They do not alter source images, saved album order, approved hero eligibility, composition proposals or publication state. They add no image interpretation, focal-point guessing or provider request. The two real-source controls used for visual checks were manually curated; that evidence is separate from automatic import or model-generation quality.

## Distinct template composition — 27 September 2026

The [current refinement](website-design-update-2026-09-27.md) replaces the shared fade/rise vocabulary with template-specific lateral reveals, finite image focus and compact spatial entrances, including mobile. Content-aware supported compositions adapt to actual media coverage; sparse and mixed-media collections stay simple. The September 19 distances and frame keyframes below describe that historical pass, not the current choreography. No new animation dependency or paid API call was added.

## React Motion choreography — 19 September 2026

The actual cake-shop publication was already using `PublishedWebsite`, Showcase and the default Subtle setting, with reduced motion disabled and ordinary document scrolling. Its package build matched the source. The problem was the choreography: the old 6–14 px entrance moved the entire opening copy together, lasted only 0.26–0.5 seconds, and reserved continuous image depth for Expressive. Increasing visibility required changing that runtime, not republishing the customer's site or replacing its content.

Motion's React [overview](https://motion.dev/docs/react), [animation](https://motion.dev/docs/react-animation), [layout](https://motion.dev/docs/react-layout-animations), [scroll](https://motion.dev/docs/react-scroll-animations), [SVG](https://motion.dev/docs/react-svg-animation), [transitions](https://motion.dev/docs/react-transitions), [gestures](https://motion.dev/docs/react-gestures), [useAnimate](https://motion.dev/docs/react-use-animate), [accessibility](https://motion.dev/docs/react-accessibility) and [motion component](https://motion.dev/docs/react-motion-component) pages were read in the Codex in-app browser, including their examples and source snippets. The implementation uses the installed Motion 13.2.0 APIs without upgrading dependencies.

| Documentation technique | Website components and implementation decision |
| --- | --- |
| React `useAnimate`, keyframes, transitions and `stagger` | One scope per `PublishedWebsite`. Eyebrow, headline, description, actions and approved hero frame enter separately. Section headings, menu/service/project rows, reading entries, gallery frames and footer use bounded groups of contemporaneous arrivals. Dynamically expanded/paged entries register in the same scope. |
| Scroll-triggered animations | The observer uses the actual scrolling ancestor, including Studio's embedded preview. It unobserves before translating, so an element at the viewport edge cannot cancel its own entrance. Each mounted element enters once; fast scrolling does not queue behind invisible entries. |
| Scroll-linked transforms | At most two approved images receive depth on wide Showcase layouts; Expressive also enables it for Editorial. Motion writes directly to the image using `scroll`, with native timelines where supported. No React state updates per scroll frame. |
| Variants, spring transitions and gestures | Website-only `motion.button` arrows respond to hover and keyboard focus, with a restrained tap response; the primary `motion.a` lifts on hover. Shared assistant card defaults are unchanged. Native FAQ/menu disclosures get a brief content entrance. |
| Layout and shared-layout animation | Whole-page layout projection and shared `layoutId` transitions were considered but are unnecessary for the current native document, anchors and dialogs. Their scale correction/scroll-container requirements do not justify animating every long text block. Width and height remain governed by the existing layout. |
| SVG drawing/morphing and drag | No decorative path drawing or draggable navigation was added: these components have no semantic drawing or drag operation. The existing arrow moves as one icon. Content images, approved identity and native browsing stay intact. |
| Accessibility and lifecycle | Server HTML is readable; Off and reduced motion leave a still page. Live preference changes also disable gestures, using a subscription because installed `useReducedMotion` samples on mount. Focus settles an entering target. Hiding/obscuring a website, resizing across the depth breakpoint, removed images and unmounting clean up work. Final transform writes are cleared after Motion's render phase. |

Subtle now has a visible, finite entrance: Editorial 42 px / 0.86 s / 100 ms stagger; Showcase 54 px / 0.94 s / 120 ms; Clarity 30 px / 0.64 s / 75 ms. Narrow layouts use 70% of that distance; Expressive uses 115%. These headline distances do not change document layout. Other text uses shorter travel and stays at least 45% opaque; headlines start at 35%. Stagger is capped at three intervals. No future section is hidden while waiting to intersect.

The [motion evidence gallery](screenshots/website-motion/README.md) records before/after openings and scroll sequences for menu, services/portfolio, image-free guide and image-free travel fixtures across all three templates at 1440 and 390 px, plus read-only captures of the actual cake-shop publication. It distinguishes visual results, local performance observations and verification limitations. Earlier design/hero results below are historical runs rather than the status of this choreography pass.

The final choreography pass passed all 26 recorded sequences, its lifecycle/accessibility checks, eight existing website-design scenarios, three hero scenarios and seven relevant template scenarios. Lint, typecheck, 24 rendering tests, independent package consumption and production build passed. The broader server run had 590 passes and one unrelated sibling-runtime byte-equality failure caused by a concurrent comment addition; therefore aggregate `npm run check` is not claimed as passing. The gallery records the exact scope and results. No customer publication or live model call was needed.

## Real-content integration correction — 18 September 2026

The initial refinement was gated on an explicit `style.template`. Older imported publications had only a `layout`, so they kept the old composition and missed nearly all of the new styling. The website now resolves an effective template at rendering time: saved template first, Editorial for an editorial layout, Clarity otherwise. No customer snapshot or publication is rewritten; existing colors, accent, typography settings, content and assistant theme remain unchanged. Website-local typography fallbacks serve older snapshots lacking those tokens. New website import proposals include the corresponding template for review.

All website snapshots use the same semantic section composer. It preserves distinct approved records with matching names, keeps existing published PDF reading entries reachable, and shows each reviewed album once instead of repeating the same title across several automatic strips. Source captures remain private. Imported labels such as `Listed price (USD)` and `Price / size terms` now carry shared presentation roles; the price row keeps every qualification visible. This uses approved field labels/aliases, without estimating prices or inferring live ordering capabilities.

Listing previews suppress only exact generated repetitions of the same approved price/category terms; unique descriptions and every price qualification remain visible, while full details keep the original wording. Reading previews omit an opening heading only when it duplicates that item's title. The v2 catalog projection now retains record kinds, prioritizes approved price fields and conditions within its existing four-value card limit, and distinguishes a published video's identity from its approved image poster. It still fetches only the current 24-record page or requested detail; broader collection hierarchy composition remains separate work.

Regression cases cover legacy snapshots without template selection, unchanged saved branding, real HTML menu extraction labels, complete price conditions, distinct same-name offerings, published document access, single-album composition, bounded v2 projection and video posters. These additions require the current verification run; the earlier counts below describe the previous refinement run.

## Plan — 18 September 2026

Scope: the regular publisher website and Branding preview. Preserve the current working checkout, including the parallel assistant redesign. No assistant state/history, orchestration, screen context, shared card defaults, theme tokens, paid APIs, deployment or customer publication changes.

1. Inspect `PublishedWebsite`, canonical composition, approved media, Branding persistence and actual local rendering. Capture a synthetic baseline before changing the renderer.
2. Refine Editorial with expressive reading typography, asymmetric images and ruled side headings; Showcase with a confident opening and deliberate portfolio/gallery proportions; Clarity with compact navigation, useful rows and clear details. Keep sparse sites concise and mobile layouts intentional.
3. Present approved menu/pricing, service, project, reading, FAQ and gallery content according to its existing semantic type. Retain complete facts and qualifiers in accessible details, with captions, credits and example labels intact.
4. Add an optional `websiteMotion` setting (`off`, `subtle`, `expressive`; absent means Subtle). Merge through Branding/draft/publication without changing assistant motion or other style choices.
5. Add website-only progressive enhancement using installed Motion 13.2.0 and CSS: coordinated once-only entrances, Editorial image-frame reveals, Showcase's selected image expansion/depth, short Clarity entrances and native disclosures. Native scrolling, visible server HTML and reduced motion are the baseline. Suspend observers/subscriptions while obscured; preserve mounted media and scroll position.
6. Verify synthetic menu, services/portfolio, guide, sparse and long/large collections at 320/390, 768, 1440 and 1920px, including embedded previews. Review actual animation frames, details/focus, anchors, image failure, larger text, motion settings and assistant return. Run Node 24 checks and isolated browser regressions, then refine and record evidence.

## Dependency decision

Keep Motion 13.2.0 and CSS. The installed `animate`, `scroll`, reduced-motion and layout APIs cover bounded website choreography; the [official scroll guide](https://motion.dev/docs/react-scroll-animations) and [layout guide](https://motion.dev/docs/react-layout-animations) inform the implementation, with installed declarations/source as the API authority. No new dependency, license obligation, paid tool or external service is introduced. Anime.js/GSAP would duplicate available animation capabilities for these short, unpinned sequences. Lenis would change native scrolling without solving an observed problem. Native scroll timelines can be used by Motion where supported; readable content does not depend on them.

## Implemented design

| Template | Composition | Motion |
| --- | --- | --- |
| Editorial | Expressive serif opening, asymmetric framed photograph, fine rules, side headings beside readable content, priced menu rows and a staggered gallery | Separate opening elements, ruled-heading arrivals and asymmetric frame reveals. Expressive adds desktop sticky headings and bounded image depth; reduced motion removes those enhancements. |
| Showcase | Confident opening typography, an image-aware split or bounded banner hero, services as ruled rows, a distinct project presentation, unequal paired gallery frames and a contained footer | Deliberate opening/section sequences and a finite frame reveal. At most two approved images gain restrained depth on wide layouts, including Subtle. |
| Clarity | Compact navigation, approachable contained opening, optional contents directory, practical rows, clear qualified prices and compact questions | Shorter coordinated entrances, 75 ms capped group staggering and native disclosure feedback; no parallax. |

Menu/priced rows retain the entire qualified amount. Services, projects, reading and galleries no longer share one generic card treatment. Repetitive section eyebrows and long repeated action labels are removed. Full approved prose and fact qualifiers remain in the native detail dialog, now with readable definition lists. Gallery and detail views retain captions, credits and illustrative labels. Only existing approved associations and explicit opening selections supply images; ingestion and identity rules are unchanged.

The mobile layout uses natural vertical reading, useful full-width images, shorter entrances, touch targets, native menu disclosures with Escape/focus return, independent safe-area gutters, and no image-depth subscriptions. Text-only pages do not invent images. Empty navigation allowances and redundant sparse footer headings disappear. Branding thumbnails render actual draft content with motion disabled; the interactive draft preview uses the chosen motion setting.

## Runtime and code map

| File | Responsibility |
| --- | --- |
| `packages/platform-ui/src/PublishedWebsite.tsx` | Website composition, internal website cards, navigation, native questions, expansion and footer. Exported assistant `ContentCard` defaults remain unchanged; its optional `motionEnabled` flag lets the legacy website avoid overlapping hover choreography. |
| `packages/platform-ui/src/website.css` | Explicit `data-website-design` scope for template styling and disclosure feedback; `data-website-detail` scopes the website dialog. Imported by shared `styles.css`; no global token or assistant-selector changes. |
| `packages/platform-ui/src/website-motion.ts` | Once-per-mounted-element entrances, nearest scrolling ancestor, bounded scroll effects, visible/offscreen lifecycle, reduced-motion updates and cleanup. |
| `packages/platform-ui/src/site-design.ts` | Optional `websiteMotion`, Subtle defaults and preservation/reset of explicit settings. The shared theme-token output is unchanged by motion choices. |
| `components/BrandingPanel.tsx` | Off / Subtle / Expressive, actual draft preview and existing Save draft boundary. |
| `components/WebsiteSurface.tsx` | Motion/active props, full details, captions and credit. Native dialogs keep Escape and opener focus return. |
| `components/SiteExperience.tsx` | Only forwards `active={!layerOpen}` to the website. Assistant orchestration remains with its separate task. |
| `lib/website-presentation.ts` | Carries existing entity kinds and approved photo metadata into presentation, without modifying canonical data. |
| `packages/platform-ui/src/MediaViews.tsx` | Additive `checkInitialLoad` flag, default false, opted into only by website images. It catches image errors that happened before hydration so the existing reserved-space fallback appears. |

Server HTML is visible. Observers start animation from readable content rather than hiding future sections in advance. Failure or absence of IntersectionObserver leaves everything visible. A WeakSet retains entrance history while the assistant or a detail dialog obscures the page; cleanup stops animations and subscriptions without unmounting media or resetting scroll. Page visibility also suspends work. Expanded entries are discovered through a cleaned-up MutationObserver.

Wide Showcase image travel is ±1.5% at scale 1.035 in Subtle, or ±2.2% at scale 1.05 in Expressive. The finite Showcase frame entrance opens from a 7% inset; Editorial uses an asymmetric 12% right / 14% bottom inset. Clarity's frame uses a short translation and opacity transition. Only visible signature frames subscribe to Motion's scroll API; subscription cleanup also handles removed or failed images. Effects write transforms/clip paths directly, not React state on each scroll frame. Native scrolling and anchors are retained. No pinned storytelling, artificial scroll distances or global smooth-scroll override is added.

## Verification

### Hero proportions — 19 September 2026

The regular website hero now uses approved media dimensions before image load. Showcase previously stretched every hero photo across the page, including small square uploads. Square, portrait and smaller landscape images now sit beside the title, description and actions on desktop. Only Showcase images at least 1,200 pixels wide with a ratio of at least 1.5 use its banner composition, with a bounded height. All three templates constrain image size; split heroes preserve source proportions and limit enlargement to 1.5 times source width. Mobile stacks the content and image with a separate height limit. Publisher colors, content, motion choices and assistant behavior are unchanged.

On the local cake-shop publication at 1440×1000, its 331×331 photo changed from a 1296×589 banner to a 496.5×496.5 side image; the hero height fell from approximately 997 to 625 pixels. The actual publication was inspected at desktop and 390-pixel mobile widths without changing its saved content or making model calls.

Production build, typecheck, focused lint, 12 template tests, three website rendering tests and eight existing website-design browser scenarios passed. Three additional `website-hero.spec.ts` scenarios verify square, portrait and landscape images across all templates at 1440, 1920 and 390 pixels, including image loading, source proportions, bounded dimensions, overflow and opening/closing full details. These synthetic tests run in a separate browser group to stay within the unchanged 12-site local workspace limit. Screenshots were visually reviewed. This is local Chromium coverage, not physical-device verification.

The [earlier refinement evidence gallery](screenshots/website-design/README.md) contains desktop/mobile captures for all templates, tablet/large-desktop views, the photo-free guide, sparse/long collections, embedded Studio previews, full details, Branding and a short actual browser recording.

- Node **24.6.0**, installed Motion **13.2.0**, isolated Playwright Chromium, synthetic publishers and original synthetic illustrations. No signed-in browser profile, model calls or customer publication.
- Final `npm run check`: lint, typecheck, **557 server tests**, **22 rendering tests**, independent packed-package consumption and production build passed. The combined count includes concurrent assistant work; website-specific assertions are in `tests/template-design.test.ts` and `tests/presentation/website.test.ts`.
- Eight website-design scenarios cover all templates at 1440, 1920, 768, 390 and 320px; actual intermediate animation frames; once-only reveals; offscreen cleanup; live reduced-motion changes; Branding save/publication separation; embedded scrolling; assistant return with the same image DOM and scroll position; failed/slow images; larger text; missing observers; and readable server HTML/native FAQs without JavaScript.
- Eight existing regular-website template scenarios passed, covering nine menu/services/guide combinations, details and focus return, mobile navigation, independent palettes/settings, sparse sites, 100 long entries with expansion, and a 49-record paginated collection with full qualified details.
- A legacy assistant-carousel assertion in the shared template suite was handed to the parallel task's owner; its independent integration result is recorded in the gallery. The entire unrelated browser suite is not claimed as passed.

Visual refinement corrected inherited full-width gallery rules, undersized mobile gallery images, an early image-failure hydration edge case, empty navigation allowance on sparse sites, redundant sparse footer headings, and tablet scroll effects using outer rather than content width. The final accessibility pass also preserved heading levels when duplicate titles are omitted and kept qualified service prices within narrow mobile rows. Saved screenshots were used as references; the new images come from the current rendered implementation.

## Payload and scrolling measurements

The controlled production-minified website consumer grew by **18,911 bytes of JavaScript (6,905 bytes gzip)**. Additive minified website CSS is **27,371 bytes (3,837 bytes gzip)**. No dependencies or fonts were added. See [raw bundle measurements](screenshots/website-design/bundle-impact.json). Both builds use the same dependency graph; the baseline substitutes only the original website renderer/design and image component. This isolates the website change from ongoing assistant edits and is not a claim about a stable Next.js route-chunk delta.

The production route captured during the final scrolling recording fetched **1,405,265 decoded JavaScript bytes** and **208,293 decoded CSS bytes**, including the wider application and assistant graph. [Resource list](screenshots/website-design/production-resources.json). This is a recording-time snapshot of the shared checkout, not a network-compressed or website-only size.

Final bounded scrolling samples after fonts settled measured a median **16.7 ms** between animation frames and **16.8–17.1 ms** at the 95th percentile, with **no >50 ms long tasks and no layout shifts** in those samples (159–184 frames per template). Raw per-template measurements accompany the gallery. These are local headless Chromium observations with video recording, not a hardware-independent performance promise. Mobile viewport checks do not establish physical Safari/iOS behavior, cold-font performance or low-end-device frame rates.

## Manual walkthrough

1. Start the local demo under Node 24. Open Branding on a synthetic site; choose a template and **Website motion → Scrolling & transitions**. Use the desktop/mobile preview and scroll inside the frame.
2. Try Off, Subtle and Expressive. Check the qualified menu rows, service/project distinction, captions, questions and full details. Save the draft; the Published preview must retain its previous styling.
3. On an already published synthetic local fixture, scroll down and back up, follow an anchor and use the mobile Menu. Open a detail, then Escape; focus returns to its opener. Expand a large collection and page a compiled one.
4. Open the assistant while scrolled down, then close it. The website and its media remain mounted at the same position. Enable the OS/browser reduced-motion preference; image tracking and entrances stop immediately.

No customer site, repository commit/push, deployment, secrets, billing or production configuration was changed. The personal footer was not added; the existing FlowPath Studio attribution remains.
