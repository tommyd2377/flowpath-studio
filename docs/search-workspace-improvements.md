# Published navigation and optional web context

Implementation dated 2026-09-12. This extends the existing adaptive workspace and Search and explore; it does not replace the graph, motion runtime, publication model or map implementation.

## Problems addressed

The workspace prompt previously exposed only forty retrieved records, which could omit a named item even though it was published. Its early voice-guide return also bypassed search instructions. The legacy navigation validator accepted only entity IDs when a catalog existed, rejecting otherwise valid photos, collections, facts and sections. Browser commands recognized only eight external images and no expandable source cards. External findings could not be attached to a published card.

The model now receives a complete directory of all published entities, aliases, collections, media and sections, plus the existing bounded retrieval of detailed facts. The catalog currently permits 100 entities; this is not an unlimited-document claim. Large fact sets remain retrieved, qualified and source-controlled. Exact named chat opening is a deterministic, click-equivalent operation before any provider call, including when AI allowances are exhausted. Normalized whole-name matching handles accents and non-Latin names, favors complete names over contained names, and asks about duplicate names. Field retrieval is scoped to explicitly named entities.

Voice can navigate to every registered published reference using `kind:id`; ambiguous bare IDs are rejected. It receives the same publisher purpose and explicit search instructions. Display claims still wait for the browser acknowledgement. Workspace publication hashes sort object keys, so equivalent serialized content does not spuriously invalidate a reference.

## Publisher controls and visitor behavior

Content → Visitor conversations includes **Assistant purpose**, an optional 1,000-character audience/outcome description. It influences both typed and voice guidance. It is not evidence of facts and cannot override source validation, enable tools or establish capabilities. Saving changes the draft; publishing activates them.

Content → Search and explore retains its explicit default-off search toggle, image option, domain allowlist and shared daily limit. **Add web context to published cards** is a separate opt-in, absent/false in existing publications. It enables an Add web context button in an open information/detail card and requests such as “add web context to this card.” Voice uses the same bounded service with an exact open instance ID. A refresh is an explicit new search; one addition is retained per card, within the existing six-result-set limit.

An addition contains a publication ID, instance ID and published entity/source/fact reference. The server loads the current approved snapshot and rejects disabled, forged or stale targets before reserving a search. The host rejects a result if its target has closed, changed or been superseded by a manual interaction. The published card is retained; a **From the web** section reveals its cited findings with Motion and the reading pane brings that section into view. Removing an addition does not close the published card. Drafts, knowledge facts, source provenance and published revisions are never updated by visitor searches.

Web searches request supporting images when image search is enabled (up to four for a web summary; up to 24 for an image request). These are requested maxima, not guarantees of the number or quality returned. Validated tool images, clickable citations and source cards render in responsive grids. Each image and source has an ordinal and stable code: A1–A4, B1–B4, through F4 for 24 images. Codes are identifiers that remain stable across reflow, not claims about physical screen coordinates. “Expand image 23,” “expand B4” in an image view, and “expand result B4” resolve locally without a second search. An out-of-range reference does not invent an item; a shared bare label prompts the visitor to specify image or result. Source cards open an accessible reading view with the cited search summary and an explicit link to the original page; the application does not fetch the full source page or automatically open an outside tab.

Whole-card body clicks open retained objects. Plain reading-surface clicks, surrounding background clicks and Escape return the card through the existing symmetric focus animation. Photo and external source/image viewers also dismiss when their plain content is clicked. Links, buttons, inputs, scrolling and text selection retain their behavior. Hover/keyboard emphasis reveals more existing summary text, and voice `navigate_view spotlight` highlights a visible card or collection item without expanding it. Highlighting is reported in the measured scene, including the focused surface itself; clipped, hidden or obscured targets are not acknowledged as visible.

The host owns one external viewer selection across retained results. Image/source dialogs mount outside the retained-card and traveling-card copies, preventing duplicate native dialogs during Motion transitions. Dismissal releases the native focus trap immediately while a noninteractive copy completes its visual exit, so the next click or typed request remains usable.

## Code map

| Responsibility | Files |
| --- | --- |
| Complete directory, alias lookup, exact opening and stable publication identity | `lib/visitor-workspace.ts` |
| Purpose schema, draft UI and change review | `lib/visitor-model.ts`, `components/VisitorSettings.tsx`, `lib/site-model.ts` |
| Typed guidance, voice tools, permission checks and acknowledgement | `lib/visitor-provider.ts`, `lib/visitor-realtime-control.ts`, `lib/explore-voice.ts`, `lib/visitor-realtime-context.ts` |
| External contracts, stable IDs, label navigation and attachment matching | `lib/explore-model.ts`, `packages/platform-ui/src/workspace.ts` |
| Current-publication validation, shared quotas and bounded retrieval | `lib/explore-service.ts`, `lib/explore-provider.ts`, `app/api/visitor/[slug]/session/route.ts` |
| Composer routing, retained results, cancellation and inline additions | `components/VisitorAssistant.tsx`, `components/SearchExplore.tsx`, `components/VisitorWorkspace.tsx` |
| Shared grids, source/image dialogs, card motion and pointer interactions | `packages/platform-ui/src/ExternalSearchResults.tsx`, `packages/platform-ui/src/AdaptiveWorkspace.tsx`, `packages/platform-ui/src/styles.css` |
| Actual visibility and highlighted-reference observations | `lib/workspace-screen.ts` |

No new dependencies, map changes, provider retries, billing rates, payment settings or deployment configuration are introduced.

## Pricing proposal, not active billing

Official pricing checked 2026-09-12 lists both ordinary and image web search at **$10 per 1,000 calls ($0.01 per call), plus search-content/model tokens**. Standard short-context Luna rates are $0.20 per million input tokens and $1.20 per million output tokens. GPT-Live audio time and its backend work are separate costs. [OpenAI pricing](https://developers.openai.com/api/docs/pricing)

Recommendation: apply the existing proposed 3× provider-cost retail policy to publisher search usage, including the tool fee, and charge nothing for opening, highlighting, returning or revisiting already-fetched results. This would mean a $0.03 retail tool component plus metered token/voice components, rather than charging visitors per card click. An illustrative 8,000 uncached input-token + 800 output-token Luna search costs about $0.01256 wholesale and $0.03768 at 3×. Those token counts are an example, not an observed request, fixed search allocation, cap or quote.

The current attempt ledger remains a usage ceiling, not money. Before monetary activation, implement and review versioned tool-call rates, idempotent budget reservation/settlement, provider-confirmed token/tool counts, unknown-usage reconciliation, explicit publisher spending caps and actual cost/quality measurements. Existing Stripe-test restrictions remain in force. This task does not change billing or activate charges.

## Verification and remaining evidence

Regression coverage is in `tests/search-workspace.test.ts`, `tests/explore.test.ts`, `tests/visitor-realtime-control.test.ts`, `tests/browser/search-explore.spec.ts` and the existing adaptive workspace suite. Cases cover complete publication discovery, multilingual aliases, permission/revision rejection before quota reservation, result-label navigation, voice/browser acknowledgement, source/image dialogs, inline additions, cancellation, pointer controls, reduced motion and unchanged publication data.

Completed offline checks:

- `npm run check`: lint, typecheck, 326 server/unit tests, 21 rendering tests, independent packed-package consumer and production build passed.
- Final viewer lifecycle changes also passed `npm run lint`, package and production builds, and the browser checks below.
- `npm run test:browser -- tests/browser/search-explore.spec.ts`: all 7 passed, including rapid same-image reopening, content/backdrop dismissal, stable image/source labels, voice spotlight before opening and on a focused card, manual cancellation and inline additions.
- `npm run test:browser -- tests/browser/adaptive-workspace.spec.ts`: all 9 passed, including photo-content dismissal, symmetric return, keyboard focus, nested galleries, mobile/reduced-motion behavior and measured clipping. Run the two suites separately to give each a fresh isolated demo store.
- Desktop source grids, mobile image layout and inline additions were inspected from the browser screenshots. `git diff --check` passed; unrelated source files matched the task's captured baseline hashes.

Both local listeners, 3220 (connected development) and 3225 (isolated tests), were confirmed stopped after verification. Browser evidence is under `test-results/platform/search-final/` and `test-results/platform/workspace-final/` (generated, not committed).

All verification for this change uses synthetic publications, isolated local browsers and mocked/offline providers. The connected development server remains stopped. Actual live voice comprehension, web relevance, provider support for the requested image count, latency and cost require a separately authorized bounded live test. No live-quality or production-readiness claim follows from these offline checks.

Reference: [OpenAI web search image results](https://developers.openai.com/api/docs/guides/tools-web-search#image-search-results).
