# FlowPath — The Voice

A small local voice interface: the FlowPath logo, one centered waveform, and an invitation to tap. A connected conversation fades the logo and invitation over 1.5 seconds while the waveform stays centered. Tap again or press Escape to end.

GPT-Live uses its own knowledge with one saved application instruction prompt. Conversations start fresh. Search, delegated models, account creation, plugins, billing and persistent conversational memory are not part of this milestone.

## Local preview

Use Node.js 24:

```sh
nvm use
npm ci
FLOWPATH_LIVE_ENABLED=0 npm run dev
```

Open http://127.0.0.1:3220. Live voice is paused by default: tapping the waveform explains that state without requesting the microphone or creating a paid session. The waveform rendering remains animated.

The initial milestone used offline/mocked verification. Live testing requires explicit approval for the app, localhost host, task and call budget. Only after that approval may development use FLOWPATH_LIVE_ENABLED=1 with already-configured server credentials. Do not create/copy keys or change environment files. Production mode rejects live access. Each local process admits at most three provider starts, including failed starts; this budget does not reset each minute. See the dated verification notes for actual live results.

## Verification

```sh
npm run check
npm run test:browser
```

Unit tests inject fake providers and sideband sockets. Browser tests use isolated Playwright, fake microphone/playback and intercepted provider responses; outside browser traffic is blocked. They prove lifecycle and visual behavior, not GPT-Live answer quality or physical-device audio.

## Small source map

- app/page.tsx and components/VoiceExperience.tsx: the opening/closing experience.
- components/Waveform.tsx: retained audio-driven canvas artwork, reduced-motion and WebKit rendering.
- lib/use-voice-session.ts and lib/voice-session.ts: WebRTC, playback and browser cleanup.
- lib/voice-config.ts: the single short prompt and voice configuration.
- lib/voice-server.ts and app/api/session/route.ts: local admission and server supervision.

The existing personal footer is retained below the opening screen and hidden during a conversation. No News code or sibling checkout dependency is loaded.

See [architecture](docs/architecture.md) and [retirement record](docs/studio-retirement.md). The News app remains separately maintained at ../flowpath. Its future subdomain and optional plugin extraction are later work.

## Studio recovery

The local verified archive is [archives/studio-2026-10-13/README.md](archives/studio-2026-10-13/README.md). It preserves 1,540 source files, including formerly uncommitted work, and Git history. The exact old working state is now committed on archive/studio-2026-10-13 and preserved in an additional snapshot bundle. Credentials and private runtime data were excluded and remain untouched. Old generated Next/package outputs were moved aside separately inside the archive directory. Archives are Git-ignored, so preserve this local directory when moving machines.

Review date: January 11, 2027. No automatic deletion or reminder has been scheduled.
