# Chat-only website filtering acceptance

Local follow-up, 2026-09-15. This supersedes the manual-filter-form instructions in the earlier website-filtering snapshot. No publication, deployment, commit, push, credentials, billing, quota settings, or provider configuration was changed.

## Architecture and code map

The authoritative visitor state remains `VisitorTaskSession`: scope, typed expression tree, ordering, canonical result references, page, foreground and navigation. The browser holds a projection plus the last acknowledged view. Query updates close details; opening details does not alter the query. `view.back` with `target:results` skips consecutive foreground details and restores the query's ordering/page; its default `previous` target retains single-step navigation. Reset and Home retain their distinct meanings.

| Responsibility | Code |
| --- | --- |
| Publication-aware command interpretation | `lib/visitor-query-command.ts` |
| Shared demo interpretation | `lib/visitor-demo-query.ts` |
| Schema, Boolean text alternatives, typed constraints | `packages/platform-ui/src/query.ts`, `lib/catalog-query.ts` |
| Capability validation, execution, reading pages, receipts | `lib/visitor-capabilities.ts` |
| Chat/voice model tool and duplicate-display guard | `lib/visitor-task-bridge.ts` |
| Unhandled-command response, same-origin and publication checks | `app/api/visitor/[slug]/tasks/route.ts` |
| Chat dispatch, cancellation, availability fallback | `components/VisitorAssistant.tsx` |
| Applied-view projection, focus, settlement and ACK | `components/VisitorTasks.tsx` |
| Cancelled viewport observations and current visible references | `lib/use-task-viewport.ts` |
| Native composition and canonical card grouping | `components/VisitorWorkspace.tsx`, `lib/website-presentation.ts`, `packages/platform-ui/src/PublishedWebsite.tsx` |
| Escaped answer prose and layout | `components/AssistantAnswer.tsx`, `components/VisitorAssistant.module.css` |
| Detail/photo typography and motion | `packages/platform-ui/src/styles.css`, `components/VisitorTasks.tsx` |
| Publisher design preview of the same renderer | `components/WebsiteDesignReview.tsx` |

### Command to render

1. A typed request interrupts older work, retains the useful confirmed view and shows pending feedback.
2. `/tasks` recognizes a clear command using the **complete authorized publication**, including all field definitions, collection paths and indexed text. Unhandled requests return `handled:false` without a model call and continue to the normal assistant when available.
3. `query.command` resolves to an existing typed capability, then passes its strict input/output validation, revision checks and publication authorization. Voice can call that same command tool; complex voice and chat requests can also propose `query.patch` directly.
4. The evaluator deduplicates membership by canonical identity, retains unknown values as exclusions, and produces a bounded page (24 records by default, at most 48). A new `search` expression permits explicit OR alternatives without discarding independent numeric or other typed constraints. Plain `searchText` retains its existing all-words semantics.
5. The main website renders the page, waits for geometry to settle, brings the requested content into view, then acknowledges the exact operation/query/result set. Only an applied acknowledgment completes a command. Aborted, stale or failed requests cannot replace the confirmed view. Starting an operation pauses viewport observations again after interrupt completion; paused observations abort their transport and cannot set a later view's error state. Interrupt responses include the server-confirmed view: an ACK that committed just before its HTTP response was cancelled cannot leave the client on an older local projection.

Clear commands cover published collection names and nested/direct scopes, search, text alternatives, published enum values, explicit numeric/money/date/boolean/list predicates, sorting, removal, undo, reset, named opening and existing ordinal/Back navigation. The interpreter does not invent fields or transform prose into inventory, dietary, price, capacity or availability facts. Ambiguous measures ask for a field or basis. Broader language, written-out quantities and ordinary questions retain the model/retrieval path. This is a bounded shortcut, not a claim of complete natural-language understanding without a model.

Examples use the publisher's own vocabulary: “Show me topic child”; “Only reading minutes at least 9999”; “Only authors includes all of alpha, beta”; “Only documented flag is false”; “Sort duration descending”; “Remove the price limit”; “Clear search”; “Undo”.

### Native presentation and removed UI

Generated sites and imported sites both use `PublishedWebsite`. The current repository has no preserved raw HTML/CSS visitor renderer. Imported designs retain the approved palette, layout, typography, media associations and text through the native composition. The publisher design preview uses this same renderer.

Removed the filter/sort disclosure, field/value/operator forms, collection/query selects, editable filter chips, fallback website search form and its local search state, and the separate Retrieved records section. Counts and passive criteria remain; direct opening, Back, paging, reset, selections and existing non-filter capabilities retain their navigation controls. Backend retrieval/collection/publication infrastructure remains intact. The shared model bridge rejects an attempt to display bounded retrieval as a second results interface.

Photo-only results use one coherent native gallery, stable numbered captions and approved media. No cake identity or association is inferred from visual resemblance. A published photo may still be an imported graphic or branding image; content curation was not changed. Reading details now render published summaries when blocks are absent, preserve heading semantics, keep a trailing heading with the following reading page, and omit irrelevant unknown fields. Other non-known states remain qualified. Reading is bounded to 12 blocks per page and field pages remain bounded to 16.

Answer prose uses escaped React text with headings, emphasis and lists. Answers stay below the persistent composer and mode switch, scroll internally when long, and retain keyboard dismissal/focus return. The mode switch stays below the composer while scrolling; foreground cards reserve space for both the voice dock and mode controls. Detail exits collapse gently; the existing canonical card identity, section exits, controlled layout transitions and reduced-motion behavior remain. Result pagination appears only in the result composition; reading details retain their own bounded continuation controls.

## Actual Doc’s Cake Shop acceptance

The earlier approved provider set submitted 16 requests: 14 live chat requests and two local navigation commands. Ten provider requests completed and four failed. Successful transport did not always mean good presentation. No live microphone recognition was tested.

| Request / section | Observed before this follow-up |
| --- | --- |
| Show me your photos | Live request displayed the published 57-image album; anonymous captions and graphics mixed with photography |
| Show me chocolate cakes | Four native matches appeared, followed by a stale-task error |
| Only those under $10 | Two $9 cakes; the $10 cake and unknown-price article excluded |
| Include vanilla too | Provider task failed; prior results retained |
| Open the second one / Back | Local commands opened Chocolate and restored the two-result order |
| Cupcakes instead, at any price | Correct two matches but a duplicate Retrieved records list |
| Puddings and cobblers | Correct answer; AND search displayed only the menu article |
| Catering cake sizes | Five tiers appeared mixed with unrelated records; task later failed |
| Cake for about 20 people | Correct 8-inch/$75 published answer with qualification |
| Large pans | Pudding $85 and cobbler $100 appeared, with duplicate results |
| Advance ordering | Correct two-day/three-week answer was above the viewport |
| History | About detail displayed; an orphan heading and irrelevant unknown fields appeared |
| Person behind the shop | Person detail omitted the biography, then schema failure |
| Who taught Doc | Correct visible answer naming Joyce “Grams” Darwood |
| Mission, vision, values | Correct long answer had raw Markdown and clipped content; detail ended on values only |

The app then exhausted its daily model allowance. The follow-up uses the real published website and the new no-model commands, plus isolated mocked-provider tests. Quotas were not raised or reset. The original unclassified live failures cannot be claimed eliminated solely from offline tests; the duplicate-display path, field ambiguity, detail/answer rendering and search broadening now have targeted fixes.

## Current verification

### Real publication, in-app browser

Completed **27 confirmed view checks** on the actual Doc’s Cake Shop publication using the chat input. These follow-up commands used the publication-aware no-model path; they made no additional paid model calls. Development hot reloads interrupted some early attempts, which were excluded from the confirmed checks and repeated after the source stabilized.

| Request sequence | Confirmed result |
| --- | --- |
| Retail cakes → sort price descending → under $10 | 26 cakes, with the $70 starting-price item first; narrowing leaves 13 |
| Retail cupcakes instead, at any price | One Half Dozen offering, $18; old price limit removed |
| Catering cakes → open the second one | Five published tiers; descending order opens Half Sheet, starting at $150 |
| Our Dessert Menu | Full native reading content includes two-day regular and three-week specialty order notice |
| Privacy Policy | Published policy text appears in the main reading surface |
| About Doc’s Cake Shop | History, mission, vision and values appear together |
| Open Darrell Oswald Christopher Darwood / Joyce Darwood | Both published biography summaries render; neither is blank |
| Open the Brooklyn location / Doc’s Cake Shop | Published address, phone, email and opening hours render |
| Catering at Doc’s Cake Shop | Published event types and catering description render |
| Pudding or cobbler | Ten canonical matches include both alternatives |
| Chocolate cakes → under $10 → include vanilla | Four matches narrow to two; the unpriced menu article is excluded. Vanilla remains excluded because its published price is $10 |
| Remove the price limit | Five chocolate-or-vanilla matches, including Vanilla; text alternatives retained |
| Open the second one → open Vanilla → back to those results | Returns past both details to the same five-result ordering |
| Show me your photos → open the second one → back | 58 published images, 24 mounted per page, one native gallery; the second photo loads at 1500px display resolution; Back restores the gallery |
| Show everything again | Clears the active composition and restores the full website |

Desktop and 390×844 mobile screenshots were visually inspected in the in-app browser. Visible gallery thumbnails loaded successfully; photos use approved media rather than inferred product associations. The page has one form and one textbox, both belonging to chat, and no filter form. The temporary viewport override was reset.

### Automated and isolated browser checks

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:package`, and `npm run build` passed. The final unit run passed **494 server tests and 21 rendering tests**. Packed-consumer verification checked the independent shared package.
- **18 targeted browser cases passed**, in separate isolated groups: seven visitor-task cases, six generated/imported website cases, and five compatibility/mocked-voice cases. This is not a claim that the entire browser suite ran.
- Coverage includes products, services, a streamed 10,000-record nested publication, full-text matches beyond page one, unknown attributes, duplicate membership, sorting, broadening, individual constraint removal, reset/Home, detail return, foreground replacement, pending/no-match/failure recovery, rapid requests, keyboard focus, reduced motion, desktop and mobile.
- The viewport regression deliberately commits a page ACK on the server and delays its response while chat interrupts it. The final run confirms recovery to the authoritative view without a stale observation error. Chat and mocked voice share execution and applied-view acknowledgment checks.
- Browser layout checks sample the hero collapse, wait for settled motion, check content positioning after scrolling near the footer, verify readable long answers beneath the composer/mode switch, and exercise foreground controls on mobile. Representative screenshots were visually inspected.
- One attempted combined run exceeded the unchanged 12-site synthetic workspace limit. The final groups use fresh isolated workspaces. That combined run also exposed the interrupted-ACK race, which was fixed and reproduced deterministically in the final passing task group.

Reproduce the browser groups after `npm run build`:

```sh
npm run test:browser -- tests/browser/visitor-tasks.spec.ts
npm run test:browser -- tests/browser/published-website.spec.ts tests/browser/website-import.spec.ts
npm run test:browser -- tests/browser/adaptive-workspace.spec.ts tests/browser/visitor-realtime.spec.ts --grep 'long published details use|explicit v2 migration|mocked chat and voice share|foreground cards yield'
```

Logs, a source-hash manifest and isolated screenshots are retained under `test-results/chat-only-2026-09-15/`. The actual Doc’s walkthrough is distinct from the synthetic publishers and mocked voice transport. The development server remains on port 3220; the older isolated preview on port 3227 represents its earlier saved source snapshot.

### Remaining limits and manual check

No live microphone capture, recognition or spoken audio was tested. The model allowance is still exhausted; ordinary questions requiring model interpretation resume when that allowance resets. The follow-up does not establish that every earlier live provider failure is eliminated. Clear collection/filter commands continue to work without model allowance. Published image captions and media associations still determine what the renderer can truthfully label or attach to a product.

On `http://127.0.0.1:3220/s/doc-s-cake-shop`, choose Chat and try:

1. “Show me your photos.” Open the second one, then go back to those results.
2. “Show everything again.” Then “Show me chocolate cakes” and “Only those under $10.”
3. “Include vanilla too.” Then “Remove the price limit.” Expect five results after removal.
4. “Open the second one.” Then “Show me retail cupcakes instead, at any price.”
5. “Show me Our Dessert Menu.” Then “Show everything again.”

Voice uses the same validated capabilities and display receipts; live speech recognition remains a separate manual verification step.

## Voice visibility follow-up

The actual Doc’s page exposed a missing combination in the earlier tests: website-first entry with Voice selected. An obsolete global CSS rule hid the entire compact voice dock whenever the website was being browsed. Removed that rule from `app/globals.css`; the existing sticky waveform and its motion now remain available above the website. No voice transport behavior changed.

The added `published-website.spec.ts` case uses a website-first synthetic publisher and checks the visible, enabled waveform, keyboard focus, scrolling to the footer, and Chat → Voice switching at 1440×1000 and 390×844, including reduced motion. It passed with zero provider requests. Production build and focused ESLint also passed. Evidence is under `test-results/voice-dock-2026-09-15/`; this is a separate follow-up to the earlier 18-case run.

Confirmed the visible, enabled Start conversation control on the actual Doc’s publication in the in-app browser, including switching to Chat and back. Voice is left selected and the local server remains running on port 3220. Tap the waveform at the top to start; microphone permission, speech recognition and live voice audio were not exercised by this visibility check.
