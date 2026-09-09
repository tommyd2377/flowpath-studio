# Offline platform proof fixtures

All names, products, prices, people, places and dates here are synthetic test data. No fixture provides inventory, booking, payment or other live capabilities.

The catalogs contain publisher-reviewed semantic records. The source packs contain corresponding CSV and explicit key/value TXT inputs for deterministic ingestion. Source headers may normalize into different attribute IDs during ingestion; compare meanings and typed values, not exact IDs. Units and relationships in the canonical catalogs represent review/correction outcomes and are not assumed to be discovered by the simple file parser.

| Example | Reviewed catalog | Import sources |
| --- | --- | --- |
| Tequila | [tequila.json](catalogs/tequila.json) | [CSV](source-packs/tequila.csv), [TXT](source-packs/tequila.txt) |
| Bookstore | [bookstore.json](catalogs/bookstore.json) | [CSV](source-packs/bookstore.csv), [TXT](source-packs/bookstore.txt) |
| Classes and experiences | [classes.json](catalogs/classes.json) | [CSV](source-packs/classes.csv), [TXT](source-packs/classes.txt) |

The local `/lab` route loads the reviewed catalogs for manual interaction. To exercise ingestion, upload a source pack in Studio, interpret it in Knowledge review, correct the result and Apply to draft before publishing. See the [platform guide](../docs/platform-foundation.md) and [architecture](../docs/architecture.md).

- Tequila: compare price, volume, aging and flavor; an unknown price must not pass a maximum-price filter.
- Bookstore: distinguish works/editions and authors, navigate relationships, scope browsing to the Books collection; author records must not become purchasable books.
- Classes: narrow sessions by experience/date, compare duration and materials, inspect people/place relationships; scheduled sessions must not be labeled available to book.

No model calls are needed to load, validate or exercise these fixtures. Canonical fixtures intentionally preserve explicit unknown values rather than replacing them with guesses. They are starting offline evidence, not proof of extraction quality or cross-domain usability.

The [source review evaluation packs](evaluation-packs/README.md) add imperfect successive imports, realistic synthetic prose, expected corrections and visitor journeys for tequila, books and classes. Structured extraction and typed visitor controls are tested offline; prose expectations are reference answers for future authorized evaluation, not verified model results.
