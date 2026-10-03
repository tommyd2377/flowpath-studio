# Poppy’s website source quality — 2026-10-03

Scope: deterministic HTML extraction from the public Poppy’s homepage, cafe,
catering, venue, FAQ and reheating pages. No provider calls, orders, inquiries,
cloud writes or deployment were performed for this change.

## Behavior

The homepage starts with an assistive-only `Home` H1, a skip-target keyboard
instruction and seven carousel counters. Those controls previously occupied the
first generated reading blocks. Other pages also contained repeated instructions
and counters. Their `<title>` strings include SEO suffixes despite having useful
visible headings in the main content.

`htmlDocument` now exposes additive `headline` metadata, preserving the literal
source text: the first eligible main H1, otherwise the earliest main H2–H6 in DOM
order. Without a main region, only a content H1 is eligible. Hidden or assistive
heading ancestors, navigation, sidebars, controls and footers cannot provide this
metadata. Empty metadata leaves title/hostname fallback to the consumer.

Chrome removal is deliberately narrow:

- A direct-main assistive H1 exactly `Home` or `Homepage` is removed only when that
  main region contains an eligible visible replacement.
- The exact assistive leaf-span keyboard instruction is removed only when its ID
  is targeted by a same-document skip-to-content link.
- An exact assistive leaf-span `Slide N of M` counter is removed only within an
  explicitly marked gallery, carousel or slideshow.

Substantive accessibility text, qualifications, captions, visible counters,
class-name lookalikes and nested/quoted `Home` headings remain source content.
Raw evidence is captured before the new cleanup. The existing contact/hours
extraction, including Salon’s labeled-phone and closed-day rules, is unchanged.

The coordinated `website-import.ts` consumer replaces its raw first-H1 lookup
with `(document.headline || title).slice(0,140)`. That two-line move is a separate
integration change owned by the website-import contributor; this patch itself
changes only `html-document.ts`, its new tests and this note.

## Captured-source replay

The six frozen HTML captures retain byte-identical `rawText`, contact and hours.
The semantic text loses exactly 31 interface lines: one `Home`, six keyboard
instructions and 24 slide counters. No other line is removed and no line is added.
The resulting metadata is:

| Source | Headline metadata |
| --- | --- |
| Home | At Poppy's, we aim to create food that brings joy to the everyday. |
| Cafe | CAFE + MARKET |
| Catering | CATERING |
| Venue | EVENTS AT POPPY'S HQ |
| FAQ | FREQUENTLY ASKED QUESTIONS |
| Reheating | Reheating Instructions |

The homepage’s first reading block now starts with its introduction. The source’s
location/hours, 191-versus-194 Columbia distinction, standing-capacity conflict,
seasonal qualifications and order-change conditions remain intact. The six HTML
captures do not establish PDF-only menu details or live inventory/availability.

## Verification and limits

- 31 synthetic regression tests cover heading hierarchy, source preservation,
  exact-control positive cases and false-positive controls. All pass.
- The same new suite against the earlier baseline has 26 failures and five
  passes; 25 failures concern the new metadata contract and one reproduces the
  existing control-noise defect. These are not 26 separate product defects.
- 59 existing HTML, source-quality/provenance and website-import tests pass.
- Focused ESLint, `npm run typecheck` and `git diff --check` pass.
- An independent review tightened `Home` removal to direct main children, with
  added nested article, section, quotation, code and separate-main regressions.

All tests are offline, with synthetic fixtures or exact public-source captures.
The source-quality slice does not establish live model reasoning, browser
appearance after companion integration, or production readiness. Existing
`hidden`/`aria-hidden` controlled accordion content remains raw-only under the
preexisting extraction policy; native closed `details` content is retained.

Local evidence: `/tmp/flowpath-poppys-20261003/audit/source-quality-captured.json`,
`source-quality-existing-tests.log`, `html-accessible-chrome-expanded.log`,
`source-quality-negative-baseline.log`, `source-quality-typecheck.log` and
`headline-consumer-proposal.patch`. Public-source captures remain outside Git.
