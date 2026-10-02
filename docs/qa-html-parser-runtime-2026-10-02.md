# Production HTML parser verification — 2026-10-02

## Failure and repair

The Roberta’s Pizza evaluation exposed a production webpack failure in both
website imports and uploaded HTML imports. Nine selected public pages failed
with `Page could not be read`; six uploaded copies failed with `This file could
not be extracted`. Reading those same bytes directly through the TypeScript
source succeeded. The actual built parser threw
`TypeError: j.default.decode is not a function` from Next’s bundled
`node-html-parser` dependency.

`lib/html-document.ts` now requires the explicit
`next/dist/compiled/node-html-parser/index.js` entry. The pinned Next version’s
`dist/build/handle-externals.js` externalizes explicit compiled JavaScript files,
so the already compiled CommonJS package runs through native Node loading.
Rebundling that package damaged its entity-decoder interop. Adding the directory
to `serverExternalPackages` did not solve the problem: the Next-specific path is
handled before that configuration. No custom webpack hook or dependency change
was retained.

## Verification

- An isolated `next build --webpack` completed successfully.
- The actual production server then imported all nine Roberta’s HTML pages
  through the normal HTTP `analyze-website` route. The previous build failed all
  nine. The successful proposal has nine page records and twelve merchandise
  offerings, with complete reading blocks matching all nine frozen captures.
- The new `tests/browser/html-import-runtime.spec.ts` passed against that
  production build. It uploads synthetic HTML through the real API, verifies
  named/numeric character decoding and a qualification beyond the summary,
  and checks that analysis leaves the draft and publication unchanged.
- Forty-seven focused HTML, source-adapter and website-import tests passed.
- ESLint passed for the changed parser and the new regression test.

The browser regression uses the existing isolated demo configuration and makes
no paid model calls. Its HTTP request fixture exercises the built server; it is
not a source-only parser test. The first test run incorrectly assumed the
structured HTML importer always creates one entity; the final test finds the
intended article by name and passed. This verification used webpack; a separate
Turbopack production run was not performed for this repair.

## Real-source evaluation limits

Roberta’s discovery mapped 21 same-origin URLs and read 12 within existing
bounds. Nine selected HTML pages totaled 27,661 extracted characters. All 24
reviewed fact needles remain in the proposal’s reading blocks; this establishes
text retention, not correct semantic answers or source accuracy.

Seventeen location-specific menu PDFs are linked from the locations page but
are outside the HTML website importer. Three were downloaded separately with
source-link and SHA-256 provenance: Bushwick Dinner, Penn Lunch/Dinner and
Culver Dinner. Production `extractSource` read all three one-page files;
the deterministic structured interpreter returned no catalog for any of them.
No connected semantic request was made. Independent visual review found that
two stylized Culver dish-name components were missing from extracted text.
The complete source PDFs remain available for review.

The pending HTML proposal is not ready for automatic publication. In particular,
the shop grid’s gift-card `$0.00` placeholder became a priced offering. The gift
card detail directs purchase elsewhere and excludes Penn District from the
digital card’s use. A reviewer should remove or qualify that placeholder while
retaining its source evidence. The proposal also retains navigation and form
status boilerplate, and creates no food menu entities, location entities,
relationships, media assets or executable capabilities.

The Roberta’s proposal remains unapplied and unpublished. Automatic approval
review rejected applying it because the separate localhost approval was
interpreted as covering only T. Schreiber and Arms Acres. No workaround was
used. A separate upload-and-analysis-only menu PDF check was also rejected for
the same target scope before execution, so no PDF files were uploaded to the
application and its PDF review/reader fallback behavior remains unverified.
Consequently this repair does not establish Roberta’s published visitor
chat, connected model quality, ordering, reservation or production readiness.

The reproducible capture, import attempts, hashes, parser reproduction, source
fact checks and menu evidence are in the task’s private scratch evaluation
directory under `private/robertaspizza`; the parent evaluation owns archiving
and any later authorized review/apply or browser acceptance.
