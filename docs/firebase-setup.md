# Firebase setup

Firebase mode adds owner accounts, Firestore persistence, and private Cloud Storage uploads. The default localhost demo remains available without cloud configuration. This guide prepares a dedicated development project; no project ID is assumed, and local demo data is not migrated automatically.

The repository includes persistent mocked and local checks. Those checks do not prove live provider configuration, IAM, deployed rules, OAuth, or storage access. Running them does not create a Firebase project, change account settings, deploy rules or start an emulator. See the [architecture](architecture.md) for the implemented data boundaries.

## User setup in Firebase

These are manual administrator steps for the project owner. Keep the project separate from existing apps: the included rules deny all browser access across the selected database and bucket, so applying them to a shared project could break another application.

1. Choose a dedicated development Firebase project and register a web app. Record its web configuration locally. Google Analytics is not required by this app.
2. Enable **Email/Password** and **Google** in Firebase Authentication's sign-in providers. Complete any Google provider configuration yourself. The app uses Firebase's web sign-in SDK, then exchanges the resulting ID token with its own server for a session cookie. [Email/password setup](https://firebase.google.com/docs/auth/web/password-auth), [Google setup](https://firebase.google.com/docs/auth/web/google-signin), [session-cookie flow](https://firebase.google.com/docs/auth/admin/manage-cookies).
3. In Authentication settings, authorize the exact development hostname you will use. The default app address is `http://127.0.0.1:3220`, so its hostname is `127.0.0.1`; use `localhost` only if you intentionally configure and browse that hostname instead. Do not enter a scheme, port, or path in the authorized-domain field. Firebase no longer automatically authorizes `localhost` in projects created after April 28, 2025. Keep the browser origin and `VOICE_APP_ORIGIN` identical. [Authorized-domain guidance](https://firebase.google.com/docs/auth/faq-and-troubleshooting).
4. Create the **default Firestore database**, using **Standard edition / Native mode** and production rules. Choose the database location deliberately before creating it. [Firestore setup](https://firebase.google.com/docs/firestore/quickstart).
5. Create or select the project's private Cloud Storage bucket. **Cloud Storage for Firebase requires the Blaze billing plan.** Any plan selection, billing attachment, cost approval, or resource creation must be completed by you. No-cost allowances do not guarantee no charges. Use the actual bucket name from your project; do not assume its suffix. [Current Storage requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024).
6. Review and apply `firestore.rules` and `storage.rules` through the appropriate Firebase rules editors. These files are artifacts only; saving them in this repository does not deploy them. Also ensure bucket IAM/ACLs do not grant public access, and use public access prevention where appropriate. The app does not create public ACLs or Firebase download tokens. [Firestore rules](https://firebase.google.com/docs/firestore/security/get-started), [Storage rules](https://firebase.google.com/docs/storage/security/get-started), [bucket public access prevention](https://docs.cloud.google.com/storage/docs/public-access-prevention).

## Configure the app locally

Use Node.js 24. Set these values yourself in your local, Git-ignored environment configuration or your chosen deployment environment. Do not paste credentials into chat, logs, or repository files.

| Variable | Value |
| --- | --- |
| `VOICE_BACKEND` | `firebase` to opt into cloud mode; leave unset for the local demo |
| `VOICE_APP_ORIGIN` | Exact dashboard origin, initially `http://127.0.0.1:3220`; use HTTPS for a deployed app |
| `FIREBASE_PROJECT_ID` | Your dedicated project's ID |
| `FIREBASE_WEB_API_KEY` | The web app's Firebase API key |
| `FIREBASE_AUTH_DOMAIN` | The web app's configured Firebase Auth domain |
| `FIREBASE_APP_ID` | The registered web app's Firebase app ID |
| `FIREBASE_STORAGE_BUCKET` | The bucket name, without `gs://` or a URL path |

The Firebase web configuration is delivered to the browser for authentication. Admin credentials are not. Server access uses the Admin SDK's `applicationDefault()`: provide an already configured, authorized service-account credential through `GOOGLE_APPLICATION_CREDENTIALS`, or use a suitable workload identity in the hosting environment. Never place a private key in a client variable or `NEXT_PUBLIC_*` configuration. The project owner must configure the runtime identity and permissions for Firebase Authentication/session management, Firestore, and the selected private bucket. Admin SDK calls bypass Firestore Security Rules, so server authorization and IAM remain essential. Plain end-user credentials from a default `gcloud` login are not sufficient for every Firebase Authentication operation. [Admin SDK and ADC setup](https://firebase.google.com/docs/admin/setup), [server access and IAM](https://firebase.google.com/docs/firestore/security/get-started).

Firebase mode fails closed when required configuration is missing; it does not silently fall back to the shared local demo owner. Restart the app after changing configuration. Keep cloud mode off for offline checks unless the check explicitly supplies mocks.

## Data and access model

The browser uses Firebase Authentication only. It does not read or write Firestore or Cloud Storage directly. The Next.js server verifies the session and derives the owner UID before handling private site operations.

| Location | Purpose |
| --- | --- |
| `voiceSites/{siteId}` | Scalar owner/summary fields plus serialized JSON site state containing draft, published state, history, messages, and file metadata |
| `voiceSlugs/{slug}` | Unique slug-to-site mapping |
| `voiceOwners/{sha256(uid)}` | Per-owner site count |
| `voicePublished/{slug}` | Approved site snapshot and server-owned allowlist of published image descriptors |
| `voiceKnowledgeJobs`, `voiceKnowledgePrivate` | Owner-scoped import/review status and immutable catalog artifacts with private source origins |
| `voiceKnowledgePublic` | Source-free catalog projections, served only when referenced by the current publication |
| `voiceMediaPrivate`, `voiceMediaPublic` | Immutable reviewed media libraries and publication-gated manifests |
| `voiceAiRequests`, `voiceAiUsage`, `voiceAiOwners` | Connected owner generation reservations, daily counters and cooldown |
| `voiceVisitorUsage/current` | Separate deployment-wide visitor attempt ledger |
| `voicePlatformEvents/{siteId}` | Bounded operational observations and provider-reported usage |
| `owners/{sha256(uid)}/sites/{siteId}/{fileId}` in Storage | Private document bytes; image children use `display.webp`, `thumb.webp` and `original` |

The serialized site state is capped at 750,000 UTF-8 bytes. Older chat messages and draft history are trimmed when needed to stay within that cap; current content and uploaded text are retained. An edit that still exceeds the cap is rejected. The SHA-256 owner key makes document and object paths safe for Firebase UIDs; ownership checks still use the verified UID, not knowledge of a path.

Uploads are stored before their metadata transaction. A rejected revision or content limit removes the newly uploaded object. If the cloud response is ambiguous, the private object is retained to avoid deleting a file whose metadata may already have committed. Failed deletions can also leave private orphan objects; review and reconcile these before adding automated cleanup.

Both rules files deny all client reads and writes, including signed-in clients and published Firestore records. The public app route renders only the published snapshot and its referenced catalog/media projections. The public image route permits the chosen logo and approved photos in that snapshot's allowlist. Original uploads, drafts, editor messages and private source origins remain private. Reviewed knowledge, photo descriptions and content sections become public only through publication. See [cloud storage](../lib/cloud-store.ts), [knowledge storage](../lib/knowledge-store.ts) and [media storage](../lib/media-store.ts).

## Verification before a public launch

Run `npm run check` for lint, types, persistent offline tests, the separate shared-package consumer and the production build. [Mocked knowledge transactions](../tests/knowledge-cloud.test.ts), [mocked media storage](../tests/media-cloud.test.ts) and related storage tests exercise ownership, stale revisions, publication boundaries and failure recovery. `npm run test:browser` exercises the local demo with isolated data after a build. Rules must also be validated in the selected Firebase project before launch; no emulator is started automatically.

After you complete setup, live verification still needs an explicitly approved development host and bounded action budget. Verify two different accounts cannot access each other's sites or files; a signed-out visitor sees only the current publication and its approved images; sign-out and expired/revoked sessions block private routes; and direct browser Firestore/Storage access is denied. Do not treat a successful build or mock test as proof that live rules or IAM are correct.

Optional AI proposals are described in [AI editor setup](ai-editor-setup.md), bounded text/voice replies in [Visitor conversations](visitor-conversations.md), and implemented PDF extraction and publisher correction in [Platform foundation](platform-foundation.md). Photos use the same private storage boundary; see [Photos and albums](photo-library.md). Real custom-domain routing and Stripe subscriptions are not connected. Production deployment also needs reviewed hosting/session settings, abuse controls, a monetary usage policy, and a deliberately approved migration plan if existing demo content should be retained.
