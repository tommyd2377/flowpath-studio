# Website design and scrolling evidence

Captured from the local production build on 18 September 2026 with synthetic content in isolated Chromium. These are actual rendered pages, not mockups. The synthetic illustrations are explicitly labeled as examples; none are inserted into publisher sites by choosing a template.

| Template | Desktop, 1440px | Mobile, 390px | Tablet / large desktop |
| --- | --- | --- | --- |
| Editorial · menu | [Desktop](editorial-desktop.png) | [Mobile](editorial-mobile.png) | [768px](editorial-768.png) · [1920px](editorial-1920.png) |
| Showcase · services and portfolio | [Desktop](showcase-desktop.png) | [Mobile](showcase-mobile.png) | [768px](showcase-768.png) · [1920px](showcase-1920.png) |
| Clarity · menu | [Desktop](clarity-desktop.png) | [Mobile](clarity-mobile.png) | [768px](clarity-768.png) · [1920px](clarity-1920.png) |

[Watch the short Showcase scrolling recording](showcase-scrolling.webm). It follows native vertical scrolling down and back up through the opening, services, project and gallery. Browser assertions separately sample intermediate entrance/image transforms, once-only playback and offscreen cleanup; screenshots alone are not animation evidence.

| Additional coverage | Evidence |
| --- | --- |
| Photo-free guide | [Editorial](guide-editorial-mobile.png) · [Showcase](guide-showcase-mobile.png) · [Clarity](guide-clarity-mobile.png) |
| Sparse, 320px, larger text | [Editorial](sparse-editorial.png) · [Showcase](sparse-showcase.png) · [Clarity](sparse-clarity.png) |
| Long collection labels | [Editorial](long-collection-editorial.png) · [Showcase](long-collection-showcase.png) · [Clarity](long-collection-clarity.png) |
| Embedded Studio mobile preview | [Editorial](menu-editorial-studio.png) · [Showcase](services-showcase-studio.png) · [Clarity](guide-clarity-studio.png) |
| Full details | [Editorial](menu-editorial-detail.png) · [Showcase](services-showcase-detail.png) · [Clarity](guide-clarity-detail.png) |
| Motion settings / unavailable photos | [Branding](branding-motion.png) · [Failed image and larger text](failed-image-large-text.png) |

`npm run check` passed with Node 24: lint, types, 557 server tests, 22 rendering tests, packed consumer and production build. The eight regular-website template scenarios passed across nine publisher/template combinations. Eight new website scenarios verify scrolling, responsive layouts, saved/published motion, reduced motion, native navigation/disclosures, image loading, no-observer/no-JS content, and assistant return continuity. A separate legacy assistant assertion was reported to the parallel task's owner; see the implementation record for scope and remaining limits.

Reproduce with `npm run check`, then `npm run test:browser -- tests/browser/website-design.spec.ts` and `npm run test:browser -- tests/browser/templates.spec.ts`. These commands create only disposable local synthetic publications. The final website rerun used a temporary configuration on port 3228 to avoid the parallel task's port 3225; the committed configuration remains unchanged.

Measurements: [Editorial](editorial-performance.json), [Showcase](showcase-performance.json), [Clarity](clarity-performance.json), [controlled bundle delta](bundle-impact.json), [recording-time production resources](production-resources.json). Frame measurements are short local Chromium samples after fonts settle, not physical-device or cold-load benchmarks.

See the [design, implementation, shared-file notes and manual walkthrough](../../website-design-and-motion.md).
