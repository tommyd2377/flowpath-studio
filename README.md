# FlowPath Studio

A general-purpose, AI-native website publishing platform. Publishers supply their knowledge, capabilities and identity; the platform helps each visitor discover, understand, compare and act through an interface suited to their current intent.

Studio turns source material into reviewable knowledge and media, then publishes an immutable snapshot. Visitors explore it through controlled React components, typed requests and optional voice. Models select approved content and interface components; they do not generate arbitrary HTML/CSS or invent business capabilities.

**Status:** working local pilot with semantic ingestion, publisher correction, photos/albums and a shared visitor runtime. Firebase and direct model integrations are implemented but require separate configuration and live verification. This is not yet a complete commercial hosting or billing service.

The application currently displays **Voice Studio**. Existing identifiers (`voice-platform`, `@thevoice/platform-ui`, `VOICE_*`) are retained. The separate FlowPath/news application is a reference implementation and test publisher, not a dependency or a template for this platform.

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
2. In **Files**, upload a synthetic CSV or labeled TXT file from [`fixtures/source-packs`](fixtures/source-packs). Text-bearing PDFs are also supported.
3. Open **Knowledge → Interpret source**. Review discovered entities, attributes, collections, relationships and likely visitor needs. Correct fields directly, or try an exact-name rename through the demo correction controls.
4. **Apply to draft**. In **Files → Photos**, add individual images, a batch or a folder. Review album names, labels and connections to knowledge items or information sections. Mark illustrative images as examples.
5. Configure **Content → Opening experience** with highlights, featured items and tone. Choose chat, voice or both under **Visitor conversations**. Browsing never requires voice; the current conversation setting initially defaults to voice.
6. Review the desktop/mobile preview and **Publish**. The saved snapshot appears at `/s/{slug}`. Later draft changes remain private until republished; **Undo** restores prior draft content.
7. Explore cards, filters, comparisons, details, relationships and photo galleries. Manual controls and `/lab` use the same shared component library without model calls.

Local interpretation supports CSV and labeled TXT structures, plus PDF text extraction. Free-form interpretation and broader conversational correction require a configured model. The demo reports unsupported requests rather than pretending to understand every document.

## What is implemented

| Area | Current behavior |
| --- | --- |
| Studio | Multiple sites, chat proposals, branding/content editing, draft and published previews, approval, publication and Undo |
| Knowledge | Source ingestion, semantic catalogs, reviewable proposals, direct/conversational corrections and preserved publisher overrides on reimport |
| Media | PNG/JPEG/WebP upload, folder albums, optional group context, captions/alt/credit, actual/example connections, covers and lead images |
| Visitor interface | Controlled cards, criteria, details, comparisons, selections, relationships, explicit links and galleries; typed requests and optional bounded voice |
| Reliability | Schema/reference validation, local OpenUI parsing, stale-response protection, manual-interaction cancellation, fallbacks and reduced motion |
| Storage | Local demo files; optional Firebase owner authentication, Firestore state and private object storage; immutable published knowledge/media revisions |
| Usage | Daily request reservations, duplicate protection, bounded activity records and reported token usage; browsing survives AI exhaustion |

Photos can appear in several albums and several visitor contexts without duplicating their meaning. Publishers review the relationships; the runtime chooses the appropriate placement. Photos alone do not establish inventory, availability, prices or booking capabilities.

## Tech stack

Versions are pinned in the lockfile. These are the current direct dependencies, not claims about the latest upstream releases.

| Layer | Technology |
| --- | --- |
| Application | Next.js 16 App Router, React 19, TypeScript, Node.js 24 |
| Interface | Semantic React components, Motion 13, Lucide icons, scoped CSS |
| Rendering grammar | `@openuidev/react-lang` with local compilation, parser preflight and controlled component registration |
| Contracts | Zod 4 for source, catalog, media, interaction and presentation validation |
| Source processing | PDF.js for text-bearing PDFs; local CSV/TXT extraction; Sharp for image decode, orientation and sanitized variants |
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

The browser suite rejects unexpected external browser requests and microphone access. Storage/provider transports are mocked in unit tests; image decoding, PDF extraction, local persistence, OpenUI parsing and browser rendering are exercised locally. Passing tests does not establish live model quality, hosted Firebase behavior or billing accuracy.

An optional [manual validation workflow example](docs/examples/github-actions-validate.yml) is included as documentation. It is not installed in `.github/workflows`, so no GitHub Actions job runs from this repository. An authorized maintainer can review and copy it there later using a GitHub login with workflow permissions. The example uses explicit manual launch, read-only repository permissions and no deployment step. See [GitHub's manual workflow guide](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

## Configuration and data boundaries

- **Demo:** `VOICE_BACKEND=demo` and `VOICE_AI_MODE=demo`. This path never sends paid model requests, even if a key exists elsewhere in the process environment.
- **Connected backend:** see [Firebase setup](docs/firebase-setup.md). Missing configuration fails closed; local demo content is not automatically migrated.
- **Connected interpretation/editor:** see [AI editor setup](docs/ai-editor-setup.md), [knowledge foundation](docs/platform-foundation.md) and [photo interpretation](docs/photo-library.md). Suggestions require publisher review before Apply and Publish.
- **Visitor input:** see [visitor conversations](docs/visitor-conversations.md). Text and voice share approved content selection. Voice uses bounded turns of up to 20 seconds, not a continuous full-duplex call.
- **Private data:** credentials, environment files, original uploads, local databases, logs and generated artifacts stay out of Git. Never paste credentials or publisher material into issues, prompts, fixtures or logs.

Current pilot limits include 100 photos plus 20 other source files and 100 MB stored per site; 10 MB per photo, 2 MB per PDF and 256 KB per CSV/TXT. PDF extraction is limited to 40 pages and 60,000 characters. Catalogs support up to 100 entities and 24 attributes. See the feature guides for exact limits and failure behavior.

## Product direction

The platform should reduce the work between a publisher's source material and a useful visitor experience. Its shared machinery is organized around **discover → understand → narrow → compare → decide → act**, rather than vertical-specific templates.

Priorities are ingestion quality, semantic modeling, publisher correction, broadly useful components and motion, multimodal interaction, reliability, cost controls and instrumentation. Knowledge and live capabilities remain separate. An uploaded document or photo cannot create a booking, checkout or inventory integration.

See [Product philosophy and direction](docs/product-philosophy.md) for the principles, pilot strategy, component promotion criteria and proposed commercial assumptions. Planned work is identified separately from implemented behavior.

## Documentation and contribution

- [Architecture and code map](docs/architecture.md)
- [Knowledge and shared interfaces](docs/platform-foundation.md)
- [Photos and albums](docs/photo-library.md)
- [Visitor chat and voice](docs/visitor-conversations.md)
- [Fixture data](fixtures/README.md)
- [Contributing](CONTRIBUTING.md)
- [Coding-agent instructions](AGENTS.md) and [Claude entry point](CLAUDE.md)
- [Security and private data](SECURITY.md)

Still ahead: DOCX/XLSX/website/OCR ingestion, larger durable import processing, richer provenance/conflict review, live interpretation evaluations, monetary spending limits/accounting, complete funnel/retention analytics, domain routing and self-serve launch onboarding. Subscription billing and live commerce integrations are not implemented.

This repository is private. No open-source license is included; visibility, licensing and redistribution remain owner decisions.
