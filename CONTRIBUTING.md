# Contributing

Use Node.js 24 and locked dependencies. Follow AGENTS.md and docs/architecture.md.

Run npm run check, then npm run test:browser for interaction changes. These checks are offline or mocked. Live paid API testing and deployment need separate authorization.

Keep the waveform host small. Add future domain complexity inside its module only when that feature is requested. Studio source is available through the verified local archive; restore into a separate directory.
