# FlowPath waveform architecture

The browser connects audio directly to GPT-Live over standard WebRTC. The application server creates and supervises the same session through a sideband WebSocket. The application has no delegated model or tool executor.

The waveform host owns visuals and browser media. Short application instructions define platform limits. A private waveform adds its saved name and initial prompt when a conversation starts; edits apply to subsequent conversations. Each call uses empty starting history and store:false. The provider may retain data under its own policy: store:false is not a zero-retention guarantee.

## One owner, one waveform

The home waveform stays available without an account. `/account` holds sign-in and a small form for name, voice and initial prompt; `/w/<id>` is the owner's private waveform. Each verified account has one settings record with a random stable ID, name, voice, initial prompt and update time. Updates preserve that ID; no usernames, custom domains, multiple waveforms, publishing workflow or dashboard are introduced.

Voice choices and short language/regional descriptions live in `lib/voice-options.ts`, sourced from the [official GPT-Live voice options](https://developers.openai.com/api/docs/guides/live-conversations#voice-options). The server accepts only those registered names and sets `audio.output.voice` when creating a conversation. Voice changes apply to the next conversation. Legacy records and requests without a voice retain Marin by default; loading a legacy record does not rewrite the saved file. No sample playback, extra speech model, custom voice creation or automatic paid preview is added.

The browser sends only the waveform ID when requesting a voice session. The server verifies the owner's HttpOnly session and reads the owner's saved record, rather than accepting a prompt or owner ID from the session request. Private readiness, creation and teardown enforce the same ownership and waveform scope. Saved instructions are snapshotted once and cannot enable search, tools or delegated models. The greeting follows that waveform's saved identity.

Identity changes invalidate in-flight admission and clear private UI state across tabs. Sign-out and account switching ask the voice controller to confirm closure before replacing the current cookie; a pending or uncertain teardown keeps the old identity until it can finish. Browser cancellation retains the original waveform endpoint. Local cancellation tombstones are scoped to the owner and waveform.

`FLOWPATH_ACCOUNT_MODE=local` explicitly enables two labeled synthetic owners during development. Opaque random session cookies map to server-held identities, with a five-day expiry and no browser-stored UID authority. Synthetic settings use atomic, serialized writes in the new ignored `.local-waveforms/` directory. Restarting the server clears authentication sessions but retains settings. Fixture mode is not authentication for a public service.

Firebase mode is implemented separately and never selected automatically from old credentials. Google sign-in uses the Firebase browser SDK with in-memory persistence; an ID token is exchanged for an HttpOnly application cookie, then browser Firebase state is cleared. The server uses the Admin SDK to verify recent Google sign-in, verify session cookies and access one Firestore document per verified UID in `ownerWaveforms`. A transaction preserves the ID under concurrent initial saves. Returned records are validated. For this local milestone, only cookies issued by the current process are accepted, so a server restart also requires Firebase sign-in again.

Firebase activation requires a separately selected project and confirmed Standard database edition. The dormant runtime expects explicit `FLOWPATH_ACCOUNT_MODE=firebase`, `FLOWPATH_FIRESTORE_EDITION=standard`, project/database selection and public Firebase web-app configuration under `FLOWPATH_FIREBASE_*`. Server credentials would use an already authorized Application Default Credentials setup. No environment files or credentials were inspected or changed in this milestone. Legacy Firestore rules remain unchanged; they must be reviewed for the selected database before activation. The browser never accesses Firestore directly, and Admin SDK access relies on server ownership checks and IAM rather than client Security Rules.

Both account modes remain unavailable in production and on remote hosts. Local account verification uses fixtures and fake Firebase adapters, with no real sign-in or Firestore traffic. Public deployment, durable customer allowances and visitor access require a later milestone; these local session limits are not a customer entitlement system.

Official Firebase references: [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin), [server session cookies](https://firebase.google.com/docs/auth/admin/manage-cookies), and [server access versus Firestore rules](https://firebase.google.com/docs/firestore/security/rules-conditions).

## Voice lifecycle

Live is disabled unless development mode explicitly opts in. Readiness is checked before microphone access. Local requests require a loopback host and matching origin; bodies and SDP are bounded, and non-audio media is rejected. A browser-generated UUID identifies a local reservation so a canceled handshake can still close a late-created provider session. Provider IDs stay on the server.

The controller admits one local session, up to three starts per minute and at most three provider starts for the entire local process, including failed starts. It has a 30-second startup watchdog and a 180-second absolute cap from the confirmed creation response. Browser inactivity closes after 45 seconds of silence. These local test limits are distinct from future customer trial accounting. Normal closure waits for session.closed and final usage; uncertainty blocks new starts. No automatic retries are performed.

Standard WebRTC is the starting transport. WARP and hosting optimizations are deferred until actual latency is measured. Deployment runtime supervision, durable public quotas, concurrent owner budgets and payment reconciliation remain future work.

News is an independent application. Later a News module will own its data, actions, settings and panel, while this host retains voice, accounts, usage and opening/closing views. No plugin framework or sibling source dependency is introduced now.

## Official references

- https://developers.openai.com/api/docs/guides/voice-webrtc?api=live
- https://developers.openai.com/api/docs/guides/live-conversations
- https://developers.openai.com/api/docs/guides/live-prompting
- https://developers.openai.com/api/docs/guides/voice-server-controls?api=live

GPT-Live standalone conversational quality is unverified. Mocked connection tests do not establish provider behavior or physical microphone/playback quality.
