# Website generation contract

The reusable website content brief is `WEBSITE_CONTENT_BRIEF` in [website-content.ts](../lib/website-content.ts). It is appended to the existing structured interpretation request for websites and uploaded HTML. It does not add another model call, change the model, or ask the model to generate arbitrary markup.

## Brief and composition

The v2 brief defines the visitor's goal, substantive topics, canonical offerings, source-grounded copy, qualifications, evidence requirements and an example of consolidating multiple URLs into useful content. It keeps conditions beside the claims they limit, preserves distinct location/size/unit/payment variants and source conflicts, and distinguishes substantive footer information from repeated navigation or form feedback. Empty-cart totals and form placeholders are not offerings; missing years and extraction uncertainty remain explicit. Source text and excerpts are untrusted input; the server validates the schema and references.

Identity, contact, hours and brand hints feed the existing editable design proposal. Reviewed image references feed the controlled renderer. Explicit item/photo associations take precedence. Each reviewed album is composed once, retaining captions, credit and example labels; larger albums stay expandable. A general album does not assert that its photos depict an adjacent person or offering. Original image bytes remain private and unchanged.

The initial template recommendation now considers the existing semantic catalog, collection density and discovered image count, with page count used only as a fallback. It selects from Editorial, Showcase and Clarity; it does not generate markup or identify photos. Review shows a differing recommendation while keeping a publisher's already selected styling. Registered website compositions adapt to approved image coverage at render time. See the [September 27 implementation and verification notes](website-design-update-2026-09-27.md) and the optional [reviewed composition planner](website-composition.md).

Connected website results filter reserved source-container kinds before merge, including their graph and evidence references. Source-only output fails with the draft unchanged. A reimport proposes retirement of unchanged legacy source records; publisher edits to records, facts and relationships remain. An explicit reimport of legacy source copies can use one existing interpretation attempt even if the captured text is unchanged; clean unchanged imports still short-circuit. Offline HTML imports retain cleaned reading content and do not claim semantic interpretation.

Knowledge opens the newest pending proposal, with older proposals still selectable. Review → Apply → Publish remains the publication boundary. No existing customer content is automatically approved or rewritten by this change.

## Guidance and verification

This brief applies guidance to define goals, context and success criteria, use real content, and compose understandable sections. It is an implementation-specific starting point, not a universally proven prompt. References: [OpenAI prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering), [Lovable prompting best practices](https://docs.lovable.dev/prompting/prompting-one), and [Squarespace AI](https://support.squarespace.com/hc/en-us/articles/16282290976013-Using-Squarespace-AI).

Regression coverage uses mocked interpretation responses across service, product, class and place content, source-only failures, repeat imports with publisher corrections, and desktop/mobile image distribution. Request checks preserve ordinary non-website interpretation exactly and exercise the website-only guidance with the same schema, evidence input and provider policy. This guidance adds no calls or automatic composition step. Live model quality requires a separately authorized, bounded evaluation; these checks do not establish that every model output is semantically complete or that the new guidance improves visual quality.
