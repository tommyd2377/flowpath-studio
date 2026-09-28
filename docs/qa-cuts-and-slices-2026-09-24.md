# Cuts & Slices — live import and visitor QA

Status: this QA pass completed; remaining work is listed below. This is a new local published-site test, separate from GoSite and Doc's Cake Shop. The user authorized import, review/correction, apply, publication, typed visitor testing and shared-platform repairs in Brave at localhost:3220. No orders, external form submissions, or real transactions are in scope.

## Budget

User approved a fresh maximum of $10 for this task. Reserve $2 for each owner interpretation attempt, including failed/unknown attempts. Use the existing $3-per-recording visitor QA guard for recorded chat testing; aggregate all allocations under $10. These are conservative bounds, not a provider invoice.

- Owner interpretation attempt 1: six selected pages; provider returned incomplete menu coverage. No candidate applied; $2 reserved.
- Owner interpretation attempt 2: six selected pages, after structural price extraction and bounded semantic composition repairs; provider marked source conflicts and unmatched price lines incomplete. No candidate applied; $2 reserved.
- Owner interpretation attempt 3: after partial-review acknowledgment, evidence binding and strict merge safeguards; succeeded with an explicitly partial 73-item candidate (62 structured offerings plus 11 semantic items); $2 reserved. Total owner reservations: $6.
- Visitor chat: recorded session `6a838181-aa3e-467d-91a5-49cac793ab47`; existing local guard allocated $3 including $0.15 voice contingency (no voice opened). Aggregate allocated maximum $9 of $10.

## Acceptance sequence

1. Create a fresh site and discover the source domain.
2. Review the homepage, dedicated menu, about, FAQ, contact and catering pages; omit obsolete demo, account and transactional pages.
3. Review actual extracted entities, slice/pie prices, ingredient limitations, locations, hours and source conflicts before Apply.
4. Import and label relevant source photos; preserve exact-subject versus illustrative distinctions.
5. Review desktop/mobile website, apply and publish; verify the published snapshot.
6. Record typed visitor tests: full menu; category narrowing; numeric slice-price filters; compare; item details/photos; follow-up calculation; locations/contact; uncertain availability; Back/Forward/Home/reopen; mobile layout.
7. Fix reproducible platform defects, run focused offline regressions, retest live within budget, and record remaining limits.

## Source baseline and conflicts

Primary menu: https://cutsandslicesnyc.com/our-menu/

- Four oxtail pizzas (Sweet Chili, Curry, Sweet Teriyaki, Brown Stew): $12.50 slice / $75 pie.
- Sweet Chili Salmon: $10.50 slice / $73 pie. Homepage carousel has mismatched seafood description and different price; do not silently combine them.
- Shrimp and Lobster Black Truffle Alfredo: $18.75 slice / $112.50 pie.
- Cheese pizza: $3.50 slice / $25.50 pie.
- Vegan Speciality: $7.50 / $50.95, changes daily; Vegan Cheese: $6.75 / $36.50; Vegan Veggie: $6.75 / $47.25; Vegan Truffle: $10.50 / $72.85, not available daily.
- Menu describes Jerk BBQ Salmon as chicken, and Shrimp Specialty (No Truffle, Crab, Lobster) with those ingredients. Preserve uncertainty; no allergen assurances.
- FAQ says no gluten-free dough, halal, kosher or pork; beef pepperoni. Cauliflower crust is not evidence of gluten-free suitability.
- Locations: 93 Howard Ave, Brooklyn NY 11233; 205-01 Linden Blvd Store B, Queens NY 11412; 321 E Houston St, New York NY 10002.
- Homepage body/footer hours conflict. Wednesday closure is consistent; other differing hours need qualification and confirmation.
- General contact: info@cutsandslicesnyc.com; published phone (718) 552-2652. Media: media@cutsandslicesnyc.com.
- FAQ delivery exclusivity conflicts with embedded social captions. Catering provides an inquiry path, not confirmed capacity, pricing or booking.

These are claims from the source website, not independently verified current stock, prices or real-world operating hours.

## Issue ledger

| ID | Observation | Status |
| --- | --- | --- |
| IMPORT-01 | First 24 default selections favored sitemap/theme/demo pages, leaving menu/about/FAQ/contact/catering unselected. Account/checkout suffix variants were also offered. | Shared discovery fix implemented; focused checks passed. Fresh Brave discovery verified navigation pages first and six manual selections retained. |
| IMPORT-02 | Adjacent slice/pie price paragraphs were missed, and semantic interpretation ran before host menu extraction. Large menu exceeded the useful output budget. | Generic adjacent-unit extraction and composition implemented; actual source yields 62 offerings. Exact source evidence retained, malformed price flagged. Live retest produced all 62 structured offerings in the review and published snapshot. |
| IMPORT-03 | A validated semantic result marked incomplete was discarded, preventing review of useful retained content and source conflicts. | Website-only partial proposals now remain explicitly incomplete and require report acknowledgment plus separate assertion review before Apply. Generic document parsing still rejects incomplete outputs. Offline server and rendering gates passed. |
| IMPORT-04 | Model records matching only some deterministic fields could suppress prices or source qualifications. | Strict merge protects source IDs/definitions and complete host fields; regression checks passed. |
| DATA-01 | Source contains conflicting prices, descriptions, hours and delivery statements. | Reviewed and qualified through Studio before publishing. Corrected month-only establishment date to text; retained Brookie’s ambiguous price in reading content rather than inventing a numeric price. |
| QA-01 | Newly created site slug contains duplicated text from tester typing into an autofilled field. | Harmless test route retained: `/s/cuts-slicescuts-and-slices-qa`; no supported rename control found. Not an importer defect. |

## Publication and initial visitor findings

Published through Studio after explicit field approval and incomplete-report acknowledgement. Ten images imported: one logo, one lead photo, and eight exact named menu photos; item associations and labels reviewed. Showcase template with Coral palette, modern type and expressive native motion. Original sites unchanged.

- Natural vegan question returned all four correct offerings and slice/pie prices, preserving changing/not-daily availability.
- `Show me the pizza menu with slice and whole pie prices.` was intercepted as two text filters and showed only Cheese Pizza. Shared query fix implemented; live retest completes with structured offerings. Category precision remains under review.
- `Only show those with a slice price under $8.` failed to recognize the decorated imported field label and asked for the price basis already specified. Shared unit/basis resolution implemented; live retest returns the three vegan offerings below $8 per slice, including after Back restores the vegan view.
- Regular website cards repeated source terms, summary and typed unit prices. Display-only deduplication implemented with exact-value safeguards; visitor detail records remain intact.
- Stronger-model audit: current import is Luna/low/10K output/90s. Model choice alone cannot solve omitted substantive footer content or self-reported coverage. A staged section manifest and per-stage budget reservation remain a follow-up; no higher-cost comparison was run within this QA allocation.

## Shared visitor repairs and retests

- Qualified photo requests now reach semantic planning instead of becoming literal collection filters. A model-selected photo batch previously failed because one revision UUID was copied incorrectly. Compact workspace references now accept exact published kind/ID identities and bind only omitted revisions on the server; supplied wrong revisions, stale contexts, unknown/private references and ambiguous identities still fail. Live retest displays all four exact oxtail photos. Desktop wide grid and mobile 393×852 two-column grid were visually checked.
- Back and Forward restore meaningful prior answer states; refining a restored vegan menu preserves its category and applies the slice-price threshold. Return to website closes the foreground surface and preserves native browsing.
- Broad queries exposed redundant scope/history/detail context exceeding the 48 KB instruction ceiling. Shared bounded compaction retains query semantics, confirmed result identities/order, field units and exact scopes, explicitly marks omitted descriptions/evidence, and leaves full details retrievable. Broad live menu retest now finishes. It still included appetizers and desserts in a pizza-focused request; category precision remains under investigation.
- A live subtotal retrieved the right prices but answered $28.00 instead of $28.50. New shared `prices.total` accepts published record/field references and integer quantities, computes exact decimal line totals with currency minor-unit rounding, rejects unknown/conflicting/conditional prices or mixed currencies, and preserves source qualifications. Live retest called this tool and returned two $12.50 slices plus one $3.50 slice = **USD 28.50**.
- Factual footer prose (contacts, hours and policies) is now retained during HTML capture, while navigation/social/copyright boilerplate remains excluded. This was offline-tested; no additional paid re-import was run. The existing test site's conflicts were separately reviewed in Studio before publication.

These repairs are shared platform behavior. Product, service, class and other generic fixtures cover units, filtering, authority and calculations; no production branch is keyed to Cuts & Slices or its domain. Actual microphone behavior has not been tested in this pass.

## Later live checks

- Follow-up “make those whole pies instead, with the same quantities” retained two Sweet Chili Oxtail and one Cheese Pizza, selected the whole-pie fields, called `prices.total`, and returned **USD 175.50**.
- Contact/dietary question returned **(718) 552-2652** and correctly refused to treat cauliflower as confirmed gluten-free.
- Side-by-side Vegan Cheese versus Vegan Veggie comparison showed both correct price units; responsive mobile comparison remained readable. It still repeats some raw source terms and the model's summary table—a polish opportunity, not missing data.
- “Take me home” closed the assistant surface. “Show me all your photos” reopened ten published image records, including the logo. Photo grids no longer repeat an identical name as a second caption paragraph; canonical details and distinct captions are unchanged.
- Final combined offline run: **186 server tests + 12 presentation tests passed**; `npm run typecheck`, scoped ESLint, and `git diff --check` passed. A later 23-test bridge/context regression pass also passed after category guidance, and the three summary tests passed after exact duplicate-caption suppression.

## Photos-to-menu follow-up

A later transition from all photos back to the pizza menu failed safely, retaining the photos. The trace identified two shared defects: `schema.describe`'s numeric pagination offsets were interpreted as requested counts (skipping all categories), and an atomic `clearScopeCriteria` followed by `addConstraint` used the old root ID after clear had replaced it. The bridge now supplies an exact root scope from any view, pagination fields explicitly describe zero-based offsets, and clearing criteria preserves the root identity while resetting it to an empty AND group. Shared package rebuilt; focused regressions cover atomic clear/add, undo and publication-field validation. A later live call still incorrectly used the whole-site root as the first member of an explicit union, which includes every descendant. An input-only redundant-union guard now returns corrective `invalid_input` before any display. Existing saved queries remain readable, and valid disjoint/DAG branches remain supported. Seventeen focused regression tests, lint and TypeScript passed. Final live retest passed: “Show me the entire food and drink menu” displayed 62 offerings, then the vegan/whole-pie-price refinement displayed four in ascending order. Back restored all 62 and Forward restored the four sorted items. The narrower “pizza menu” wording still merits additional precision testing; the final pass used an explicit whole-menu request.

The user's reusable-component direction is captured in [Reusable business components](reusable-business-components.md) and backlog `BUSINESS-COMPONENTS-01`: reuse existing catalog/query/comparison/selection/motion, then add a published-data quantity basket and estimate view. Current cart/quote fixtures are synthetic only. Tax applicability and real checkout remain separate contracts/integrations, not inferred from imported prose.

## Closeout and remaining work

- Created/reviewed/applied/published site: `http://127.0.0.1:3220/s/cuts-slicescuts-and-slices-qa`. Seventy-three knowledge items include 62 structured offerings; ten imported images include the logo. No other publisher was modified.
- Recorder stopped through the UI. All 28 visitor provider calls have reconciled conservative usage: **$1.360498**, plus **$0.15** unused voice contingency and **$6** owner interpretation reservations = **$7.510498 of the $10 cap**. This is conservative accounting, not billed cost. No higher-model comparison or live microphone connection was run.
- The scoped local QA guard and reconciled ledger remain in place; with this recording stopped, further paid requests for the Cuts test slug fail closed. No automatic paid retry or new paid test is scheduled. The presumed pre-test backup was not present; historical backups do not establish the prior active state, so none was restored speculatively. Re-arm the local guard for a new explicitly budgeted recorded test before additional live API QA.
- Changes are local shared-platform code; not committed, pushed or deployed in this task. Existing dirty work was preserved. Published site content is saved through Studio's normal publication path.
- Further work: finish the shared price/description/qualification presentation contract; introduce the quantity basket and estimate component described in `BUSINESS-COMPONENTS-01`; verify source-section completeness with an explicit coverage manifest; test more natural-language category precision and recorded voice behavior. The imported proposal was explicitly partial and source conflicts remain qualified. Unknown or malformed source prices were not guessed.
