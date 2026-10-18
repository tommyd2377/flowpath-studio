<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# FlowPath waveform contributor instructions

Read README.md and docs/architecture.md before changing behavior. Use Node.js 24.

The current product opens with a centered waveform talking to GPT-Live using its own knowledge. On connection it glides to the fading logo's position over 800 milliseconds. One account can save one owner-only waveform, initial prompt, voice, accent color and optional portrait. The portrait follows the same fade/glide; the home page keeps FlowPath branding. Local conversations have a 15-minute absolute cap. Local account verification uses clearly labeled synthetic identities; Google/Firestore activation is separate and inactive by default. Keep changes small and modular. Public sharing, minute entitlements, cross-session memory and plugins are future milestones. News is an independent application in ../flowpath; never import from or compare source files against that checkout.

Studio's exact source and Git history are in the verified local archive at archives/studio-2026-10-13. Do not restore it into the active application or delete the archive automatically. Credentials and private runtime data remain untouched and separate from that source archive. Legacy Firebase rules and next.config.ts were preserved; they do not authorize cloud operations.

- No live paid API tests without explicit approval for this app, host, task and budget. FLOWPATH_LIVE_ENABLED stays off by default. Existing credentials never grant permission.
- Do not inspect, copy, print or modify credentials/private runtime data. Do not modify billing, auth providers, production environment or deployment configuration unless requested.
- No deployment, cloud changes, emulators, package publishing, force pushes or history rewriting by default.
- Use synthetic provider/media fixtures and isolated browsers. Keep provider identifiers and keys server-side; no transcript/audio logging.
- Preserve cancellation, microphone cleanup, actual playback-driven waveform state, server session limits, reduced motion and keyboard access.
- Never add a backend model, search, tools or automatic paid retries to compensate for GPT-Live limitations.
- Run npm run check and npm run test:browser for session or interaction changes. Report mocked, live and deployed evidence separately.
