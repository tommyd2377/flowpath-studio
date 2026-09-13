# Website generation contract

The reusable website content brief is `WEBSITE_CONTENT_BRIEF` in [website-content.ts](../lib/website-content.ts). It is appended to the existing structured interpretation request for websites and uploaded HTML. It does not add another model call, change the model, or ask the model to generate arbitrary markup.

## Brief and composition

The brief defines the visitor's goal, substantive topics, canonical offerings, source-grounded copy, qualifications, evidence requirements and an example of consolidating multiple URLs into useful content. It explicitly separates business information from crawl records. Source text and excerpts are untrusted input; the server validates the schema and references.

Identity, contact, hours and brand hints feed the existing editable design proposal. Reviewed image references feed the controlled renderer. Explicit item/photo associations take precedence. Up to three groups of four general site photos are placed between content sections, retaining captions and example labels. The remaining album stays browsable. A general photo group does not assert that its photos depict the adjacent person or offering, and does not create another navigation item. Original image bytes remain private and unchanged.

Connected website results filter reserved source-container kinds before merge, including their graph and evidence references. Source-only output fails with the draft unchanged. A reimport proposes retirement of unchanged legacy source records; publisher edits to records, facts and relationships remain. An explicit reimport of legacy source copies can use one existing interpretation attempt even if the captured text is unchanged; clean unchanged imports still short-circuit. Offline HTML imports retain cleaned reading content and do not claim semantic interpretation.

Knowledge opens the newest pending proposal, with older proposals still selectable. Review → Apply → Publish remains the publication boundary. No existing customer content is automatically approved or rewritten by this change.

## Guidance and verification

This brief applies guidance to define goals, context and success criteria, use real content, and compose understandable sections. It is an implementation-specific starting point, not a universally proven prompt. References: [OpenAI prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering), [Lovable prompting best practices](https://docs.lovable.dev/prompting/prompting-one), and [Squarespace AI](https://support.squarespace.com/hc/en-us/articles/16282290976013-Using-Squarespace-AI).

Regression coverage uses mocked interpretation responses across service, product, class and place content, source-only failures, repeat imports with publisher corrections, and desktop/mobile image distribution. Live model quality requires a separately authorized, bounded evaluation; these checks do not establish that every model output is semantically complete.
