# FlowPath — The Voice

A small local voice interface: the FlowPath logo, one centered waveform, and an invitation to tap. On connection, the logo and invitation fade while the waveform glides up to the logo's center; all three transitions run together over 800 milliseconds. Tap again or press Escape to end and return to the centered opening view.

GPT-Live uses its own knowledge. Each account can save one private waveform with a name and initial instructions. Conversations start fresh; saved instructions are configuration, not conversation memory. Search, delegated models, public sharing, plugins and billing remain outside this milestone.

## Local preview

Use Node.js 24:

```sh
nvm use
npm ci
FLOWPATH_LIVE_ENABLED=0 npm run dev
```

Open http://127.0.0.1:3220. Live voice is paused by default: tapping the waveform explains that state without requesting the microphone or creating a paid session. The waveform rendering remains animated.

## Local account preview

```sh
FLOWPATH_ACCOUNT_MODE=local FLOWPATH_LIVE_ENABLED=0 npm run dev
```

Choose **Create your waveform**, then a clearly labeled test owner. Save a waveform name, voice and initial prompt and choose **Open waveform**. The voice selector shows a short language/regional description; Marin remains the default for existing waveforms. Saved prompt and voice changes apply to new conversations. Its stable `/w/<id>` address requires that same owner to be signed in. A second test owner cannot read its prompt or open/start/close its private conversation. Account controls disappear while talking; the existing opening/closing motion is retained.

Choose any accent using the native color picker or a six-digit hex code. The personal waveform, interface accents and subtly tinted background share that color, with contrast adjustments for readability. An optional JPEG, PNG or WebP photo (up to 5 MB) is cropped into a small portrait in the browser, validated and re-encoded server-side, then saved privately with the waveform. It replaces the personal logo and fades during the same 800 ms opening transition. Remove it to return to the logo. The main FlowPath page retains its original logo and amber appearance.

The initial prompt currently allows 4,000 characters. This app limit is separate from GPT-Live's documented 16,384-token instructions limit, which must also accommodate the platform instructions. Saved instructions do not add conversation memory or tools.

The two identities are synthetic fixtures, not real Google/Firebase accounts. Their opaque HttpOnly sessions expire after five days or a server restart. Synthetic settings persist in the new Git-ignored `.local-waveforms/` directory; sign out and back in as the same test owner to retrieve them. Do not use this fixture mode for private or production data. The application never accesses Studio's private runtime directory for accounts.

Google and verified email/password sign-in use Firebase, with a server-only Firestore adapter. New members need a single-use invitation; returning members sign in normally. The new launch project is **FlowPath Studio** (`flowpath-studio`), separate from the existing TheVoice project and News. Its web app and Standard Firestore database have been created. Hosting, provider activation, the private OpenAI secret and custom-domain connection are tracked in [the launch record](docs/firebase-launch.md); source preparation alone does not mean the service is live.

Public mode explicitly requires the configured HTTPS origin, durable Firebase sessions, invitation membership and transactional voice limits. Local fixtures remain loopback-only and development-only. App Hosting supplies browser SDK defaults through its associated web app and server access through managed identity; no private key download is needed. See [architecture](docs/architecture.md).

Live testing requires explicit approval for the app, host, task and call budget. Only after that approval may development use FLOWPATH_LIVE_ENABLED=1 with already-configured server credentials. Do not create/copy keys or change private environment files. Normal conversations end at 15 minutes, and the browser closes after 45 seconds of silence. Each local process admits at most three provider starts, including failures. Public mode additionally requires durable allowances and an independent authenticated closure task; incomplete configuration stays paused. See the dated verification notes for actual live results.

## Verification

```sh
npm run check
npm run test:browser
```

Unit tests inject fake providers, Firebase adapters and sideband sockets. Browser tests use isolated Playwright, a fresh temporary account-fixture directory, fake microphone/playback and intercepted provider responses; outside browser traffic is blocked. They prove ownership, persistence, lifecycle and visual behavior, not real Google sign-in, Firestore, GPT-Live answer quality or physical-device audio.

The October 18, 2026 account milestone passed `npm run check` (lint, types, 35 unit/integration tests and production build) and all 19 isolated browser checks. Desktop/mobile settings were visually inspected. Google sign-in, Firestore and paid voice were not live-tested; nothing was deployed.

The voice-selection follow-up passed the same checks with 37 unit/integration tests and 19 browser checks in an isolated source copy, including selected-voice persistence, legacy Marin defaults, invalid-voice rejection and selected voice in the provider request. No additional paid call was started by these checks. The local preview was restarted while idle with live voice enabled for the user's listening test; hearing each new voice remains live verification.

The personal-appearance and 15-minute follow-up passed `npm run check` (42 unit/integration tests) and all 25 isolated browser checks. Synthetic photos and custom colors were verified through save, reload, sign-out, owner isolation, removal, invalid input and failed saves. Desktop, mobile and landscape checks cover the portrait-aligned 800 ms opening/return transition and reduced motion; desktop/mobile previews were visually inspected. The server's 900-second expiry is asserted with a fake clock, and short injected deadlines verify closure without waiting 15 minutes. No paid API calls, cloud changes or deployment were performed. The preview server remains stopped.

Production launch preparation passed `npm run check` with 95 unit/integration tests and 31 isolated browser checks. Coverage includes invitation redemption, verified email flows, cross-instance account authority, transactional allowances, independent deadlines and recovery after failed provider-ID persistence. This is synthetic application verification, separate from real Firebase resource provisioning and deployed/live acceptance tracked in the launch record.

## Small source map

- app/page.tsx and components/VoiceExperience.tsx: the opening/closing experience.
- components/Waveform.tsx: retained audio-driven canvas artwork, reduced-motion and WebKit rendering.
- lib/use-voice-session.ts and lib/voice-session.ts: WebRTC, playback and browser cleanup.
- lib/account-model.ts, lib/account-server.ts and lib/account-runtime.ts: owner identity, private settings and local fixture persistence.
- lib/account-client.ts and lib/firebase-accounts.ts: optional Google sign-in and server-only Firebase adapter, inactive by default.
- components/AccountSettings.tsx and components/OwnerWaveform.tsx: the small settings page and private waveform gate.
- lib/voice-config.ts: the platform instructions and per-conversation saved prompt snapshot.
- lib/voice-options.ts: the documented GPT-Live voice choices and short descriptions, shared by the form and server validation.
- lib/appearance-theme.ts, lib/prepare-profile-photo.ts and lib/profile-photo.ts: readable personal colors, browser portrait preparation and server raster validation.
- lib/voice-server.ts and app/api/session/route.ts: local admission and server supervision.
- lib/invitations.ts and scripts/create-invites.ts: single-use invitation admission and private code batches.
- lib/production-account-session.ts: cross-instance account authority and logout protection.
- lib/production-voice-store.ts, lib/production-voice-runtime.ts and lib/voice-deadline.ts: durable public admission and independent expiry.

The existing personal footer is retained below the opening screen and hidden during a conversation. No News code or sibling checkout dependency is loaded.

See [architecture](docs/architecture.md) and [retirement record](docs/studio-retirement.md). The News app remains separately maintained at ../flowpath. Its future subdomain and optional plugin extraction are later work.

## Studio recovery

The local verified archive is [archives/studio-2026-10-13/README.md](archives/studio-2026-10-13/README.md). It preserves 1,540 source files, including formerly uncommitted work, and Git history. The exact old working state is now committed on archive/studio-2026-10-13 and preserved in an additional snapshot bundle. Credentials and private runtime data were excluded and remain untouched. Old generated Next/package outputs were moved aside separately inside the archive directory. Archives are Git-ignored, so preserve this local directory when moving machines.

Review date: January 11, 2027. No automatic deletion or reminder has been scheduled.
