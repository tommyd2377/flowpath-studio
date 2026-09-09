# Source review evaluation packs

These are synthetic publisher materials for offline regression checks and future interpretation evaluation. No business, person, product, date, price or availability statement describes a real offer. No pack grants a live capability.

| Pack | Deliberate difficulty |
| --- | --- |
| [Tequila](tequila/) | Related sizes, a missing price, quoted multiline descriptions, publisher price/name corrections and a missing reimport row. |
| [Books](books/) | Works versus editions versus people, a shared author, an unknown author, edition comparisons and retained publisher overrides. |
| [Classes](classes/) | Sessions versus people, prerequisites, materials, changing dates, missing prices and the distinction between a schedule and open seats. |

Each directory contains:

- `prose.txt`: a realistic free-form publisher brief. The local structured parser must decline it; unlinked excerpts retain source context without claiming field support.
- `before.csv` and `after.csv`: imperfect but valid successive imports with stable IDs. Blank cells, removed rows and changed values are intentional. These are not malformed-file stress tests.
- `expected.json`: exact structured facts and unknowns, publisher correction scenarios, visitor criteria with expected IDs, and a separate `proseEvaluation` reference.

`tests/knowledge-evaluations.test.ts` checks structured extraction, source-backed field references, preserved publisher corrections, added/missing rows, positive filters that exclude unknown values and controlled comparison plans. Visitor questions describe the journey; the automated checks apply the explicit typed filters. They do **not** score natural-language request understanding.

The prose reference lists expected semantic facts, relationships, unknowns and forbidden inferences. Its status is `reference-only-not-model-tested`: no model has been run or scored against these packs. CSV columns such as Author, Work, Instructor and Location remain attributes in the local parser. Reference relationships are not silently inserted into the parsed catalog or presented as proven extraction results.

Run the existing `npm test` command with Node 24 for these offline checks. Future model evaluation requires an explicitly authorized application/task/call budget, source-scoped observations and publisher review. The small packs are neither a benchmark of model quality nor evidence of market fit or broad ingestion coverage. They do not cover OCR, malformed PDFs, spreadsheet formulas, identity merging across sources or live integrations.
