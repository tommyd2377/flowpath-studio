# Product philosophy and direction

These are working product principles and priorities. They guide implementation; they are not a claim that every capability below is already shipped. See the [README](../README.md) and [architecture](architecture.md) for current behavior.

## The central principle

**Publishers supply knowledge, capabilities and identity. The platform determines how to structure and surface them so each visitor gets the most intuitive interface for what they are currently trying to accomplish.**

Build a general-purpose, AI-native website publishing platform. A publisher should get standalone value without other publishers needing to join. The visitor should not have to understand generative UI, speak aloud, or work through a mandatory conversational wizard.

The useful unit of interaction is a cognitive operation: discover, understand, narrow, compare, decide or act. Books, classes, hardware, restaurants and other businesses should reuse this machinery. Prefer decision-rich situations where a knowledgeable employee would normally ask a few questions before recommending something; a simple menu or list should remain simple when it already solves the visitor's problem.

## Knowledge comes before presentation

Normalize source material into reusable semantic concepts: entities, offerings, collections, people, places, events, attributes, relationships, source evidence and explicit actions, with room for domain-specific fields. PDFs, documents, sites, spreadsheets, catalogs and APIs are input sources, not the structure visitors must inherit.

Ingestion and publisher correction are core product value. Show publishers what was discovered and which jobs visitors may be trying to accomplish. Let publishers correct interpretations without learning a schema or maintaining a page-by-page CMS. Treat corrections as durable decisions during later reimports.

Media follows the same principle. An approved photo can illustrate an item, appear in a comparison or belong to several albums. Keep the distinction between an actual depiction and an illustrative example visible. Use captions, supplied metadata and publisher context to establish meaning; resemblance alone does not establish exact identity.

## Knowledge and capabilities have different authority

A PDF may describe an offering, policy or menu. It cannot establish current inventory, a reservation slot or a successful checkout. Live state and consequential actions require explicit integrations and appropriate validation. The model must never invent capabilities.

Keep source provenance and proposed interpretation distinguishable from published facts. Uncertainty should produce useful qualifications or a narrower supported view. Application-specific editorial policies belong to the application; the platform's validation boundary protects source references, supported actions and canonical state.

## Shared visual and interaction language

OpenUI is the rendering grammar. Our semantic React components and design system define the visual and interaction identity. Models compose controlled components and variants rather than arbitrary HTML or CSS. Keep OpenUI Gateway optional; the implemented runtime generates and renders locally through direct model integrations when enabled.

The platform library should grow through real publisher needs, including first-party applications. Promote a component when it:

- Supports a reusable cognitive operation and works across structurally different content.
- Has bounded props, validated references, accessible controls and useful fallbacks.
- Integrates with shared interaction state and respects manual visitor input.
- Has useful behavior without a particular model, backend or vertical-specific data shape.

Motion is part of that shared language. The model may request semantic focus, reveal, replace, expand or workspace changes; the runtime owns their precise animations. Current larger transitions generally use 400–620 ms with graceful interruption, stable content geometry and reduced-motion support. Keep small control feedback responsive. Different sites should express their own identity while retaining a recognizable interaction feel.

## Learn from FlowPath without copying its product

The separate FlowPath/news application is a reference implementation and an independent test publisher. It can customize its experience outside Studio. Its Boards, Move Map, news evidence rules and other domain logic do not become platform requirements merely because they work there.

Transfer mechanisms only when they generalize: orchestration, state handling, validation, evaluators, uncertainty reduction, reliability and honest search behavior. First-party apps should expose missing abstractions and contribute reusable components, not dictate every publisher's product.

## Publisher and visitor experience

Make upload-to-preview fast and understandable. An initial experience may show highlights, featured material, supported calls to action and tone before asking what a visitor needs. It remains skippable and non-blocking.

Text, buttons, photos and optional voice are complementary inputs and outputs. Preserve the useful current view when generation fails. Manual navigation should win over a late model response. A site should remain useful when AI usage is exhausted.

Do not overfit to the first accessible customer. A tequila company is a useful pilot opportunity, but test books, classes/experiences and specialty retail early to expose false abstractions. The existing synthetic catalogs are initial structural checks, not evidence of market validation.

## Reliability, economics and acquisition

Generated output passes through generation, schema/reference validation, rejection or bounded recovery, and controlled rendering. Malformed output never silently becomes canonical state. Make failures observable, preserve useful fallbacks, and test against representative source material. The present implementation uses bounded attempts rather than automatic paid retry loops.

Instrument the complete intended funnel: Studio visit, upload, successful interpretation, preview, publisher approval, publication, real visitor interaction, meaningful outcome, paid conversion and second-month retention. The current bounded event window is an operational foundation, not the completed funnel. A click or photo opening is an observation, not proof of a meaningful business outcome.

The selected launch offer is **$29/month or $300/year per published site**, including $10 of retail AI usage each month. Additional usage uses prepaid $10, $25 or $50 credits with optional capped replenishment. Purchased credit rolls over; the included allowance resets monthly. The initial configurable retail rate is three times supported provider token cost. Stripe is the default for publisher subscriptions and, through a separate future Connect integration, visitor-to-publisher payments. The offer has a local billing preview and Stripe test integration; production activation, real usage reconciliation and commercial validation remain separate work. Existing daily attempt limits remain additional controls. See [the launch offer](launch-offer.md).

Design for self-serve acquisition and minimal founder intervention: an understandable demo, fast interpretation, easy corrections and clear value before payment. Paid or brand advertising may become a channel later; it is not currently implemented or validated.

More publishers can improve shared schemas, components, transitions, ingestion and evaluations. Those are learning effects. Do not claim network effects or make one publisher's value depend on others joining.

## Current priority order

Favor ingestion quality, semantic modeling and publisher correction; reusable components and controlled motion; multimodal visitor experience; validation/reliability; cost controls and instrumentation. These matter more than speculative component breadth or elaborate vertical integrations.

For each change, ask which publisher or visitor job improves, what establishes the underlying meaning, which state is authoritative, whether another kind of publisher can use it, and how it behaves when a model or integration fails. Record concrete implementation tradeoffs in the relevant feature guide and verify them with the smallest meaningful checks.
