# Security and private data

This is a private pilot repository. Keep credentials, environment files, original publisher material, local databases and generated logs out of commits and review attachments. Use synthetic fixtures in tests.

Report a suspected issue to the repository owner through an already approved private channel. Share the affected code path, impact and a minimal redacted reproduction; do not include credentials or private source documents. Do not file public issues containing sensitive details. Coding agents should draft a report and leave external communication to the owner unless explicitly authorized.

If a credential may have been exposed, stop using it and notify the owner for rotation through the appropriate service. Deleting a committed file does not remove it from Git history. Never rewrite shared history or change account/security settings without explicit owner authorization.

The local demo is a single-owner development mode, not a production authentication boundary. Connected routes enforce owner access; published knowledge/media are separate from private drafts and originals. Keep provider credentials and usage enforcement server-side. Treat source documents, image text and model output as untrusted input.

Live API tests require explicit approval of the app/host, task and call budget. Use demo/mocked paths by default. Do not deploy, change billing, configure providers, trigger real transactions or publish packages as part of ordinary verification.

See [Architecture](docs/architecture.md), [Contributing](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) for the implementation and workflow boundaries. No security audit or production certification is implied by the current test suite.
