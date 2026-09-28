# Website composition and motion evidence — 27 September 2026

These are synthetic, locally created publisher fixtures in isolated Chromium against the final production build. All remote browser requests are blocked. The images are original test illustrations, explicitly labeled as illustrative examples; they are not customer assets or evidence of live import quality.

[Compact Showcase desktop example](showcase-desktop-hero-synthetic.png) is a direct 1440 × 1000 viewport capture, with no post-capture crop. It was captured by rerunning the single Showcase choreography case: **1/1 passed (7.6s)**. This synthetic design-studio example is suitable for a concise visual preview.

| Template | Desktop | Mobile | Motion traces |
| --- | --- | --- | --- |
| Editorial | [1440px](editorial-1440.png) | [390px](editorial-390.png) | [Desktop](editorial-1440-motion.json), [mobile](editorial-390-motion.json) |
| Showcase | [1440px](showcase-1440.png) | [390px](showcase-390.png) | [Desktop](showcase-1440-motion.json), [mobile](showcase-390-motion.json) |
| Clarity | [1440px](clarity-1440.png) | [390px](clarity-390.png) | [Desktop](clarity-1440-motion.json), [mobile](clarity-390-motion.json) |

[Wide-image Showcase gallery](showcase-wide-gallery.png) verifies a sufficiently wide approved image can lead the gallery without cropping its contents. Square and portrait sources keep paired frames instead. Editorial uses the menu fixture, Showcase the services/project fixture and Clarity the image-free neighborhood guide fixture. The broader existing matrix separately tests every template against menu, services, guide and travel fixtures.

Motion JSON records sampled intermediate computed transforms and clip paths during real animation frames; it is not a list of intended keyframes. It verifies lateral editorial text/reveal, finite image focus, and compact grid entrance treatments. Static PNGs verify the resulting composition, not animation quality on a physical device.

Executed using Node 24 and the existing production build:

```sh
node node_modules/@playwright/test/cli.js test tests/browser/website-choreography.spec.ts tests/browser/website-hero.spec.ts --output=test-results/website-final-20260927 --reporter=list
# 9 passed (32.2s)

node node_modules/@playwright/test/cli.js test tests/browser/website-motion.spec.ts --output=test-results/website-motion-20260927 --reporter=list
# 7 passed, 1 intentionally skipped (2.7m)
```

Both invocations use the isolated demo on port 3225 and stop that server on completion. The actual customer-site test is opt-in and was skipped. Paid model evaluation and physical iPhone verification are outside this evidence. See [the implementation report](../../website-design-update-2026-09-27.md) for source checks, the earlier eight-case design suite and remaining work.
