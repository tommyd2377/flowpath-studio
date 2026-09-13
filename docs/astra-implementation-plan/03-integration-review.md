# Assignment 3: independently verify and fix the combined implementation

Use Astra in `/Users/thomasdevito/Projects/theVoice` after assignments 1 and 2 have completed. Work from the checkout containing their actual changes. This is an independent engineering and product acceptance review with permission to fix scoped defects, update tests, and reconcile documentation. It is not permission to redesign unrelated features or deploy.

Read `AGENTS.md`, the repository README, `docs/astra-implementation-plan/README.md`, both implementation assignments, `docs/semantic-workspace-handoff.md`, `docs/semantic-graph-architecture.md`, and `docs/adaptive-workspace-architecture.md`. Verify the implementation rather than trusting completion messages or an acceptance ledger. Preserve unrelated dirty work. Present a short review plan and proceed through fixes and verification.

## Trace the whole system

Follow a synthetic supported source through extraction → evidence → candidate facts/relationships → publisher correction → Apply → Publish → retrieval → validated workspace operations → rendered React objects → actual screen context → the next visitor request. Establish which state is authoritative at each boundary. Find disconnected helpers, schema/projection losses, stale documentation, and code paths that bypass the new implementation.

Independently exercise at least these cases:

- A singleton address/contact fact and a meaningful relationship survive ingestion and can be retrieved separately, even if they do not fit repeated catalog attributes.
- Two same-name people/places remain distinct without reliable identity evidence; approved consolidation survives reimport and has a valid reversal path.
- Dates, price/currency, unknown values, negation, conflicts, and publisher overrides remain accurate through publication and retrieval.
- DOCX/XLSX/HTML/OCR handling either preserves meaningful source locations and content or reports an explicit unsupported/incomplete result. Malformed packages and unsafe website destinations remain bounded/rejected using local fixtures and mocked network transports.
- Private excerpts, raw uploads, rejected claims, draft-only facts, storage locations, and unapproved images never enter public responses or browser context.
- “Show the address,” “email too,” “that photo from the collection,” and “map too” produce independently controlled objects. Two same-type objects can coexist. Closing the map keeps the others; returning the photo restores the correct origin.
- “The one on the left,” “that photo,” scrolling, and expanded sections use the actual acknowledged scene. Open-but-offscreen objects remain open and are not described as currently visible.
- Manual interaction wins over late model work; duplicate/out-of-order operations and failed acknowledgments cannot erase the workspace or make speech falsely claim success.
- Initial rendering respects publisher choices, all content is available through explicit non-AI browsing, and voice/chat failure leaves a useful view.
- Three-point greeting choices persist and respect tone, publisher facts, content updates, publication, and visitor-speaks-first. Three layout and three palette presets work with the same data and interactions.
- Keyboard access, focus return, reduced motion, phone layout, long content, image loading failure, multiple panels, and transitions are verified in an actual isolated browser.

## Evidence and fixes

Run meaningful existing checks under Node 24, adding targeted adversarial/regression coverage where a defect or untested contract warrants it. Use `npm run check` and the relevant repository browser suites. Keep fixtures independent of the implementation's expected output. Do not weaken tests, disable safety checks, inflate confidence, or narrow the product requirement to produce a pass.

Fix correctness, integration, accessibility, and obvious visual regressions discovered in this scope. Re-run the affected checks after fixes. Complete local fixes that are feasible rather than delivering a list of issues without addressing them. If a remedy requires a genuinely conflicting product decision, finish independent work and explain the specific tradeoff.

Use no private publisher files, live paid calls, personal signed-in browsers, or external account actions. Keep billing/auth/production settings and the independent news app unchanged. A build or mocked voice test does not establish production readiness, real model quality, live speech understanding, or actual provider latency. When a browser/tool restriction blocks a check, report the command and missing evidence; do not fabricate a result or bypass the restriction.

## Deliverables

Create `docs/astra-integration-review.md` with severity-ranked findings, fixes and code locations, tests actually run, representative screenshots where useful, residual risks, and a final requirement-by-requirement acceptance ledger. Update the implementation handoffs and to-do statuses to reflect the corrected result.

Provide a short offline walkthrough the publisher can follow, plus a separate proposed live verification plan describing the specific app, calls, questions, and suggested budget. Do not execute the live plan without fresh explicit authorization. State clearly whether the product is ready for hands-on local evaluation and what still prevents claims about live quality or production use.
