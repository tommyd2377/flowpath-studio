# CAVA source coverage and qualified-query audit

This local audit started from `7cf157d` on 2026-10-03. It uses an isolated checkout and demo data, public source material, and offline provider/transport fixtures. No paid model requests, real orders, account changes, deployment or cloud publication were performed.

## Confirmed defect and behavior change

The publication-driven query shortcut could recognize one field or value and silently discard the rest of a request. For example, `Show vegan options without sesame` became only a vegan filter. Executed synthetic queries then returned records whose sesame status was explicitly present or unknown. `Show vegan bowls under $15` became only a price filter, losing the dietary condition. The same defect affects other domains: material or color qualifications can disappear from rug queries that also name a sale-price ceiling.

Both typed chat and continuous voice use this shortcut before delegated reasoning. A successful partial command therefore prevented the complete request from reaching the assistant. A separate display-only eligibility check did not protect these direct execution paths.

The bounded repair requires a filter shortcut to consume the complete request. Unresolved subjects, exclusions, locations, quantities or additional criteria return no shortcut so the host retains the query and passes the original request to its normal assistant path. Exact published identities, supported single predicates and supported alternatives retain their existing behavior. This is not a new general language parser and does not establish allergy safety or interpret missing facts.

## Source and visual coverage

- Production HTTPS discovery of `https://cava.com/` stopped at `robots.txt`: HTTP 403 with a Cloudflare challenge. The importer correctly refused to crawl when it could not verify robots rules. No website pages were automatically imported, and no guard was bypassed.
- Normal public browser review could read the hydrated menu and eight item detail pages. A small manual control records exact published calorie labels, declared allergens, dietary labels and observed item-image links. Absent dietary labels are unknown. Descriptions are explicitly short source excerpts.
- The manual control is separate from automated ingestion. Three local template publications exercise Editorial, Showcase and Clarity at 320, 390 and 1440 pixels. Source images remain tied to their explicitly identified items. These checks use scripted assistant replies and acknowledgments, with actual local task routes and external browser requests blocked; they cannot establish live reasoning quality.
- No restaurant was selected. Location-specific price, tax, hours, stock, pickup/delivery availability and catering capacity remain unverified. Displayed standard-item calories do not authorize custom-recipe calculations. CAVA's shared-preparation disclaimer must remain distinct from dietary labels and declared ingredients.

## Verified results

The focused run passed 40 tests: the existing query-command suite, three grouped product regressions and seven audit reproductions. The voice control test verifies that the complete original compound utterance reaches one injected provider call, while a simple filter makes none. The typed route returns `handled: false` and retains its confirmed query for compound requests. Scoped ESLint and product typechecking passed; the temporary typecheck configuration excludes one-off audit harnesses, not application or committed test code.

All nine local browser cases passed with loaded images, no page overflow and no page errors. Native item details returned keyboard focus; repeated scripted answers did not add history entries; provider errors retained the official links. The 390-pixel Clarity case also retained the useful view after an invalid reference and an interrupted response. These are development-server replays, with reduced motion on the two phone widths and ordinary motion on desktop. The publication database hash remained unchanged. They are not physical-device, production-build, live-model or live-acknowledgment acceptance.

## Reproduction and evidence

The scoped regression suite is `tests/visitor-query-command-consumption.test.ts`. It covers requests that must fall back, preserved simple controls and execution through typed/voice entry points. It uses synthetic catalogs and mocked voice/provider transport; no application credentials are needed.

The untracked local evidence bundle is `/tmp/flowpath-cava-20261003/audit/`:

- `capture/`: production fetch status, capture time, response hash and discovery error.
- `source-review/`: source URLs, manually reviewed menu control and image-download hashes.
- `intent-contracts/`: baseline failures, executed-query evidence and source-control limitations.
- `browser/`: control identities, screenshots, browser measurements, replay logs and publication integrity hashes.

Initial browser harness failures are retained separately. They arose from development compilation/hydration timing, a mismatched link-name locator and missing acknowledgments for the scripted provider. They are not counted as product regressions.

Live acceptance remains separate: verify a qualified allergy request and a follow-up combining exclusions, custom nutrition and location through the authorized connected provider budget. The audit queued these cases with the integration owner and made no independent paid calls.
