# Real website generation and visitor-chat evaluation

This evaluation uses the user-supplied public sites `https://tschreiber.org/`, `https://www.armsacres.com/`, `https://www.robertaspizza.com/` and `https://www.zabars.com/`. It does not use personal health information, real customer accounts, contact submissions, payments, or an external deployment. Raw captures and provider responses stay in the private local evaluation archive, not this repository's tracked files.

## Scope and controls

- T. Schreiber: six selected pages, including the homepage, class index, two classes, conservatory and studio policies. Bounded discovery found 100 URLs; this is representative coverage, not a complete migration.
- Arms Acres: seven selected pages covering the homepage, admissions, inpatient care, detox, adult rehabilitation, outpatient care and FAQs. Bounded discovery found 54 URLs; this is also partial.
- Frozen originals have SHA-256 hashes. Both baselines went through actual deterministic website analyze → assertion review → apply → local publication. Public publication here means the isolated loopback demo only.
- Two false T. Schreiber offerings were removed explicitly during baseline review. This correction is recorded; the automatic candidate is preserved.
- Both sites retained every quote in the selected critical ledger: 18 T. Schreiber and 17 Arms Acres anchors. Quote presence does not prove complete factual extraction, correct interpretation or whole-site coverage.
- Baseline and local-composition screenshots cover 1440 px desktop and 390 px mobile. All eight generated screenshots had no horizontal overflow. Source reference screenshots use separate fresh browser contexts; blocked third-party requests and overlays are documented.
- Manual curation controls are separate local demo sites. They test structured records, registered styling and reviewed source images; they are not presented as automatic or AI-generated results. After direct user approval, the two T. Schreiber/Arms Acres controls were published only on the isolated localhost demo. All saved composition, knowledge and media revisions were preserved.

## Verified defects and changes

| Finding | Change and evidence |
| --- | --- |
| The production webpack build rebundled Next’s precompiled HTML parser, breaking its entity decoder. All nine selected Roberta pages failed through the actual website API while direct source extraction succeeded. | An explicit `next/dist/compiled/node-html-parser/index.js` require follows Next’s compiled-JavaScript externalization rule. The production build and a real HTTP upload/analyze regression passed; all nine real pages then imported through the website API. External-package configuration alone did not fix the ordering problem. |
| The HTML adapter removed substantive headers inside page content. Six Arms Acres pages lost 2,107 header characters, including introductory and admissions wording. | `lib/html-document.ts` preserves headers inside `main`, `article`, `section` and main-role containers, while removing outer banners/navigation. Leading document declarations no longer appear as prose. Synthetic regressions plus offline re-extraction of all 13 originals passed. |
| A price-bearing heading could turn application/contact instructions into priced offerings. | `lib/website-structure.ts` requires explicit shared-price evidence and direct child structure. Ambiguous branches remain in source evidence for review. T. Schreiber's two false offerings became zero. Nested qualifications and unknown-currency literal prices remain intact. |
| The demo intent classifier fetched full page blocks just to inspect facts, causing a pre-model 32 KB error. | `planWorkspaceIntent` requests metadata/facts without full blocks. All source references and omission counts remain; complete text still pages through the existing published-content reader. The limit is unchanged. This is a **demo routing fix**, not proof of live chat quality. |
| Preflight could not inspect the semantic request without entering its service workflow. | `buildSemanticProviderRequest` exposes pure request construction. Five conditional branches retain byte-for-byte request parity. Authentication, quota, transport and review remain in their existing callers. |

Focused checks passed: 53 HTML/import checks, 63 offering/currency/provenance/review checks, 38 workspace/reader checks, and 26 semantic-request/provider checks. These suites overlap and must not be summed as a unique test total. Scoped lint and TypeScript passed. The isolated production build with the extraction and demo-classifier fixes passed.

## Automatic baseline

The deterministic import renders whole pages as lengthy “Stories,” with generic navigation, large excerpts and no imported images. The local composition changes navigation/action choices but does not invent missing semantic organization or import media. The resulting baseline is readable on both widths, but it does **not** meet the desired polished website standard.

The sources also contain unresolved conflicts that a prettier layout must not erase:

- T. Schreiber class pages show a $49 new-student charge while studio policies show $75; conservatory schedules show both 9:30 and 9:00 starts; some date rows omit a year. Static remaining-place copy is not verified inventory. Bare `$` does not establish a currency code.
- Arms Acres describes changing bed availability, recommends screening before arrival and requires individual insurance verification. It must not become a guarantee of admission, coverage or treatment results. Public-source contact and outpatient-status discrepancies remain review items.

## Actual browser chat baseline

The fresh-browser baseline executed 32 scenarios: 45 settled typed turns and two interruption submissions, split equally between desktop and mobile. It did not mock answers or call a provider.

Twenty-eight cases encountered the demo context-size error, producing 33 HTTP 502 responses. None of the 28 semantic task cases fully completed. Exact-title T. Schreiber navigation worked; the Arms Acres cases did not complete their requested tasks. Manual close and a supplemental Contact navigation check worked. No page exceptions, horizontal overflow or external browser requests were observed.

The fixed rerun observed zero context-size HTTP 502s, but inherited fixture quotas admitted only five general chat POSTs. Two opened partial sources and three did not answer; 23 of 28 semantic cases were quota-blocked. This is not a 32-case semantic pass.

Removing that exception does not make the deterministic demo a factual conversational agent. The fixed-browser rerun and live provider results are recorded separately below; no schema, build or navigation pass is counted as semantic task completion.

## Live evaluation and accounting

The user authorized a **$3 total across both coordinating threads**, inclusive of spent and reserved amounts. Dynamic To-Do acknowledged $0 spent/$0 reserved and stopped paid work. This evaluation has one paid executor and one locked ledger. Saved Codex credits are a separate account balance and are monitored independently.

The first live benchmark used the retained catalog-presentation provider with a multi-part T. Schreiber question. Astra/high/Standard completed, but returned `unavailable`; the application retained the previous view. Provider-reported usage cost $0.088268 under the checked rate card. This compatibility path is not the full primary chat workflow.

The next benchmark sent the unchanged semantic-import request for the six frozen T. Schreiber pages. It reached the existing 90-second timeout without verified usage. Its full $0.559358 worst-case reservation remains charged for the budget; the request is not retried. Known measured cost and held uncertain cost must remain separate in reporting.

The primary `runVisitorTask` benchmark used Astra/high/Standard, unchanged production workspace guidance and the real paged `read_published_content` tool. Arms Acres completed in three provider requests and two source reads. An independent 16-claim audit found no material unsupported addition or lost qualification. It did not promise same-day beds, full Medicaid coverage or admission without screening. Its initial instructions already included relevant source evidence, so this is not retrieval-only proof.

T. Schreiber completed in five provider requests and four source reads. Two previously paid responses were replayed locally to resume an unsent continuation; only three new calls were made. Exact original instructions were retained, freezing only generated `asOf` timestamps. The guard recorded hashes of verified prior opaque reasoning items and charged the original 8,192-token output bound for every continuation occurrence; unknown items still fail closed. Twenty claims were independently reviewed. Prices, four conditional fee totals, outside-work requirements and static-availability qualifications were supported. One correction remains: the answer said the sessions overlap without explaining that the source dates omit a year. The recommendation is to make overlap conditional on the dates referring to the same year.

At this checkpoint, provider-reported measured usage totals **$0.687818** and the separate unknown hold remains **$0.559358**. Accounted total is **$1.247176 of $3**, leaving **$1.752824**. These are guarded accounting observations, not an invoice. No paid work occurred in the coordinating Dynamic thread.

The live benchmarks use the existing provider configuration through the documented Next.js bootstrap. They do not establish authenticated workspace, connected storage, hierarchical task execution or browser display acknowledgment. No credentials are printed or copied into artifacts.

## Manual visual controls

The four actual visitor-route captures at 1440/390 px loaded all 12 image placements without horizontal overflow or page exceptions. Dialog Escape/focus return and mobile navigation passed. The controls improve the opening, type, images and task-based sections substantially, but manual curation changed several factors together and is not evidence of better automatic generation.

The detail renderer now places approved values and qualifications before complete source blocks. In matched mobile controls, the first fact moved from y=5,633 to 264 for T. Schreiber and from y=9,114 to 237 for Arms Acres. These are curated controls, not automatic-generation scores. The automatic Roberta product detail improved more modestly, from y=244 to 202. An unbroken source token caused a separate Arms Acres mobile dialog overflow; wrapping it reduced scroll width from 428 to 350 pixels, equal to the client width, without deleting text. Desktop geometry remained unchanged. See `docs/qa-website-detail-order-2026-10-02.md` for the rendering and browser evidence.

Grounded section headings now allow Classes, Courses, Programs, Admissions, About and Policies before generic kind labels. Existing saved plans retain their original labels until regenerated and reviewed. Remaining visual problems include source headings/navigation residue, static availability copy and long fee-conflict prose in card price columns. Complete source evidence must remain available while reviewed reading blocks improve.

A separately reviewed shared-renderer patch preserves full gallery photographs with contain framing and bounded source proportions. An approved hero repeated in a photo section becomes a compact, clickable opening-photo reference; record/story illustrations remain unchanged. Both manual controls retain their two accessible photos, captions, credits and example labels while image placements fall from three to two. Mobile gallery height falls from 944 pixels to 694 for T. Schreiber and 659 for Arms Acres. Desktop galleries become taller because the alternative photograph receives more space. Eight actual after cases, two failed-image probes and thirty synthetic template/viewport cases passed, including photo access, focus return, menu behavior and overflow. These are rendering checks on manual controls, not automatic image-selection evidence.

## Roberta’s mixed-source findings

Nine bounded public HTML pages and three location-specific menu PDFs were captured. The source website has no horizontal overflow at the tested widths. Seventeen menu links were observed, so three captured PDFs are representative, not complete coverage. Full-service Penn and R Slice Penn must remain distinct: their hours differ, and the full-service listing must not inherit the slice location’s contact details. Homepage/history mentions do not prove current location status.

The three visually inspected menu PDFs expose cash/card price pairs and location-specific pricing, allergen qualifications and six-person gratuity terms. Stylized names such as “Jacaranda” and the “1986” part of a title can disappear from the text layer. A text-only extraction success does not establish complete menu fidelity. The HTML source also contains a gift-card $0.00 template price and placeholder press-kit copy; neither belongs in polished visitor claims without review. Most homepage photographs are AVIF, which the current importer does not accept; two JPEG/PNG candidates were identified separately.

After the parser fix, actual HTTP website analysis succeeded for all nine pages, proposing nine page records and twelve merchandise offerings. Direct user approval resolved the earlier automatic approval rejection. The reviewed local publication is `evaluation-robertaspizza`, revision 12: review removed the $0 gift-card offering while preserving its source page and qualified a vegan tagline using the FAQ. These were explicit manual corrections, not automatic improvements. Review included 105 assertion decisions; no cloud publication occurred.

The actual published-browser cohort executed 16 cases (eight desktop, eight mobile), with 20 settled turns and one interruption. None of the 14 semantic tasks completed in deterministic demo mode; two exact source-opening cases worked. Seventeen general chat POSTs consumed quota from 25 to 8. There were no context-size errors, page exceptions or horizontal overflow. Two ordinary questions were intercepted as local workspace commands: a Saturday closing-time question and a follow-up ending in “right?”. The new command guard routed both through normal chat in a subsequent desktop/mobile regression; explicit “Move right” stayed local and manual close returned focus. Those two POSTs consumed quota from 8 to 6 without resetting it. Generic demo fallback is not a factual-answer pass.

Three menu PDFs also went through the actual application upload/analyze routes in a separate disposable draft. All three original-file hashes were retained exactly and application extraction succeeded for one page each. All three then failed explicitly at deterministic interpretation because the prose requires the connected semantic interpreter; no entities were proposed, no paid request occurred, and nothing was applied or published. The existing Roberta publication was unchanged. PDF text-layer fidelity checks are separate evidence: successful extraction still misses some stylized names and does not structure cash/card price pairs.

## Zabar’s capture and preflight

Eleven frozen HTML pages imported successfully in the source adapter, preserving 37,767 extracted characters. This is distinct from the independent 19-source research checklist and does not establish complete coverage. The existing title fallback selected a truncated SEO sentence as the publisher name. A conservative fallback now uses an unambiguous, explicit same-origin homepage logo label after organization/site metadata; the captured label is exactly `Zabars`. Seventeen focused tests passed, and all eleven extracted page texts remained unchanged.

Strict offering preflight found a separate failure: the Special Blend coffee page's conditions exceed the 1,000-character fact field. The former demo fallback omitted that detail offering while a homepage offer lacked the coffee-only, four-unit shipping qualification. The fix retains complete long conditions in reading blocks and uses an explicit conditional-price warning in the compact field. Strict reconciliation rejects dropped or edited source blocks; changed blocks lose inherited parser evidence. This repairs the structuring preflight, not a completed end-to-end import or a guarantee that chat will consult every condition.

The exact staged production build subsequently passed the normal localhost website-analysis API: one candidate, 36 entities and design name `Zabars`. The disposable draft remains unchanged at revision 1 and unpublished. No provider call, review or apply occurred. The independent 19-source/30-scenario checklist is retained separately from these eleven imported pages.

## Remaining acceptance work

Completion requires source-grounded answers and useful interface changes through actual visitor chat, including comparisons, conflicts, follow-up corrections, interruption, missing information and next steps. Isolated provider reasoning and manual controls are useful evidence, but neither substitutes for that end-to-end gate.

The existing connected app configuration and signed-in Brave session are valid; login is not the remaining blocker. Demo mode deliberately disables paid AI. The connected visitor route reads Firebase published records without viewer authentication and is not guaranteed private across other deployments using that project. No test was published to the shared Firebase backend.

The user approved temporary localhost-only Auth, Firestore and Storage emulators. A separate app copy uses project `demo-flowpath-eval`, synthetic accounts and an external-transport fence. Normal UI sign-in, session/CSRF, authenticated create/read, Storage upload/download, logout denial and cross-account denial passed. The T. Schreiber and Arms Acres manual controls were then uploaded, reviewed, applied and published through normal owner APIs with zero provider calls. Original HTML uploads remain private sources; they do not automatically anchor the manually curated claims.

Both actual browser paths reached the primary runner and produced exact no-send request preflights. T. Schreiber's request is 104,634 UTF-8 bytes, with a conservative $1.967525 reservation; Arms Acres is 105,495 bytes, reserving $1.978288. Both exceed the current $1.752824 remainder, so no provider request was sent or reserved. Arms completed the browser preflight; its Chromium response-body read was unavailable and explicitly logged. The earlier T. Schreiber observation script failed while reading that stream, after the valid provider-body capture. Neither produced a model answer or browser display acknowledgment.

The T. Schreiber browser request is 2.55 times the 41,055-byte direct-runner benchmark. Additional task/capability instructions, workspace context and tool schemas account for the difference: the task-bridge prefix includes 28,400 characters of schemas for 34 capabilities; workspace data adds structured knowledge, published text and records. This is a concrete context/cost bottleneck. No model, output limit, evidence or reservation was weakened to fit. End-to-end live browser acceptance remains blocked by the approved budget, and emulator evidence is not real-cloud acceptance.

The reusable local evidence root is `/tmp/flowpath-real-source-evaluation-20261002`. It contains source and factual manifests, browser requests/responses/screenshots, source-image preparation, budget tests and runnable provider preflights. `prompts/README.md` links three complete reusable proposals: a grounded content brief, a schema-compatible composition prompt, and a rendered/conversational critic, with an evaluation rubric and hard failure gates. They have not been compared in a paid A/B experiment. Final comparison results and the durable archive location are added at completion.
