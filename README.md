# FlowPath Studio

Voice now uses **GPT-Live-1 with a separate Luna backend**. See [GPT-Live architecture and verification](docs/gpt-live.md) for the shared core, publisher defaults, limits and migration details.


A general-purpose, AI-native website publishing platform. Publishers supply their knowledge, capabilities and identity; the platform helps each visitor discover, understand, compare and act through an interface suited to their current intent.

Studio turns source material into reviewable knowledge and media, then publishes an immutable snapshot. Visitors explore it through controlled React components, typed requests and optional voice. Models select approved content and interface components; they do not generate arbitrary HTML/CSS or invent business capabilities.

**Editorial, Showcase and Clarity** provide three distinct website templates, with actual-content previews and simple palette, typography, text-size and spacing controls in Branding. Related files share one review, and source withdrawal preserves supported facts and publisher corrections. Existing sites opt in without migration or reimport. See the [implementation and publisher guide](docs/templates-and-source-lifecycle.md) and [visual evidence](docs/screenshots/templates/README.md).

**Status:** working local pilot with semantic ingestion, publisher correction, photos/albums and a shared visitor runtime. Firebase and direct model integrations are implemented but require separate configuration and live verification. This is not yet a complete commercial hosting or billing service.

The application displays **FlowPath Studio**. Existing identifiers (`voice-platform`, `@thevoice/platform-ui`, `VOICE_*`) are retained. The separate FlowPath/news application is a reference implementation and test publisher, not a dependency or a template for this platform.

## Start locally

Use **Node.js 24**, npm and a macOS or Linux shell. The current package verification scripts use Unix tools; use WSL for Windows, whose native workflow has not been verified.

```sh
git clone https://github.com/tommyd2377/flowpath-studio.git
cd flowpath-studio
nvm use
npm ci
VOICE_BACKEND=demo VOICE_AI_MODE=demo npm run dev
```

If needed, install Node 24 through your version manager first (`nvm install` for nvm). Run `nvm use` in each new terminal. Application scripts check the Node version and fail clearly if it is incompatible.

Open [Studio](http://127.0.0.1:3220) or the [shared component lab](http://127.0.0.1:3220/lab). No environment file, API key, account or cloud service is needed for the demo. The explicit demo flags above also keep a previously configured checkout offline. Stop the server with **Ctrl+C**.

The demo is a single local owner with Git-ignored storage under `data/`. It is for development and preview, not production authentication or multi-process hosting. `VOICE_DATA_DIR` can select an isolated data directory.

## Try the publisher-to-visitor flow

1. Create a site using **Start from my content**, or explore an existing sample.
2. In **Files**, upload a synthetic CSV or labeled TXT file from [`fixtures/source-packs`](fixtures/source-packs). Text-bearing PDFs, DOCX, XLSX, HTML and OCR-capable images are also supported.
3. Open **Knowledge → Interpret source**, or include up to five related files for a combined review. Review file results, changes, entities, attributes, collections, relationships and likely visitor needs. Correct fields directly, or try an exact-name rename through the demo correction controls.
4. **Apply to draft**. In **Files → Photos**, add individual images, a batch or a folder. Review album names, labels and connections to knowledge items or information sections. Mark illustrative images as examples.
5. Configure **Content → Opening experience** with highlights, featured items and tone. Choose chat, voice or both under **Visitor conversations**. Browsing never requires voice; the current conversation setting initially defaults to voice.
6. Choose a template and basic styling in **Branding**, save the draft, review the desktop/mobile preview and **Publish**. The saved snapshot appears at `/s/{slug}`. Later draft changes remain private until republished; **Undo** restores prior draft content.
7. Explore cards, filters, comparisons, details, relationships and photo galleries. Manual controls and `/lab` use the same shared component library without model calls.

Local interpretation supports CSV and compatible multi-sheet XLSX tables, labeled TXT/DOCX/HTML structures and text-bearing PDFs. Free-form interpretation and broader conversational correction require a configured model. OCR uses local Tesseract when installed or an explicitly configured/injected worker; this repository does not deploy that worker. Scanned PDF pages, unsupported Office structures and incomplete extraction fail explicitly. Review exact source locations, singleton facts, conditions and identity suggestions before Apply; publishing remains separate.

## What is implemented

| Area | Current behavior |
| --- | --- |
| Studio | Multiple sites, chat proposals, branding/content editing, draft and published previews, approval, publication and Undo |
| Templates | Editorial, Showcase and Clarity; actual-content previews, independent style controls, accessible palettes, local licensed fonts and compatible legacy styles |
| Website import | Bounded public HTML/sitemap discovery, selected-page imports, original-quality image downloads, saved knowledge and native design review, mobile preview, separate Apply/Publish; JavaScript execution is not migrated. See [website import](docs/website-import.md). |
| Knowledge | Bounded multi-format and related-file ingestion, explicit partial review, source replacement/withdrawal, private field/fact/relationship evidence, singleton/temporal assertions, identity review, correction history and publication-scoped retrieval |
| Media | PNG/JPEG/WebP upload, folder albums, optional group context, captions/alt/credit, actual/example connections, covers and lead images |
| Visitor interface | Controlled cards, conversational filtering, details, comparisons, selections, relationships, explicit links and galleries; typed requests and bounded continuous voice that preserves manual browsing |
| Reliability | Schema/reference validation, local OpenUI parsing, stale-response protection, manual-interaction cancellation, fallbacks and reduced motion |
| Optional search | Published opt-in for cited web results, attributed web images and interactive map overviews; separate daily caps, offline previews and bounded voice controls. Live provider quality remains unverified. |
| Storage | Local demo files; optional Firebase owner authentication, Firestore state and private object storage; immutable published knowledge/media revisions |
| Usage | Daily request reservations, duplicate protection, bounded activity records and reported token usage; browsing survives AI exhaustion |
| Launch offer | $29/month or $300/year per site; $10 monthly retail AI allowance; prepaid top-ups, optional capped replenishment, local billing preview and Stripe test-mode Checkout/Billing |

Photos can appear in several albums and several visitor contexts without duplicating their meaning. Publishers review the relationships; the runtime chooses the appropriate placement. Photos alone do not establish inventory, availability, prices or booking capabilities.

## Tech stack

Versions are pinned in the lockfile. These are the current direct dependencies, not claims about the latest upstream releases.

| Layer | Technology |
| --- | --- |
| Application | Next.js 16 App Router, React 19, TypeScript, Node.js 24 |
| Interface | Semantic React components, Motion 13, Lucide icons, scoped CSS |
| Rendering grammar | `@openuidev/react-lang` with local compilation, parser preflight and controlled component registration |
| Contracts | Zod 4 for source, catalog, media, interaction and presentation validation |
| Source processing | PDF.js for text-bearing PDFs; bounded CSV/TXT/DOCX/XLSX/HTML extraction; injectable local OCR; Sharp for image decode, orientation and sanitized variants |
| Optional backend | Firebase Authentication, Firestore and Cloud Storage through server-owned routes |
| Optional models | Direct OpenAI Responses requests and bounded Realtime voice through server-side integrations; no OpenUI Gateway dependency |
| Verification | Node test runner with tsx, React server rendering, a packed-package consumer check, Playwright and ESLint |

`packages/platform-ui` is the portable shared package. It contains its own contracts, deterministic interaction helpers, semantic components and motion vocabulary, with no Firebase or Studio dependency. Application scripts rebuild it before development, typechecking, tests and production builds. Rebuild it after package-source changes during a running development session.

## Commands and verification

```sh
npm run check
npm exec -- playwright install chromium
npm run test:browser
```

`check` runs lint, type generation/typecheck, server tests, rendering tests, the packed-package consumer and a production build. Browser verification requires that build plus an installed **isolated Playwright Chromium**. The browser installation command downloads that test browser; it does not use a signed-in browser profile. On Linux, Playwright may also need its documented system dependencies.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build shared components and start Studio on `127.0.0.1:3220` |
| `npm run build` / `npm run start` | Build / serve the production application locally |
| `npm run build:platform` | Rebuild the shared package after editing its source |
| `npm run lint` / `npm run typecheck` | Focused static checks |
| `npm test` | Server/contract and React rendering tests |
| `npm run test:package` | Pack and consume the shared package from a separate temporary project |
| `npm run test:browser` | Production browser suite on port 3225 with isolated temporary demo data |
| `npm run test:recorder` | Development-only local recording controls, timeline and export in an isolated browser on port 3225 |

The browser suite rejects unexpected external browser requests and microphone access. Storage/provider transports are mocked in unit tests; image decoding, PDF extraction, local persistence, OpenUI parsing and browser rendering are exercised locally. Passing tests does not establish live model quality, hosted Firebase behavior or billing accuracy.

For local voice/chat investigations, use the opt-in [test recorder and timeline](docs/local-visitor-testing.md) to capture transcripts, actual model inputs, actions and screen acknowledgments with timestamped problem markers. It is disabled in production and does not add model calls.

An optional [manual validation workflow example](docs/examples/github-actions-validate.yml) is included as documentation. It is not installed in `.github/workflows`, so no GitHub Actions job runs from this repository. An authorized maintainer can review and copy it there later using a GitHub login with workflow permissions. The example uses explicit manual launch, read-only repository permissions and no deployment step. See [GitHub's manual workflow guide](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

## Configuration and data boundaries

- **Demo:** `VOICE_BACKEND=demo` and `VOICE_AI_MODE=demo`. This path never sends paid model requests, even if a key exists elsewhere in the process environment.
- **Connected backend:** see [Firebase setup](docs/firebase-setup.md). Missing configuration fails closed; local demo content is not automatically migrated.
- **Connected interpretation/editor:** see [AI editor setup](docs/ai-editor-setup.md), [knowledge foundation](docs/platform-foundation.md) and [photo interpretation](docs/photo-library.md). Suggestions require publisher review before Apply and Publish.
- **Visitor input:** see [visitor conversations](docs/visitor-conversations.md). Text and voice share approved content, current view context and bounded ephemeral history. Connected published sites use continuous, interruptible WebRTC voice with server-authorized turns, a publisher-configurable inactivity close and a two-minute hard session limit. Browsing keeps the call connected while cancelling stale responses; voice can answer directly or request a validated view/navigation change. Voice errors offer separately capped typing fallback. Demo previews remain local and deterministic; live audio quality and deployed session supervision require separate verification.
- **Launch billing:** see [the launch offer](docs/launch-offer.md). Usage & billing supports persistent synthetic payments locally. The Stripe integration is test-only and requires separately supplied test configuration; signed confirmations, durable orders and credit reservations are implemented. Test credits cannot fund live AI. Existing unenrolled pilots retain their attempt limits. No real payment, merchant setup or domain connection happens automatically.
- **Private data:** credentials, environment files, original uploads, local databases, logs and generated artifacts stay out of Git. Never paste credentials or publisher material into issues, prompts, fixtures or logs.

Current pilot limits include 100 photos plus 20 other source files and 100 MB stored per site; 10 MB per photo or PDF and 256 KB per CSV/TXT. PDF extraction is limited to 40 pages and 60,000 characters. Catalogs support up to 100 entities and 24 attributes. See the feature guides for exact limits and failure behavior.

## Product direction

The platform should reduce the work between a publisher's source material and a useful visitor experience. Its shared machinery is organized around **discover → understand → narrow → compare → decide → act**, rather than vertical-specific templates.

Priorities are ingestion quality, semantic modeling, publisher correction, broadly useful components and motion, multimodal interaction, reliability, cost controls and instrumentation. Knowledge and live capabilities remain separate. An uploaded document or photo cannot create a booking, checkout or inventory integration.

See [Product philosophy and direction](docs/product-philosophy.md) for the principles, pilot strategy, component promotion criteria and proposed commercial assumptions. Planned work is identified separately from implemented behavior.

## Documentation and contribution

- [Architecture and code map](docs/architecture.md)
- [Knowledge and shared interfaces](docs/platform-foundation.md)
- [Source review and updates](docs/source-review.md)
- [Photos and albums](docs/photo-library.md)
- [Visitor chat and voice](docs/visitor-conversations.md)
- [Optional web search, images and maps](docs/search-and-explore.md)
- [Fixture data](fixtures/README.md)
- [Contributing](CONTRIBUTING.md)
- [Coding-agent instructions](AGENTS.md) and [Claude entry point](CLAUDE.md)
- [Security and private data](SECURITY.md)

Still ahead: larger durable import processing, deployed managed OCR workers, live interpretation evaluations, production payment activation and provider-usage reconciliation, complete funnel/retention analytics, domain routing and self-serve launch onboarding. Visitor-to-publisher commerce will use Stripe Connect by default; that separate integration is not implemented. See [semantic graph architecture](docs/semantic-graph-architecture.md) and the [executable knowledge-to-workspace handoff](docs/semantic-workspace-handoff.md) for implemented behavior, exact limits and verification boundaries.

This repository is private. No open-source license is included; visibility, licensing and redistribution remain owner decisions.

## Visitor task system

Hierarchical publication spaces support shared records, nested collections, conversational and manual filtering, persistent selections, typed capability composition, editable artifacts and synthetic commerce/scheduling reviews. The normal website is independent. Voice and chat open a shared carousel layer above it; filtering, details and Back operate within that layer and retain its criteria and ordering. The v2 path streams and reviews up to 10,000 records without hydrating the public page or model context with the full catalog. Existing v1 publications remain readable. See [the AI carousel layer](docs/visitor-task-system/ai-layer-implementation.md) for current state, rendering and verification, and the [implementation report](docs/visitor-task-system/implementation-report.md) for earlier migration and capability work.
