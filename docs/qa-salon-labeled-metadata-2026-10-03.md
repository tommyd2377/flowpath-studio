# Labeled contact and hours extraction — Salon Van Sickel

## Change

A visible paragraph containing `Tel: (718) 246-5500` previously produced an empty
contact field. An inline `Hours:` block with `Closed Sundays` was omitted when a
footer already supplied weekday/Saturday hours. Both facts survived in the full
source text, but the generated contact/hours summary was incomplete.

`lib/html-document.ts` now recognizes explicit Phone/Tel/Telephone and Hours labels
within one authored block. It preserves phone formatting, price-independent
qualifications and complete schedule wording, including closed days. Existing
footer/heading extraction remains the fallback. Different literal schedules are
not reconciled into a guessed schedule.

New extraction excludes hidden content, forms, navigation and quoted/code blocks.
It does not infer unlabeled numbers, consume neighboring paragraphs, turn prose
into a service catalog, add an address or create booking capabilities. Multiple
distinct inline values, named mixed contexts and combinations exceeding the
180-character metadata limit may leave the derived field empty for review; full
source evidence remains intact. The same phone/schedule discovered twice does not
erase previously available metadata. The legacy extraction path's existing
limits and precedence are unchanged when no eligible inline labels are present.

## Source and verification

The authorized [salon homepage](http://www.salonvansickel.com/) and its About,
Services and Contact pages returned HTTP 200 on 2026-10-03. The HTTP site did not
redirect to HTTPS. Both HTTPS hostnames failed certificate verification. The
native importer correctly rejected HTTP and failed closed on HTTPS; no TLS or
robots boundary was relaxed. Public HTTP captures were used only for explicitly
labeled offline replay and a saved-HTML local workflow.

The linked pages' main text matches the corresponding home sections. Frozen
before/after checks on all four captures preserve every extracted field except
derived contact/hours, including raw text, semantic text, blocks, links and image
references. Home and Contact now supply the phone and Sunday closure to design
proposals. No source prices, currency assumptions or service descriptions changed.

The dedicated `tests/html-labeled-contact-hours.test.ts` exercises the triggering
markup, inline formatting, qualifications, boundaries, hidden descendants,
duplicate evidence, ambiguous locations, conflicting schedules and length limits.
Existing HTML/import/migration tests cover source provenance, lifecycle, public
HTTPS checks, publication isolation and legacy metadata behavior.

Local evidence is retained at `/tmp/flowpath-salon-20261003/evidence/`, including
capture hashes, source oracle, 30 proposed visitor intents, exact commands, frozen
fidelity results and isolated browser screenshots. Test totals and final browser
workflow status are recorded in that bundle's `REPORT.md`.

## Acceptance limits and follow-up

The static parser still produces four page records and no structured service
offerings for this site's prose price layout. It correctly flags unmatched prices
for review. A manual seven-service control was created separately to exercise
Editorial, Showcase and Clarity at 1440/390/320 pixels; its appearance is not
evidence of successful automatic semantic ingestion.

Actual deterministic demo chat misses natural haircut/highlight price questions
and a price follow-up after opening Haircuts, despite published prices. Exact-name
service display and comparison work. Unknown durations, roster details and
bookings do not become fabricated facts/actions, but the generic fallback lacks
a helpful contact card and refers to browsing below an inert background. Those
visitor-routing/copy issues are outside this patch's ownership.

No live semantic model, paid visitor chat, voice, production deployment or real
booking was tested. A source-grounded live two-turn foil-minimum/payment case was
queued with the integration owner, who owns the shared API budget. The source
certificate still blocks native live import. Local screenshots, mock outage/stale
response checks and a saved HTTP capture are not substitutes for that acceptance.
