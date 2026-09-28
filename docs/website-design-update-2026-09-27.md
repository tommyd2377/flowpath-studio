# Website composition and Motion refinement — 27 September 2026

This pass changes the regular published website and its private design preview. It uses the installed Motion 13.2.0 runtime and existing React components; there is no new package or model request. Assistant information surfaces and voice orchestration are separate work.

## Content-aware recommendations

`lib/website-design-recommendation.ts` recommends one implemented template from semantic entity kinds, collection size and discovered image count. Offerings and dense collections favor Clarity; project-led content with potential imagery favors Showcase; longer stories and guides favor Editorial. A page-count fallback remains only when there is too little structured evidence. The rules contain no customer/domain names, prices or locations and do not interpret facts or identify images.

Website/HTML import passes its existing interpreted catalog into that recommendation. This does not make another AI call. Imported photos still need separate approval. `WebsiteDesignReview` identifies a differing recommendation while retaining the publisher's selected template, motion, typography, palette and first-view choice. Sites with legacy styling can select the actual registered template in review; previously their layout selector could leave `style.template` pointing to a different template. The preview now receives saved motion/style settings.

No existing draft or publication is rewritten. Review → Apply to draft → Publish remains unchanged. A richer model-generated design plan with section ordering and comparative design evaluations is still future work; this pass adds a safe typed recommendation rather than arbitrary generated markup.

## Visible website behavior

| Template | Composition | Motion |
| --- | --- | --- |
| Editorial | Illustrated stories receive their own wider composition. Three or more fully illustrated entries can use a larger lead frame with smaller companion images. Sparse and mixed-image content retain a simple reading flow. | Lateral reading rhythm, a restrained headline reveal, asymmetric image masks and fine section rules. |
| Showcase | A fully illustrated collection can use one bounded wide lead image above paired companions when its approved dimensions support that composition. Square/portrait images keep paired frames; a wide lead preserves the entire image. Existing bounded hero sizing remains in place. | A finite image-focus gesture works on desktop and mobile; this is separate from the existing optional desktop image depth. Text and image entrances use different treatments. |
| Clarity | Collections use compact responsive grids where appropriate; price/service rows retain comparable source wording. | Short spatial grid entrances and staggered directory links, with existing native disclosure feedback. |

All modes retain readable server HTML, native scrolling/anchors, keyboard focus cleanup, dynamically expanded content and immediate reduced-motion support. Off remains still. Mobile retains distinct finite transitions without continuous parallax. Images, captions, credits, example labels and record identity stay tied to approved content. No placeholders or fabricated images are added to fill a layout.

## Verification

Source-level checks passed: 26 template/recommendation/import tests, six shared website rendering tests, focused lint, and shared-package TypeScript `--noEmit`. Import lifecycle checks include private review, publication separation and Undo. The integration build passed after the final image refinements.

Browser checks passed:

- Four new choreography/composition scenarios and five existing hero scenarios: **9/9**. These ran after the final wide-image guard and cover three templates on desktop/mobile, image-free content, square/portrait images, wide lead images, price qualifiers and bounded hero sizing.
- Existing Motion suite: **7 passed, 1 intentionally skipped**. The four publisher cases exercise 24 content/template/viewport sequences. Additional cases cover Off/reduced motion and live preference changes, nested Studio scroll, dynamic collection expansion, fast scrolling and visibility cleanup. The skipped case is the opt-in read-only actual cake-shop site; it was not part of this isolated run.
- Existing website-design suite: **8/8** before the final wide-image refinement. It covers 320–1920px layouts, reduced preferences, draft/publish preservation, assistant return/scroll continuity, no IntersectionObserver, no JavaScript, missing/slow images and larger text. The final guard is separately covered by the nine-case run above.

Review [the saved screenshots and motion traces](screenshots/website-design-20260927/README.md). Raw artifacts remain under `test-results/website-final-20260927`, `test-results/website-motion-20260927` and `test-results/website-design-20260927`. The isolated server shut down after testing; no live customer publication or paid API call was made by this workstream.

The new browser cases use original synthetic illustrations and menu, service/portfolio and image-free guide publishers. They record actual intermediate transforms and clip paths, not only Motion imports or data attributes, at desktop and mobile widths. They also check composition geometry, overflow and reduced-motion cleanup. This is isolated Chromium verification, not physical iPhone or live model evaluation. No Wix/Squarespace design-quality superiority is claimed from automated tests.
