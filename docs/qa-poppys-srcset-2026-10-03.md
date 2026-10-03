# Poppy's source and image-discovery audit

Base: `7cf157d`. Public source captured on 2026-10-03. Local evidence is in
`/tmp/flowpath-poppys-20261003/audit/`; source captures and publisher images are
not committed. No paid model requests, external orders, inquiries, account
changes, cloud writes, or public deployment were performed.

## Scoped correction

Poppy's uses responsive image URLs with `auto=compress,format` in the query.
Splitting `srcset` at every comma truncated these URLs and proposed a bogus
same-origin `format&cs=origin...` image. Repeated picture sources could then
collapse to that same bogus identity, losing distinct responsive variants.

Image discovery now tokenizes URLs before descriptors, following the
[HTML source-set parsing rules](https://html.spec.whatwg.org/multipage/images.html#parsing-a-srcset-attribute).
Commas within URL tokens remain part of the URL. Width and density descriptors
must be valid; malformed candidates do not displace valid lazy/original/src
fallbacks. URL guards, image limits and decoded-dimension download selection
remain in place. Explicitly hidden 1-by-1 images are excluded, while ordinary
noscript fallback photos remain discoverable.

Verification: 36 focused import/image/migration tests pass, including 13 new
srcset cases. Baseline negative controls failed five of the initial eight parser
cases and the separate larger-image import case. Focused ESLint, `npm run
typecheck` (including the platform build and route types), and an independent
parser review pass. Frozen replay of all six captured pages removes
four bogus URL candidates and six hidden tracker references while retaining
their logos. A live read-only call through the actual guarded downloader fetched
the intact 1800w Poppy's CDN URL and retained a 1,800 × 684 original (186,896
bytes). This checks a real image download, not model interpretation.

## Measured source coverage and limits

The actual bounded HTTPS importer discovered 26 URLs and captured all six
selected HTML pages: home, cafe, catering, venue, FAQ and reheating instructions.
Their extracted text totals 10,806 characters. One malformed source navigation
link returned HTTP 404; it was reported rather than fabricated as content.

The offline import/review/apply flow retained six page records with no typed
fields or registered actions. It left the draft and publication untouched until
explicit review, rejected Apply while unsupported assertions were pending,
and applied only after isolated test review. This is page organization, not
connected semantic generation. The separate source oracle covers twelve public
sources and twenty-one visitor scenarios.

Local browser checks cover Editorial, Showcase and Clarity at 1,440, 390 and
320 pixels, first with the actual text-only import and then with one manually
reviewed source photo. The eighteen layout cases have no horizontal overflow.
Source details retain full text and return focus on Escape. The manual photo
control verifies placement/rendering only; it is not evidence of automatic
photo interpretation or a semantically generated website.

The browser audit also verifies actual local source-opening requests, repeated
requests and a follow-up, keyboard access, and live reduced-motion switching.
Separately labeled mocks verify 503 recovery without automatic retry, explicit
Stop, manual details taking precedence over delayed replies, conflict-answer
rendering, and browsing after quota exhaustion. Its consolidated report has
36 corrected checks with no external browser attempts or JavaScript page errors.
Tests use the development server; a production build was not run for this patch.

Thirty code-level deterministic prompt probes produced twenty-two
clarifications, six search results and two record openings. Seventeen source,
state and action assertions passed, including an eight-turn sequence. Those
checks do not establish natural-language answer quality: menu, hours, location
comparison and catering questions generally require semantic interpretation
and the connected visitor model.

Source conflicts remain material: the Outpost at 191 Columbia has no stated
hours and is distinct from HQ at 194 Columbia; venue and FAQ disagree on
standing capacity; dated cafe PDF and location ordering menus disagree on
prices and breakfast windows. The HQ PDF's visible terms differ from hidden
extractable older text. Catering and HQ PDFs exceed the 10 MiB upload bound.
None of those PDFs or external ordering menus was imported by the six-page
HTML workflow.

## Remaining acceptance

Hidden `Home` heading selection and screen-reader slide/navigation boilerplate
remain separate extraction defects; this patch does not change them. Full
connected import and visitor-chat acceptance remains pending primary-owned
budget approval. A useful first live case asks which Columbia Street location
opens at eight and whether HQ can host 55 standing guests: it must distinguish
location identity, unknown Outpost hours and conflicting capacity, and must not
promise an order or booking. Voice and physical-device behavior remain untested.
