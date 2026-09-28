# Published website and assistant Motion refinement — September 27, 2026

This is an additive pass over the shared published-website renderer and the voice/chat information surface. It uses the installed free `motion/react` package (13.2.0). It introduces no publisher-specific behavior, dependency upgrade, paid component package, paid model request, customer publication or deployment.

## What changed

- Website FAQs, mobile navigation and overflow navigation retain native `details` semantics while opening and closing through measured, reversible height/opacity transitions. Repeated clicks reverse from the visible height. Escape, link selection and focus remain functional; closing content becomes inert immediately. Motion Off, reduced motion and assistant suspension settle pending transitions.
- “Explore all / Show fewer” changes the collection immediately and eases the surrounding height to fit. Existing item identities remain stable; animation delays do not grow with the size of a catalog.
- Navigation links gain restrained underline feedback. Text-link arrows and image wrappers respond to hover/focus, with small press feedback. Separate wrappers keep image interaction independent from the existing scroll-depth effect. Disclosure plus/minus marks use Motion SVG path animation.
- Assistant regions become opaque in 160 ms while their position finishes moving in 320 ms; grid reflow uses 380 ms and exits use 180 ms. Width changes no longer repeatedly start another full height animation. The surrounding card changes real dimensions without scaling its text or media.
- The independently scrolling information area declares its scroll coordinate system to Motion. Stable layout groups, region keys and opposite history directions preserve continuity when answers are enriched or revisited.
- Status labels crossfade in place, with one immediate accessible announcement. Send and Stop overlap briefly during their transition instead of waiting for the previous glyph to leave. Stop retains its immediate handler and accessible label.
- The changed assistant primitives subscribe to reduced-motion changes during the current visit. Their owned animation values stop without remounting media; nested registered components retain their existing automatic reduced-motion protection. Shared height springs now honor the requested visual duration instead of supplying a competing ignored duration.

The existing template-specific hero entrances, section reveals, bounded staggering, image masks and limited scroll depth are preserved and regression-tested. They are not newly created effects in this pass. The Voice/Chat sliding highlight was implemented in the preceding pass.

## Design and performance boundaries

Motion should make an interaction easier to follow. Native document scrolling stays native; paragraphs do not drift with parallax; content is usable without waiting for decoration. The website's server HTML and native disclosures remain useful without JavaScript. Heavy blur, looping decorative effects, page-wide scroll interception and a second animation library are unnecessary here.

Height and width animation do perform layout work. The acceptance tests therefore sample actual intermediate geometry, opacity and display receipts rather than claiming all motion runs without main-thread work. Model latency is a separate problem: this pass removes visual delay and improves continuity, but does not claim to make provider inference faster.

## Documentation reviewed

The implementation follows Motion's [React overview](https://motion.dev/docs/react), [animation](https://motion.dev/docs/react-animation), [layout animation](https://motion.dev/docs/react-layout-animations), [scroll animation](https://motion.dev/docs/react-scroll-animations), [SVG animation](https://motion.dev/docs/react-svg-animation) and [transition](https://motion.dev/docs/react-transitions) documentation, with the [presence](https://motion.dev/docs/react-animate-presence), [gesture](https://motion.dev/docs/react-gestures) and [accessibility](https://motion.dev/docs/react-accessibility) guidance. APIs were checked against the installed version; newer or paid features were not added just because they appear in current documentation.

## Verification

The final production build, whole-project lint, all **53 presentation tests**, independent packed-package verification and `git diff --check` passed. Browser-runner coverage also confirms that all 31 spec files belong to exactly one isolated group.

The final isolated browser runs passed **40 cases**, using synthetic publications and mocked/demo providers:

| Coverage | Result |
| --- | --- |
| New website disclosures, collection expansion, rapid reversal and live reduced-motion changes | 4 passed |
| New assistant intermediate frames, mobile/desktop history, scroll projection, media continuity and live preference changes | 4 passed |
| Existing picker, status, cancellation and display handling | 17 passed |
| Website choreography across menu/service/guide/travel fixtures and all three templates | 7 passed; 1 optional actual-site case skipped |
| Website responsive design, Studio preview, assistant return, slow/failed images and no-JavaScript behavior | 8 passed |

The optional actual-site test requires a separately configured publication. A read-only in-app browser spot check used the real local cake-shop publication instead: Showcase/Subtle was active, the desktop had no horizontal overflow, keyboard navigation opened/closed the menu, and its cake collection expanded from **6 to 26** items and returned to 6. At 393 px, the menu settled without a stuck inline height or horizontal overflow, and Escape restored focus. This server explicitly used demo AI; no model submission or publication occurred. Pointer interactions were covered by the isolated browser suite, not claimed from the in-app keyboard spot check.

In one instrumented synthetic answer transition, content became fully readable **173 ms after arrival at 1440 px** and **177 ms at 393 px**. The full display settled at **440 ms** and **477 ms**, respectively. Both runs preserved the media DOM node. These are client display timings after data arrives, not network/model response times or production-device benchmarks. Intermediate-frame tests also verify that display receipts wait for the real transition.

Testing caught a genuine interruption bug: turning on reduced motion during collection expansion could leave a fixed inline height. Cleanup now finishes after disabling motion, and deferred cleanup cannot cancel a newer reversal. A regression test exercises this sequence.

The broader `npm run check` is **not fully green**. Its server run had 950 of 953 passing tests: two recording-event expectations predated the prior pass's new transport telemetry; those expectations were updated and the complete **16-test recorder suite passed**. The remaining failure compares Live runtime source byte-for-byte with the separate `../flowpath` checkout (`tests/gpt-live.test.ts`, first mismatch `protocol.ts`). This pass did not modify that runtime or the sibling repository. The parity assertion remains intact and requires separate cross-repository reconciliation. The successful production build and package/rendering checks above were run independently afterward.

## Evidence and closeout

- [Desktop assistant result](screenshots/motion-system-2026-09-27/assistant-1440.png) and [mobile result](screenshots/motion-system-2026-09-27/assistant-393.png).
- [Collection expansion, contraction and reversal recording](screenshots/motion-system-2026-09-27/website-collection-motion.webm).
- [Measured display timings](screenshots/motion-system-2026-09-27/measurements.json), [desktop intermediate frames](screenshots/motion-system-2026-09-27/assistant-1440-frames.json) and [mobile intermediate frames](screenshots/motion-system-2026-09-27/assistant-393-frames.json).
- [Actual local cake collection](screenshots/motion-system-2026-09-27/published-cake-collection.png).
- Detailed browser artifacts are under `test-results/platform/motion-system-new-final`, `motion-system-speed`, `motion-system-website` and `motion-system-design`.

No paid requests were made in this pass. The earlier daily accounting remains **$2.946261 of $5**, including its existing unknown-use reservation. Local test servers and the temporary in-app test tab were shut down after verification. No code was committed, pushed or deployed, and no customer draft or publication changed.

Remaining work: physical iPhone speech/interruption verification, the separately tracked complex model-response latency, and cross-repository runtime parity. Other legacy components retain their existing reduced-motion protection; this pass does not claim to migrate every legacy animation to live preference updates. Publisher acceptance of the visual treatment remains a human review step.
