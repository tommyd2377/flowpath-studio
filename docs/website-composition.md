# Reviewed website composition

Studio Branding now offers **Suggest layout**, a deterministic local proposal requiring no model or API credit. **Suggest with AI** appears only when the existing connected editor is enabled. Both use the same bounded, validated contract and leave the saved draft unchanged until the publisher applies the proposal and selects **Save draft**. Publish remains separate. Changing the draft or leaving Branding cancels a pending UI request; an old response cannot replace the newer draft.

The planner arranges approved content rather than rewriting it. It can order every canonical website section, choose short host-approved navigation labels, select one registered section/contact/assistant action, and select an explicitly reviewed opening photograph. Full section headings, records, qualifications, prices, credits and illustrative labels remain intact. The existing runtime still owns layouts, CSS, motion, accessibility and action routing. Saved template, palette, typography, spacing, motion and opening choices are preserved exactly; without a saved style, the local proposal chooses an existing template.

## Authority and lifecycle

- `packages/platform-ui/src/website-composition.ts` defines the strict portable schema; its package subpath is `@thevoice/platform-ui/website-composition`.
- `lib/website-composition.ts` builds an approved manifest, proposes a local plan and validates every section, navigation label, action and hero reference. An exact immutable knowledge/media/collection revision tuple and compact content fingerprint bind each proposal to its reviewed content. The fingerprint is a change detector, not authorization.
- `lib/website-composition-provider.ts` makes at most one optional model request per explicit request. The host supplies the snapshot binding; the model cannot choose it. The model sees bounded representative text with omission counts, never the full imports, source provenance or original uploads.
- `app/api/sites/[siteId]/website-composition/route.ts` authenticates the workspace owner and checks the draft revision before and after generation. It returns a proposal without persistence.
- The site save/apply route validates newly supplied plans against the owner's current immutable content. Ordinary content edits can leave a stale saved plan; preview and public rendering then use the useful default arrangement. Publishing omits stale plans and all private review notes.
- `WebsiteSurface` applies plans only to the canonical `websiteSections` projection. Videos and paged v2 collection sections retain their existing position and pagination after those sections. A v2 collection suppresses superseded legacy catalog content consistently in preview, planning and publication.

Plans retain **every section exactly once**, up to 64 sections. Above that planning limit the complete ordinary website remains available and the proposal fails explicitly. Album membership alone does not authorize a hero; reviewed site associations or opening selections do. Logos are excluded. Selection from dimensions and labels does not establish photographic quality or identity; visual crop review is still needed.

## Model and resource limits

The optional model path reuses the existing Studio model/reasoning/service-tier policy, owner daily limits, cooldown and Stripe-test spending guard. Demo mode cannot make a paid request. Context is capped at 64,000 bytes, the complete request at 96,000 bytes, response transport at 256,000 bytes and parsed text at 48,000 characters, with the existing 90-second timeout and output-token limit. There are no automatic retries. Distinct explicit HTTP requests count as distinct attempts; cancellation after submission cannot promise provider credit recovery. Measured token usage for this planner is not yet recorded as a platform event.

## Source fidelity and image changes

Website offerings now preserve explicitly supported CAD, AUD, USD, GBP and EUR evidence. Unqualified `$` and conflicting or unsupported markers stay literal text with review notes, so they cannot become numeric price calculations until corrected. Long normalized HTML text is chunked without dropping tails; documents requiring too many blocks are compacted without text omission or fail explicitly at the schema capacity.

Website gallery/project cards and story imagery use the existing display rendition with lazy loading. Heroes remain eager; logos and assistant cards retain thumbnail behavior. No responsive `srcset` or additional variants were introduced. Display renditions remain capped at a 2000-pixel longest edge: at DPR2 this supports at most 1000 CSS pixels on that edge before crop or motion requirements; small originals can support less.

## Evaluation boundaries

The local regression and browser evaluations use synthetic CSV, saved HTML, generated text PDF and synthetic images through actual parser/import/review routes, plus explicitly curated representative catalog fixtures. They are not customer-source evaluations and do not establish live model art direction, OCR quality or production readiness. No paid model calls, cloud resource changes or deployment are part of this verification.

The initial research package contains reusable content-brief, composition and rendered-critique prompts and a hard factual-gate/visual-scoring rubric. This implementation starts with the composition contract; screenshot-driven model critique, responsive image variants, richer scanned-document extraction and broader free-form structuring remain separate future work.
