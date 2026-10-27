# FlowPath Studio

**Save draft** keeps edits private. **Preview draft** opens your saved private version; **Publish / Update published version** explicitly updates the visitor-facing snapshot, opened through **View published version**. Saving alone does not change an existing publication.

The new [hosted tester demo candidate](docs/hosted-beta.md) uses request-based heartbeats/cleanup, a three-minute daily account allowance and an owner-only founder exemption that never applies to the introduction. It has no daily OpenAI spending guard. Its source activation profile is prepared; release and real-provider acceptance remain pending. Payments and hosted Knowledge remain off.

The earlier October 27 [voice lifecycle candidate](docs/voice-lifecycle.md) keeps hosted starts closed pending cutoff/recovery acceptance and adds request-owned, fenced cleanup for known sessions. The full localhost experience and unmetered founder testing remain unchanged. This branch is not deployment or hosted reactivation approval.

The selected [desktop experience](docs/experience-design.md) places the portrait left of the raised waveform. Text Box remains absent until requested and reveals over 800 ms, with its toolbar visible inside the viewport. Stop writing pauses capture; Hide dismisses without ending voice or erasing text. News appears only on the Studio homepage. Mobile reflow is protected; further mobile visual tuning remains separate.

[Knowledge](docs/knowledge.md) adds private PDF/DOCX/TXT uploads through **Plugins → Knowledge → Manage documents**. Ready documents support spoken answers and requested passages/sources in Text Box. It uses the [shared plugin contract](docs/parallel-work/contracts.md#shared-plugin-contract-implemented), existing Google/email accounts and GPT-6 Luna. Real provider use is restricted to the full localhost app; public document publication and hosted cost controls remain gated.

FlowPath Studio is the current voice-first waveform app. Choose **Create your waveform** to configure a name, instructions, voice, accent color and optional portrait. An opt-in local test preview also supports public sharing and the three creator/visitor payment modes; real paid usage remains paused.

The active application branch is **`main`** in `tommyd2377/flowpath-studio`. The earlier website builder is retired; older branches and Git history are retained for recovery. See the [current-state audit](docs/parallel-work/current-state.md) and [parallel-work handoff](docs/parallel-work/ownership.md) for implementation status, test results and contributor boundaries.

A small voice interface: the FlowPath logo with Studio tucked beneath it, one centered waveform, and an invitation to tap. On connection, the logo and invitation fade while the waveform glides up to the logo's center; all three transitions run together over 800 milliseconds. Tap again or press Escape to end and return to the centered opening view. The homepage has matching News-example and account links in its top corners; those links remain available during the public welcome conversation.

GPT-Live handles speech and delegates factual questions and text actions to **GPT-6 Luna**, the default delegation model. Each account can save one private waveform with a name and initial instructions. Conversations start fresh; saved instructions are configuration, not conversation memory. In waveform settings, **Plugins → Text Box → Apply plugin**, then **Save draft**, enables dictation and spoken text updates in a panel below the waveform. See [Text Box](docs/text-panel.md). Web search and external actions remain unavailable. An opt-in [paid MVP test preview](docs/paid-mvp.md) adds publishing, sponsor/visitor payment modes, prepaid accounting and synthetic checkout. Paid voice and purchases remain blocked outside local fixtures until upstream enforcement is verified; no live payment path is implemented.

## Local preview

The full localhost app also runs [creation review](docs/creation-safety.md) for names, instructions, portraits and Knowledge. Disclosed historical characters can be for conversation or fun; no teaching role is required. Real people must have been dead for at least five years. GPT-6 Luna checks exact versions; uncertain cases wait for the founder. This local activation includes existing content and has its own 50¢ cumulative review budget per waveform. It does not restore local voice-testing quotas or activate hosted enforcement.

Use Node.js 24:

```sh
nvm use
npm ci
FLOWPATH_LIVE_ENABLED=0 npm run dev
```

Open http://127.0.0.1:3220. Live voice is paused by default: tapping the waveform explains that state without requesting the microphone or creating a paid session. The waveform rendering remains animated.

For real Google accounts and normal visitor/admin behavior, see [the full localhost runtime](docs/local-app.md). The fixture commands below are a separate synthetic test harness.

## Local account preview

```sh
FLOWPATH_ACCOUNT_MODE=local FLOWPATH_LIVE_ENABLED=0 npm run dev
```

Choose **Create your waveform**, then a clearly labeled test owner. Save a waveform name, voice and initial prompt and choose **Preview draft**. The voice selector shows a short language/regional description; Marin remains the default for existing waveforms. Saved prompt and voice changes apply to new conversations. Its stable `/w/<id>` address requires that same owner to be signed in. A second test owner cannot read its prompt or open/start/close its private conversation. Account controls disappear while talking; the existing opening/closing motion is retained.

Choose any accent using the native color picker or a six-digit hex code. The personal waveform, interface accents and subtly tinted background share that color, with contrast adjustments for readability. An optional JPEG, PNG or WebP photo (up to 5 MB) is cropped into a small portrait in the browser, validated and re-encoded server-side, then saved privately with the waveform. It replaces the personal logo, glides upward with the waveform over 800 ms and stays visible above it while talking. Remove it to return to the logo. The main FlowPath page and new accounts default to blue (`#3a66ff`), sampled from the P in the FlowPath logo. Existing saved colors remain unchanged.

The initial prompt allows 15,000 characters. The editor preserves drafts beyond that size and disables Save with a visible warning; it never clips a long paste. A live character counter shows the limit. Previously clipped text cannot be reconstructed automatically, so prompts at the former 4,000-character boundary get a reminder to re-paste the original if needed. This app limit is separate from GPT-Live's documented 16,384-token instructions limit, which must also accommodate the platform instructions. Saved instructions do not add conversation memory or tools. GPT-6 Luna uses no reasoning effort, standard service, a bounded output ceiling, no web tools and no application retries or model fallback. The Text Box tool is registered only when the creator enables that plugin. Both models receive the saved persona context; GPT-Live delivers results in character. See [delegation setup](docs/reasoning-backend.md).

The two identities are synthetic fixtures, not real Google/Firebase accounts. Their opaque HttpOnly sessions expire after five days or a server restart. Synthetic settings persist in the new Git-ignored `.local-waveforms/` directory; sign out and back in as the same test owner to retrieve them. Do not use this fixture mode for private or production data. The application never accesses Studio's private runtime directory for accounts.

Google and verified email/password sign-in use Firebase, with a server-only Firestore adapter. New members need a single-use invitation; returning members sign in normally. The new launch project is **FlowPath Studio** (`flowpath-studio`), separate from the existing TheVoice project and News. Its web app and Standard Firestore database have been created. Hosting, provider activation, the private OpenAI secret and custom-domain connection are tracked in [the launch record](docs/firebase-launch.md); source preparation alone does not mean the service is live.

Public mode explicitly requires the configured HTTPS origin and transactional voice limits. Personal waveforms additionally require durable Firebase sessions and invitation membership. `FLOWPATH_PUBLIC_DEMO_ENABLED=1` enables a three-minute homepage demo that introduces FlowPath, answers general questions and explains the two links. An opaque, HttpOnly visitor cookie and a page UUID scope its allowance and cancellation; they grant no account access. A stable visitor cookie now limits the demo to one three-minute reservation per UTC day, including refreshes and concurrent tabs. The cookie stays stable so existing calls can close safely. Public demos share the existing global usage and concurrency caps, and use the same server supervision and independent deadline as personal calls. The page identifier retains cancellation scope; the stable cookie allowance and separate Studio demo budget supplement the global spending bound. Clearing cookies or changing devices can create another anonymous identity. Local fixtures remain loopback-only and development-only. App Hosting supplies browser SDK defaults through its associated web app and server access through managed identity; no private key download is needed. See [architecture](docs/architecture.md).

Live testing requires explicit approval for the app, host, task and call budget. Only after that approval may development use FLOWPATH_LIVE_ENABLED=1 with already-configured server credentials. Do not create/copy keys or change private environment files. Normal conversations end at 15 minutes, and the browser closes after 45 seconds of silence. Each local process admits at most three provider starts, including failures. Public mode additionally requires durable allowances and an independent authenticated closure task; incomplete configuration stays paused. See the dated verification notes for actual live results.

The verified founder Google account has an [Admin testing switch](docs/admin-testing.md) in My waveform settings. On opens its own waveform directly. In the validated full localhost app, the user's October 26 choice removes daily, restart, silence and app-imposed elapsed-time quotas for that founder test. Hosted testing retains its 15-minute maximum and shared capacity limits. Off restores regular-user rules; other accounts never receive the switch or an override. Account and confirmed-cleanup checks remain in every mode.

In bounded hosted mode, the shared daily budget counts reserved blocks, not measured talking time. A personal/admin conversation reserves 15 minutes when admitted; ending early does not return that block. Four starts can use a 60-minute budget; a 120-minute budget can fit eight without other usage. Ordinary homepage demos reserve three minutes. The explicitly unmetered local founder-testing mode is exempt from those quota gates; existing counters are preserved.

## Optional conversation diagnostics

Open `http://127.0.0.1:3220/?diagnostics=1` (or add `?diagnostics=1` to your private waveform URL). The ordinary waveform stays unchanged. In the diagnostics panel, explicitly select **Record my next conversation locally**, then start the waveform. Capture is off by default and consent applies to one conversation. This switch does not enable live voice or bypass any usage, ownership or cancellation limits.

The panel captures GPT-Live's input/output transcript fragments, relative timing, observed handoff requests, cumulative usage and browser media-state changes. Choose **Mark problem** when a reply feels wrong, **Review log** for a readable snapshot, and **Save log** to download JSON on your device. Review the text before sharing it. **Stop recording** leaves the voice running; **Clear log** discards the report and prevents late capture. Reports live only in this tab's memory. Refreshing or leaving discards them, and starting a new conversation replaces the old report. There is no automatic upload, browser storage, server transcript log, raw audio recording or additional model call.

Transcriptions can be imperfect; input and output can overlap and arrive unevenly. A handoff event identifies its target, not the user's intent or the model's private reasoning. An unavailable-capability context acknowledgment, when delivered to the browser, confirms accepted context rather than speech. Only a valid provider closure event marks finalization confirmed. The exported report preserves fragment timing and delivery order without inventing completed turns. Capture is bounded to 2,000 events and 120,000 transcript characters, with an explicit truncation flag.

The small recorder in `lib/voice-diagnostics.ts` is independent of React, accounts and the server, so the same report format can be used by future voice hosts. News remains independent. This implementation is locally verified with synthetic events; live provider event delivery still needs a separately authorized listening test.

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
- lib/voice-diagnostics.ts and components/VoiceDiagnostics.tsx: explicit, browser-memory conversation diagnostics and local export.
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
