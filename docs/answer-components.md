# Rich answers and optional relationship maps

September 23, 2026. These additions complement the controlled OpenUI and Motion
surface. They do not replace the visitor transport, published knowledge, task
execution, or presentation history.

## Published visitor answers

`components/AssistantAnswer.tsx` delegates to the portable `RichAnswer` component.
External search summaries use the same renderer. Streamdown 2.6.0 adds semantic
tables, ordered and nested lists, headings, quotations, checklists and literal
code blocks. Tables scroll within their own container on small screens. Styling
uses the existing publisher font, color and scale tokens, without Tailwind or a
global reset.

`RichAnswer` accepts completed text by default. Its optional `streaming` prop
handles incomplete Markdown with a restrained fade that respects reduced motion.
The lab simulates chunks locally. This change does not introduce a new token
stream, alter speech, or create history entries for intermediate tokens; existing
voice/chat navigation continues to commit whole answer states.

Verified external source metadata appears in a compact native disclosure adapted
from the composition of [AI Elements Sources](https://elements.ai-sdk.dev/components/sources).
This is a locally styled adaptation, not an installation of the entire AI
Elements/shadcn/AI SDK stack. Attribution and Apache 2.0 terms are included in the
shared package.

Source offsets are resolved against the original answer before Markdown parsing.
Only matching supplied source URLs become numbered citation links. Duplicate
sources are consolidated; malformed or overlapping offsets are ignored. Other
ordinary prose links retain the existing public-HTTPS-only policy and are not
promoted to verified evidence. Model HTML renders as escaped text. Markdown images
render only their alt text; approved photo, video, map and external-image
components continue to own media loading. Generated styles, scripts, iframes and
arbitrary interactive controls are not rendered. Syntax highlighting, math and
Mermaid plugins are not enabled by this integration.

## React Flow prototype

Open `/lab/answers` from the shared component lab. The Learning Studio and Bookshop
examples use synthetic validated catalogs, with no provider requests. The
desktop **View relationship map** control lazily loads React Flow 12.11.6; the
initial answer does not load its canvas. Mobile uses the complete text list for
the selected neighborhood. The list also remains available on desktop, including
if the optional canvas fails to load.

The viewer shows a two-hop neighborhood, bounded to 12 nodes and 24 edges, with
an explicit notice when bounded results omit items. Catalog validation rejects
unknown references before rendering. Node identity, direction, negation,
qualifiers, confidence and dates come from the catalog. Graph labels are concise;
the adjacent list retains the full relationship qualifications. Selecting an item
updates its description and can notify the host through `onSelect(entityId)`.
Graph edges cannot create actions; nodes cannot be edited, connected or deleted.
Wheel scrolling remains ordinary page scrolling, with explicit map zoom controls.

This is a lab prototype, not a newly registered voice tool or an executable
workflow builder. Before enabling diagrams in visitor plans, add an explicit
validated presentation variant and screen-state receipts, decide which tasks
benefit from it, and test its restore/selection behavior in the information frame.
No additional publisher capability is implied by a document relationship.

## Portable integration

- `@thevoice/platform-ui/answer`: `RichAnswer`.
- `@thevoice/platform-ui/answer-model`: URL and citation preparation helpers.
- `@thevoice/platform-ui/diagram`: optional `CatalogDiagram` viewer.
- `@thevoice/platform-ui/diagram-model`: bounded graph and relationship labels.
- Import the existing `@thevoice/platform-ui/styles.css` once. The canvas loads
  React Flow's own CSS with its lazy module.

These components have no Next.js, Firebase, credentials, AI SDK state or Studio
alias dependency. A separate packed-consumer check renders both answer and
relationship list exports. FlowPath News can consume the same package later;
its application has not been changed in this work.

## Verification

This pass passed lint, type checking, the production build, the independent
packed-consumer check, 5 new model tests, all 34 rendering tests, and 6 isolated
browser tests (4 new answer/map checks plus the existing desktop/mobile video
continuity and history regressions). The final answer and diagram layouts were
also inspected in the Codex in-app browser. All content/providers were synthetic
or mocked; no live paid API calls were made.

Offline checks cover citation offsets, unsafe links and HTML, remote-media
suppression, semantic tables and lists, partial Markdown, catalog reference
validation, bounded cyclic graphs, and qualified relationships. Browser coverage
includes source disclosure by keyboard, light/dark mobile views, reduced motion,
lazy map selection, and rich answers restored with Back/Forward on actual
published routes using mocked responses. Live speech/model quality and deployment
are not claimed.

Screenshots: [published desktop answer](screenshots/answer-components/published-desktop.png),
[published mobile answer](screenshots/answer-components/published-mobile.png),
[relationship-map lab](screenshots/answer-components/relationship-map.png).

Run `npm run lint`, `npm run typecheck`, `npm run test:package`, and
`VOICE_BACKEND=demo VOICE_AI_MODE=demo npm run build`. Focused tests:

```sh
node --conditions=react-server --import tsx --test tests/answer-model.test.ts tests/catalog-diagram.test.ts
node --import tsx --test tests/presentation/*.test.ts
npm run test:browser -- tests/browser/answer-components.spec.ts
```

Reference docs: [Streamdown](https://streamdown.ai/docs),
[AI Elements](https://elements.ai-sdk.dev/docs),
[React Flow](https://reactflow.dev/api-reference/react-flow).
