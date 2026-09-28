# September 27: website quality, mobile speed and an embedded FlowPath offer

Status: source/documentation research completed by three parallel agents and reconciled by the coordinator. No application behavior, published content, dependencies or production configuration changed in this pass. This is not a fresh visual acceptance test of the user's current page, a live-model benchmark, or a commitment to implement every option below.

The [master backlog](project-todo.md) retains notes 1–14 and adds **15: a package/plugin that brings voice input and audio/visual output to an existing website**. The existing publishing product remains the baseline; an embedded offer is a new decision, not an assumed pivot.

## What currently creates the website

There is no single runtime prompt that designs an arbitrary Wix/Squarespace-style website. The current pipeline combines custom content prompts with a controlled shared renderer:

| Stage | Actual responsibility | Authoritative source |
| --- | --- | --- |
| Semantic extraction | Turn supplied evidence into entities, offerings, prices, topics, relationships and collections; keep facts independent of presentation. | [`ingestion.ts`](../lib/ingestion.ts), instructions beginning around line 284 |
| Website content brief | Organize canonical topics and useful offerings; avoid duplicated crawl containers and repeated source material. Photos remain the controlled renderer's responsibility. | [`WEBSITE_CONTENT_BRIEF`](../lib/website-content.ts), around line 60 |
| Owner chat editing | Propose requested draft changes from the current draft, selected text documents, available logo IDs and recent messages. Return a validated patch for review. | [`ai-editor.ts`](../lib/ai-editor.ts), schema at line 9 and instructions at line 21 |
| Initial imported design | Choose compact/Clarity when more than eight pages were imported, otherwise Editorial; start with parchment and extracted identity/copy/accent. This is a small code rule, not an AI design prompt. | [`designWebsite`](../lib/website-import.ts), line 65 |
| Website rendering | Compose approved semantic content into Editorial, Showcase or Clarity with shared React components, CSS and Motion. | [`PublishedWebsite.tsx`](../packages/platform-ui/src/PublishedWebsite.tsx), [`website-presentation.ts`](../lib/website-presentation.ts), [`site-design.ts`](../packages/platform-ui/src/site-design.ts) |

The owner-editing response cannot currently choose templates or motion: its schema permits name, headline, description, hours, contact, accent, logo and sections. That path uses `gpt-5.6-luna` with low reasoning in the inspected checkout. Increasing its reasoning alone would not give it additional design controls.

These are **project-authored, application-specific prompts stored in source**, not imported Wix/Squarespace prompt packages. The audit cannot attribute each literal to this particular assistant. The [prompt inventory](model-prompt-inventory.md) is the reading map; current source remains authoritative.

### Research evidence and its limits

Prior project documentation records Squarespace Paloma/Waverly inspiration and design principles in [templates and source lifecycle](templates-and-source-lifecycle.md), OpenAI/Lovable/Squarespace prompting references in [website generation](website-generation.md), and official Motion documentation in [website design and motion](website-design-and-motion.md). There are historical screenshots, browser checks and mocked ingestion tests. They establish implementation work and specific behavior checks, not a broad demonstrated design-quality advantage over Wix or Squarespace.

Current [OpenAI prompting guidance](https://developers.openai.com/api/docs/guides/prompt-engineering) recommends code-managed prompts, typed dynamic inputs and representative evaluations. [Lovable's guidance](https://docs.lovable.dev/prompting/prompting-one) emphasizes defining the visitor goal, designing with real content and iterating by component. Both support improving our process; neither proves a generic prompt pack is superior here.

## Why Motion can feel repetitive

Source inspection confirms several effects in [`website-motion.ts`](../packages/platform-ui/src/website-motion.ts): coordinated hero/section entrances, capped stagger, image-frame reveals, bounded image depth and disclosure transitions. [`PublishedWebsite.tsx`](../packages/platform-ui/src/PublishedWebsite.tsx) also contains spring-based arrow and hover/tap feedback.

However, most sections share a fade-and-rise vocabulary. Every template defaults to Subtle. Image depth requires content width above 760 pixels, applies to at most two frames, and is absent from Clarity. Mobile shortens entrance travel and removes image depth. Expressive Editorial's sticky headings require wider layouts. Off/reduced-motion and obscured-site states appropriately suppress effects. These verified constraints plausibly explain the impression of one animation; the active settings and rendered motion on today's user page were not inspected during this audit.

Recommended next design pass:

1. Capture the current publication on desktop and physical iPhone, verifying template, motion setting and built-package version. Compare actual intermediate frames, not merely the presence of Motion imports.
2. Give existing templates different composition and choreography: editorial image reveals and reading rhythm; image-led Showcase transitions; crisp Clarity disclosures and grid changes. Preserve native scrolling, readable content and reduced motion.
3. Add a **constrained design-planning stage before publication**. Supply visitor purpose, content density, approved images/aspect ratios and available section variants; return a reviewed selection/order of supported components and design tokens. Keep factual extraction and image identity separate. A design plan cannot select a component that has not been implemented.
4. Compare current and proposed output using restaurant, services, portfolio and text-heavy fixtures at desktop/mobile sizes. Score factual completeness, finding information, typography, image balance, purposeful motion, accessibility and page performance. Include human review; passing assertions alone does not establish taste.

A pre-publication design stage would add bounded generation cost to publishing, not require a new design-model call for every visitor. The quality benefit is an expectation to evaluate, not a measured result.

### Useful tools and component sources

| Source | Practical fit | Decision |
| --- | --- | --- |
| [Motion AI Kit](https://motion.dev/docs/ai-kit-install) | Official MIT installer/skill and free documentation/example-metadata search. Premium source and additional tools require Motion+. | Useful development aid; public documentation is accessible now. No access blocker or paid purchase is needed for the proposed basic choreography. Nothing installed. |
| [shadcn/ui](https://ui.shadcn.com/docs) | Accessible component source and registry distribution. | Selectively adapt useful primitives to existing tokens/components; do not replace the renderer merely to adopt a library. |
| [Magic UI](https://magicui.design/docs/components/blur-fade) | Reference patterns for selected animated components; the [free repository is MIT](https://github.com/magicuidesign/magicui/blob/main/LICENSE.md). | Review specific patterns and dependencies. Another fade wrapper alone would repeat the current limitation; premium templates are separate. |
| [Lovable prompting](https://docs.lovable.dev/prompting/prompting-one) | Concrete, component-oriented design briefs. | Adapt the method and evaluate it against our content/renderer contracts; no migration or subscription proposed. |

v0 was also considered as a design-system reference, but direct documentation retrieval was incomplete. No v0 integration or comparative quality claim is established. There is no evidence that replacing Motion/OpenUI or buying another animation runtime is the necessary next step.

## Speed and mobile: next engineering candidates

The latest [complex-request QA](qa-complex-speed-2026-09-26.md) observed a menu request with zero model calls still taking 3.756 seconds, Home 1.902 seconds and estimate recall 2.938 seconds. Filter-plus-subtotal showed the first result at 5.209 seconds and completed at 11.799 seconds across three provider calls. These are individual observations; an older profiled build's breakdown must not be attributed to this build.

| Priority | Proposed change | Expected benefit and acceptance |
| --- | --- | --- |
| 1 | Use a narrow validation/context path for `ack` and `scene`; avoid full catalog preparation and unnecessary viewport reads when an operation does not need them. Inspect [`tasks/route.ts`](../app/api/visitor/[slug]/tasks/route.ts), [`visitor-task-store.ts`](../lib/visitor-task-store.ts) and [`visitor-task-context.ts`](../lib/visitor-task-context.ts). | Fewer storage round trips with no added model expense. Keep fresh publication checks, conditional writes and current-generation guards. Measure before/after; test republishing, deletion and concurrent manual interaction. |
| 2 | Profile the 560ms resettable surface-settling timer and subsequent geometry/opacity/ACK persistence. Use actual Motion completion where reliable while retaining a short stability check. Inspect [`InformationSurface.tsx`](../packages/platform-ui/src/InformationSurface.tsx) and [`VisitorTasks.tsx`](../components/VisitorTasks.tsx). | Potentially remove redundant waiting between readable content and confirmed delivery. Keep separate timestamps for readable, settled and persisted; do not weaken truthful visibility. Test image loads, rotation, keyboards, reduced motion, cancellation and reverse history. |
| 3 | Let a bounded validated plan perform query → published-price summary using exact server result handles, avoiding a model round solely to retranscribe returned IDs. Inspect [`visitor-task-runner.ts`](../lib/visitor-task-runner.ts). | Could reduce latency and token cost. Higher engineering risk; begin with one small chain, preserve exact currency/unit/qualifiers and cancellation. No speculative paid calls or indiscriminate parallel tools. |

These follow the direction of [OpenAI latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization) and [Firestore's dependency-aware asynchronous operation guidance](https://firebase.google.com/docs/firestore/best-practices). Savings are unmeasured. Conditional writes, progressive output and several read-overlap optimizations already exist; do not reimplement them or report them as new.

Physical iPhone acceptance should cover: interrupting the introduction with a full request; menu → filter/sort → subtotal; photos → detail → Back/Forward/Home; voice/chat switching with the keyboard and rotation; and restart/recall after backgrounding. Backgrounding intentionally stops the current session. Previous mocked checks do not verify actual microphone behavior. The user's first September 27 phone attempt subsequently exposed failures; see the bounded evidence below.

### Initial phone-test triage, approximately 11:16–11:24 a.m. EDT

The user reported slow responses and multiple successive requests appearing to execute together. They did not see a specific error banner and had not closed the phone page. Server metadata in `/tmp/flowpath-studio-wifi-https-20260927.log` is available; the phone's browser-only event buffer and speech transcripts were not captured centrally. These server traces align with the test window, but the log alone does not identify the physical device.

- At 11:20:07, trace `8cc0a406-7b54-4a67-a421-fc7928bafab4` started. Navigation later failed schema validation at `batch.operations.1`; backend failure was recorded after 7.124 seconds.
- At 11:20:33, trace `c0d24cd6-1b19-4416-a162-f020eadc5a8a` started. Navigation failed with reason `reference`; backend failure was recorded after 6.164 seconds. The rejected reference itself is absent from these metadata-only events.
- At 11:22:55, trace `1bd29e1e-4aa5-4bb9-8bf7-c00a3879295c` started. Navigation succeeded, then backend completion failed at 9.903 seconds without a classified reason. This does not establish that the whole user task completed.
- There were also four session-control HTTP 400 responses and five task HTTP 409 responses after the setup checks. Status codes alone cannot determine their causes. The initial availability 400, foreign-origin 403 and recording-route 404 were the coordinator's intentional nonpaid setup checks, not user failures.
- Public availability checked during triage returned live voice enabled, **five voice tasks and 50 chat messages remaining**. No 429 appeared in the inspected server requests. This rules out an exhausted daily allowance at that check, not every possible session/network issue.
- Several server control-ready stages completed in about 0.8–1.6 seconds after their server start event. This is not microphone-to-ready or end-to-end perceived startup latency. A long HTTP session request includes the streaming connection lifetime and must not be reported as startup delay.

The follow-up code review found cancellation after a fresh accepted delegation in [`gpt-live/runtime.ts`](../lib/gpt-live/runtime.ts), with revision-fenced nonblocking navigation in [`use-visitor-session.ts`](../lib/use-visitor-session.ts). The gap is earlier: ordinary substantive speech relies on Live delegating; only explicit cancellation/page navigation/narrow redirection hints interrupt immediately. Recovery defers while the backend is busy, and pending speech can accumulate across gaps of up to eight seconds. See [`visitor-voice-input.ts`](../lib/visitor-voice-input.ts) and [`visitor-realtime-control.ts`](../lib/visitor-realtime-control.ts), especially recovery and user-fragment handling. This could explain the reported bundling; it is not proof of this incident's exact cause.

Smallest next verification: an offline regression for request A → different request B → correction C while delegation is delayed, preserving additive constraints, status questions and ordinary conversation. Add content-free handoff timing and accepted/deferred/replaced reasons, plus explicit classification for display acknowledgment/completion exceptions currently lacking a reason. Then use a narrowly paired phone recorder for one short real-speech test. Do not cancel every task merely because speech starts; multi-sentence requests and “also…” refinements must continue to work. No behavioral fix is claimed in this research pass.

### Phone recording gap

The client recorder allows loopback hosts only, and the server guard additionally requires HTTP with loopback Host/Origin. The HTTPS LAN page therefore cannot produce full transcript recordings today. Metadata diagnostics and screenshots cannot reconstruct missing speech.

Proposed feature: development-only pairing initiated on the Mac, with an expiring one-session grant bound to the exact phone origin and publisher. Permit the phone to append/attach/stop only that recording; keep listing, reading, exporting and deleting recordings local. Retain redaction and size/time bounds. Do not simply allow every LAN host. This requires a separate scoped implementation; access controls were not changed for the current setup.

## Note 15: add FlowPath to an existing website

Recommended product direction to discuss: keep Studio as the common knowledge/media/capability backend, then offer either a hosted FlowPath website or an assistant on the customer's existing site. Reuse the same semantic components and task machinery.

| Architecture | Benefit | Cost / limitation |
| --- | --- | --- |
| **Small loader + hosted iframe overlay — first prototype** | Centrally maintained experience; isolated styles; most current API calls remain same-origin inside the frame. | Parent visibility, mobile geometry, microphone delegation and storage need deliberate integration. |
| Native JavaScript/Web Component, optionally React SDK | Deeper integration with host components. | More CSS/dependency compatibility work and a new narrowly authorized cross-origin visitor transport. Shadow DOM is not a security boundary. |
| Platform plugins/adapters | Easier installation and access to supported native data/actions. | Platform-specific maintenance; should distribute the same core experience rather than fork it. |

[`platform-ui`](../packages/platform-ui/package.json) is a real reusable React component/contract foundation. It is not a drop-in voice SDK: assistant orchestration still lives in application components with relative `/api/visitor` calls and [`assertSameOrigin`](../lib/firebase/session.ts). A hosted iframe can keep these same-origin calls; do not relax that guard globally.

[Wix embedded scripts](https://dev.wix.com/docs/build-apps/develop-your-app/extensions/site-extensions/embedded-scripts/about-embedded-scripts) are a relevant integration route; [Wix site widgets](https://dev.wix.com/docs/overview/extensions-framework/site-extensions/site-widgets) have container/layout considerations. [WordPress plugins can enqueue a loader](https://developer.wordpress.org/plugins/javascript/enqueuing/). Squarespace code injection is a candidate, but plan eligibility and actual published-page support must be checked for the chosen pilot; no platform-specific installation or microphone test was performed.

The first prototype needs:

- Registered publication/host scope, short-lived guest access, quotas and server-side reference checks; no provider credentials or reliance on Studio login cookies.
- Exact-origin, schema-checked parent/frame messages for opening, geometry, approved page context and visibility. The parent must confirm the overlay is actually visible before a display receipt counts.
- Explicit microphone delegation and real phone checks. Browsers require secure contexts and user permission; a cross-origin frame also depends on its parent's permissions policy. Provide typing and a standalone-open fallback when embedding cannot support voice. [Browser requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
- Focus/scroll restoration, lazy loading, native host browsing, and no paid model call on ordinary page load. Basic anonymous use should not depend on third-party cookies.
- Reviewed content freshness. Native cart, inventory, booking and ordering need explicit authorized adapters. An assistant estimate is not the merchant's cart; generic DOM clicking is not a substitute.

Bounded validation: one controllable custom website plus one chosen platform, two contrasting synthetic publishers, and launcher → voice/chat → rich grid → filter/compare → history → close/return. Keep checkout and marketplace distribution out of the first prototype. Start with mocked transport/integration checks; live model checks require an approved host/task/budget.

GTM hypothesis: owners who already like their website may accept an added conversational visual interface more readily than a migration. Agencies maintaining such sites may become a distribution channel. This is unvalidated; measure installation effort, publisher activation and successful visitor tasks before claiming lower acquisition cost or a larger market.

## Recommended sequencing and decisions

1. Finish physical-phone acceptance and instrument any missing timing evidence. Implement scoped recording pairing when approved so phone failures are diagnosable.
2. Prioritize narrow acknowledgment/preparation latency work; refine template composition/Motion in a separate bounded change, each with recorded before/after evidence.
3. Decide whether note 15 is an additive offer and select the first host platform before building its prototype. Recommended default: additive, hosted overlay, reviewed read-only discovery first.

Business setup notes 1–3, bespoke capability support/ownership and the project estimator remain separate decisions. This research does not resolve them or replace the existing GTM discussion.

## Current local test environment

At this pass's close, the approved temporary HTTPS app is running at `https://192.168.1.250:3220`; the public-certificate setup page is `http://192.168.1.250:3221/`. Certificate files are temporary and expire after seven days; private keys are not served or stored in the repository. No trust settings were changed on the user's devices. Only the process's nonsecret app origin was set for the LAN URL.

Verified: published page 200, live availability endpoint 200, invalid same-origin request rejected by schema, foreign-origin request 403, public certificate downloadable, private-key path 404 and LAN recording routes unavailable. The coordinator and research agents triggered no paid model calls in this pass; the user subsequently tested voice manually. That attempt is not accepted as passing and is described above. Servers remain running as requested.


## Authorized implementation follow-through

The subsequent approved coding pass implemented the first latency/settlement work, bounded fresh-request handoff, an opt-in phone recorder and distinct website template composition/Motion. See [September 27 implementation and QA](qa-mobile-speed-design-2026-09-27.md) for that pass. Statements above about unavailable LAN recording and the running HTTPS server describe the earlier research/setup snapshot. The paired phone path now exists, but actual iPhone speech acceptance remains pending. The later [prompt/round pass](qa-context-rounds-speed-2026-09-27.md) implements lossless prompt sharing and combined query/comparison, with variable live latency still unresolved. Richer design planning, broader query/calculation fusion and note 15's overlay remain follow-ups; research is not completion.

## Note 15 follow-up: feasibility and a paid Studio-managed service

The recommended initial offer is additive: **publish a FlowPath website, or add the same assistant to an existing website**. Both use one reviewed knowledge/media publication, one task registry and the same Studio controls. This is a product recommendation, not a built or deployed embedding feature.

The publisher workflow would be: import their domain and documents → review/correct → choose appearance and permitted capabilities → register an installation domain → install a small snippet → publish assistant updates through Studio. The host page loads a small launcher; opening it loads the centrally hosted voice/chat experience and its rich information surface. The customer keeps their existing website. Loading the ordinary page should not start a paid model session.

The shared `platform-ui` package and visitor task system are reusable today. The visitor shell, session transport and display receipts are still tied to the host application, so packaging this requires an explicit embed route and parent/frame contract. It is not merely exporting `SiteExperience` or adding an iframe tag. Keep Studio/editor routes non-embeddable and preserve existing same-origin checks for assistant API requests inside the hosted frame.

First prototype scope: published-content questions, menu/service discovery, filter/sort, comparison, approved photos, estimates and whole-state history inside the assistant. Opening, closing and returning must preserve the host page's focus and scroll position. Native cart changes, bookings and other consequential actions require separate platform adapters and authorization; do not infer them from imported documents or automate arbitrary DOM controls.

Current platform documentation supports a practical installation path: [Squarespace code injection](https://support.squarespace.com/hc/en-us/articles/205815908-Customize-parts-of-your-site-with-code-injection) supports scripts on eligible plans, while [Wix embedded scripts](https://dev.wix.com/docs/build-apps/develop-your-app/extensions/site-extensions/embedded-scripts/about-embedded-scripts) support app-installed page integration. This does not verify our voice UI on either platform. Cross-origin microphone access needs HTTPS, visitor permission and parent permission delegation; see [getUserMedia requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia). Parent/frame messages need exact-origin validation and a bounded schema; see [postMessage guidance](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage). Physical-phone testing remains part of acceptance.

Commercially, Studio can remain the subscription product: content management, hosting, voice/chat processing, capability configuration, usage visibility, support and ongoing updates are continuing services. A per-site subscription with an included usage allowance and explicit spend controls is a reasonable model to validate; no specific price or margin is established. Existing test billing is not live billing activation.

Keeping the backend proprietary is compatible with a public installation snippet. Browser-delivered code is inspectable; a copied launcher should not grant access to another publisher's configuration or provider credentials. Domain restrictions help control installation but are not authentication by themselves: guest sessions, server-side quotas and abuse controls still matter. Do not assume a competitor needs a particular length of time to copy the visible experience. Reliable ingestion, correction workflows, cross-domain task quality, integrations, performance and distribution are more durable advantages to develop.

An open integration SDK could be considered later without making the hosted backend public. There is no need to decide that licensing/distribution question before testing the proprietary hosted offer. Validate one simple external site and one chosen website platform first, using contrasting synthetic publishers. Measure installation effort, successful visitor tasks, page-performance impact and owner willingness to pay before treating this as the main growth strategy.
