# Zabar’s ingestion preflight — 2026-10-02

## Scope and evidence

Eleven representative public HTML pages were selected from observed homepage
links: home, store directions/hours, cafe pickup, shipping, catering, Special
Blend coffee, the Feel Better Dinner Collection, babka, bagels, returns and
contact. The originals and robots.txt were captured with SHA-256 provenance.
This was a bounded selected-page evaluation, not a complete website crawl.

The actual `importWebsitePages` function replayed those frozen bytes through its
normal public-transport validation. All eleven pages imported, totaling 37,767
source characters and 38,455 characters with source-page labels. No application
state, paid provider, cart, order, account or publication was used.

## Implemented identity correction

The homepage has no Organization JSON-LD or `og:site_name`. Its explicit
homepage brand link instead contains an image with `alt="Zabars"`. Previously
the importer selected the promotional SEO title and truncated it as the
publisher name. The proposed name was:

`Gourmet Tastes of New York! Shop for Gifts, Coffee, Smoked Fish & More Today! Za`

`lib/website-import.ts` now uses an unambiguous, non-generic logo image label
inside an explicitly marked, same-origin homepage link before falling back to
the title. Structured business identity and `og:site_name` retain precedence.
Conflicting labels, generic composites such as “Logo image” and “Company name”,
hidden logos, external links, non-home links and ordinary unmarked images do not
establish publisher identity. The resulting name is the
exact source label `Zabars`; no apostrophe or domain-derived identity is invented.

All eleven frozen page texts remained unchanged. Seventeen focused identity and
website-import tests, ESLint and `tsc --noEmit` passed. The existing long SEO
headline remains unchanged; this fix does not claim to provide finished
homepage copy or art direction.

## Implemented long-condition correction

The first frozen connected preflight rejected the coffee detail page because
its complete price/description/qualification text exceeded the compact
1,000-character attribute limit. Demo extraction silently left that offering
in page evidence only. The source contained 1,289 characters of item terms.

Long descriptions now use the existing bounded item reading blocks. The compact
price/size field and summary say: “Price and conditions require review. Read the
complete source terms in the item details.” The separate literal price remains
`$16.98`, with currency unconfirmed. Short descriptions retain their previous
compact representation. Name, category, reading-block and source-evidence bounds
remain enforced; no source conditions are truncated to satisfy them.

Strict reconciliation rejects changed or missing source blocks, and such changes
cannot inherit the original price-condition evidence. The provenance contract
is unchanged: exact source line anchors remain attached to `source_price_terms`.

Replaying all eleven SHA-verified frozen pages now passes the strict offering
preflight: twenty-five offerings rather than twenty-four, and thirty-six total
entities. All 37,767 source characters remain unchanged. Full provenance binding
passes with 81 anchors and 96 field references. The coffee’s one reading block
retains all 1,289 characters and its complete exact source anchor.

Eight explicit coffee checks pass, including coffee-only free ground shipping,
the prohibition on mixing other products, the four-unit minimum with permitted
bag/box combinations, option-dependent availability, beans/grind wording,
grinding instructions and the final serving-size condition. Footer newsletter
and cart text do not enter that offering. Normal publication adaptation and
website detail projection preserve the entire block; the actual detail component
also statically renders every character and all three compact values. This is a
pure projection/render check, not an application publication or browser-layout
claim. No provider call or application mutation was involved.

The final combined suite passed 83 focused import, identity, offering, provenance
and mocked semantic tests, plus four existing detail-rendering tests. Scoped
ESLint, `tsc --noEmit` and independent code review also passed.

## Remaining ingestion weaknesses

- Repeated homepage categories and product detail pages create distinct offer
  records for the same displayed product name. The source’s `Item No.` is kept
  in prose rather than used to establish a reviewed shared product identity.
  The brief homepage coffee record still lacks detail-page shipping conditions;
  the longer coffee offering now retains them but is not automatically merged.
- The catering page preserves its text, including serving quantities, platter
  tiers and conditions, but yields no deterministic structured offerings. Its
  prices follow descriptive paragraphs rather than immediately following the
  item heading, which the conservative extractor requires.
- Product-option form structure is omitted from the reading projection.
  Descriptive prose repeats many choice labels, but does not preserve the
  dropdown’s full option/disabled-state relationship. Such static controls
  would not establish live stock even if retained. `Select Option for
  Availability` is retained and must remain an explicit uncertainty.
- Store, cafe, housewares and holiday hours are distinct in the captured source.
  Shipping has product, address, cutoff, day-of-week and destination conditions.
  These remain reading evidence, with no typed facts or relationships in the
  deterministic catalog. A kosher label supplies no allergen-safety guarantee.

The next implementation should bind product variants and source identifiers
explicitly and keep policies associated with the relevant product or location.
It must not turn static availability wording into inventory or executable actions.

## Reproduction and pending checks

The task scratch directory contains `zabars-manifest.json`,
`zabars-preflight.mts` and the `private/zabars` capture package. Important outputs
are `preflight-report.json`, `preflight-catalog.json`, `fixed-identity.json`,
`variant-extraction-audit.json`, `long-terms-check.json`,
`offering-provenance.json` and `coffee-detail-render-check.json`. The original
failed preflight/catalog are preserved as `*-before-long-terms.json`;
`page-preflight.json` is the earlier per-page diagnosis. The reproducible pure
checks are `zabars-preflight.mts`, `zabars-long-terms-check.mts` and
`zabars-detail-render.mts`.

The coordinating agent ran `zabars-import-http.mjs analyze` against the exact
staged-checkpoint production build on localhost port 3236. Normal HTTP website
analysis produced one candidate with 36 entities and the source-backed design
name `Zabars`. The new disposable workspace `evaluation-zabars` remains at
revision 1, unpublished, with its draft unchanged. This path refetched the
selected public pages; frozen-source evidence remains separate. No review,
apply, publication or provider call occurred. Rendered output and visitor chat
for this fourth target remain unverified.

The independent research packet was materialized through the authorized Library
transfer into `private/zabars/parent-research/`: 19 sources and 30 conversation
scenarios, 36,727 bytes, SHA-256
`ada6b0faf1901ddaffb5748d49aa21ed617fd06f34469af2bcce2e47e53036e2`.
Its broader source scope does not imply those pages were imported in the
eleven-page application evaluation.
