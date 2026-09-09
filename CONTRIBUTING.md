# Contributing to FlowPath Studio

Start with the [product philosophy](docs/product-philosophy.md) and [architecture](docs/architecture.md). Studio turns publisher knowledge, approved capabilities and identity into useful visitor interfaces. Changes should strengthen that general platform rather than assume a particular business, a news policy or voice as the only interaction mode. Repository-wide coding instructions are in [AGENTS.md](AGENTS.md).

## Set up the local demo

Use Node.js 24, the committed lockfile and a macOS or Linux shell. Package verification uses Unix tools; use WSL for Windows, whose native workflow has not been verified. With nvm:

```sh
nvm use
node --version
npm ci
npm run dev
```

If Node 24 is not installed, install the version selected by `.nvmrc` with your version manager first. Open `http://127.0.0.1:3220`. With `VOICE_BACKEND` unset, the local demo uses no connected services or API keys. Keep local workspace data and credentials out of Git; never copy production configuration into a test environment.

Try a synthetic source pack from [`fixtures/source-packs`](fixtures/source-packs), review its knowledge proposal, apply it to the draft, then publish within the local demo. `/lab` compares the shared interface across agave products, books and classes. The [platform foundation guide](docs/platform-foundation.md) and [photo guide](docs/photo-library.md) describe the workflows and their current limits.

`npm run dev` builds the shared package once before starting Next.js. After editing `packages/platform-ui/src/`, run `npm run build:platform` again to refresh its emitted JavaScript, declarations and CSS.

## Make a focused change

1. Create a `codex/*` feature branch by default. Inspect the current changes and preserve work you did not create; never force-push or rewrite shared history.
2. Identify the intended behavior and the smallest responsible module. Keep application storage, authentication and provider adapters in Studio; keep reusable contracts, components and motion in `packages/platform-ui`.
3. Preserve the validation boundary: only approved references enter render plans, publisher corrections remain reviewable, and publication is an explicit step. Model output cannot create facts, URLs, capabilities or arbitrary executable interfaces.
4. Add or adjust focused tests when behavior changes, using existing fixtures and harnesses. Include a structurally different publisher when changing shared abstractions. Use synthetic data, not private uploads or conversations.
5. Update the relevant guide when a workflow, limit, contract or command changes. Keep implementation names stable unless renaming is the task.

Shared UI changes should preserve stable item identity, keyboard navigation, focus behavior and reduced motion. Photos must preserve the distinction between actual subjects and examples. AI outages or exhausted usage must leave manual browsing useful. See [architecture](docs/architecture.md) for module responsibilities and [AGENTS.md](AGENTS.md) for additional boundaries.

## Verify the change

Choose focused checks while iterating, then run the complete offline check for changes that cross package, storage or runtime boundaries:

| Command | What it verifies |
| --- | --- |
| `npm run lint` | ESLint rules. |
| `npm run typecheck` | Shared package build, Next.js type generation and TypeScript. |
| `npm test` | Shared package build, server tests and shared presentation tests. |
| `npm run test:package` | Built and packed package in a separate consumer, including SSR and local OpenUI parsing. |
| `npm run build` | Shared package and production Next.js build. |
| `npm run check` | Lint, typecheck, tests, packed-consumer verification and production build. |
| `npm run test:browser` | Isolated production demo flows; requires a preceding build. |

The browser suite uses headless Playwright on port 3225, a separate directory under the operating system's temporary directory and explicit demo configuration. It does not reuse a personal browser profile or an existing server. Install the isolated test browser during setup with `npm exec playwright install chromium`; Linux may also require Playwright's system dependencies. Review [`playwright.config.ts`](playwright.config.ts) for host prerequisites before running it. The test command fails clearly when Chromium is unavailable and does not install it automatically.

Run `npm run test:browser` without arguments for the complete suite. The runner executes the core, voice and billing specs, with fresh server/data for each group so synthetic fixtures stay within the real demo site limit. It stops on the first failed group and retains artifacts under `test-results/platform/core`, `test-results/platform/voice` and `test-results/platform/billing`. Keep every browser spec in exactly one group in [`scripts/test-browser.mjs`](scripts/test-browser.mjs). Arguments select a single ordinary Playwright invocation without batching; for example, `npm run test:browser -- tests/browser/visitor-quality.spec.ts --grep focus`. Use the command without arguments for a full-suite run.

If checking a production build manually, `npm run start` serves it at `http://127.0.0.1:3220`. Do not start it on top of the dev server using the same port.

Passing local tests establishes the tested local and mocked behavior. It does not establish live model quality, Firebase configuration, production deployment behavior or billing accuracy. Report unrun checks and relevant limits clearly.

## Connected services and review

Development defaults to offline tests. Do not trigger paid model calls, deploy, publish packages, change cloud resources, alter authentication/billing settings or start emulators without explicit authorization. An approved live test needs a specific application, task and call budget; stop if unexpected calls or retries appear. Keep secrets server-side and out of code, logs, screenshots and review material. The connected-service setup documents are references for an authorized operator, not instructions to change a contributor's account automatically.

Prepare review material around the concrete problem, resulting behavior and verification. Include screenshots for material UI changes when available from isolated local testing, and identify mocks and remaining limitations. Do not include private source content, credentials or local workspace data. Remote repository operations and deployment are separate from preparing a reviewable local change.
