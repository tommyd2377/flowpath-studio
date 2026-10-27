# FlowPath Studio Firebase launch

Prepared October 18, 2026. This is the new waveform product, not the archived Studio builder.

## October 27 code-gated tester demo release preparation

The user authorized the temporary shared-code demo and declined automated paid tests. This supersedes the website-only and earlier $5/day OpenAI-guard plan below. Hosted voice and the approved exact-version creation-review adapter are activated by the candidate profile; Knowledge ingestion and customer billing remain off. Anonymous intro access requires the server code grant and has 180 seconds per UTC day per stable browser cookie, including the founder. An invited account’s own waveform has 180 seconds per UTC day per UID; only the verified founder’s own waveform is exempt. Codes, sign-in/out and page refresh do not reset the existing browser allowance. Clearing cookies/devices can create a new anonymous identity.

The code grant is checked on the server before voice admission, review submission or waveform saving. Real provider startup is observed only within a bounded streaming HTTP response, and a durable connected timestamp is committed after its replacement cleanup task exists. Waiting before tapping or a failed setup does not consume visitor time. Subsequent short heartbeat requests and the existing authenticated deadline queue preserve request-only CPU; there is no permanent background controller. Actual provider audio, streaming through the hosting proxy and real task closure remain the user’s manual acceptance.

Release application source **`3b93a6ecdb25afe176dbff6f37c06997409ec5dd`** was pushed normally to GitHub `main` and `codex/hosted-tester-demo`. Deployment used a clean export of **227 tracked files**, excluding archives and env/private runtime files, at `/private/tmp/flowpath-demo-release-3b93a6e-_jgh18_j` (manifest `/private/tmp/flowpath-demo-release-manifest.json`). Only App Hosting backend `flowpath-studio`, project `flowpath-studio`, region `us-east4` was deployed. Build `9eeafb73-4aed-4646-b08d-90e0652df34a` succeeded; revision **`flowpath-studio-build-2026-10-27-002`** serves **100%** of traffic. The following documentation receipt is not another application rollout.

Final validation passed `npm run check` (**373 tests**, lint, types, production build), the complete standard browser suite (**83/83**) and synthetic paid-preview regression (**8/8**). A test-selector ambiguity in the first code-gate browser run and a test-only TypeScript narrowing issue were corrected before these final complete passes. Generated client chunks contain neither the shared code nor its validation digest. A synthetic phone screenshot was visually inspected; desktop/mobile existing layout and Text Box regressions passed. Test logs are `/private/tmp/flowpath-demo-release-{check,browser,paid-browser}.log`. The user's local server and temporary test servers are off.

Anonymous non-paid HTTPS checks passed: `/` and `/account` returned 200; `/api/demo-access` returned enabled/allowed false; account readiness reported Firebase mode, no user, hosted demo and creation safety enabled; voice readiness reported disabled with the expected enter-code message; billing reported disabled. Creation review rejected unauthenticated access with its existing 403, Knowledge with 401, a synthetic private waveform lookup with 401, and cross-site account access with 403. The readiness script initially expected 401 from creation review; its actual existing unauthenticated convention is 403, so the assertion was corrected and the full check rerun. No valid code grant, account, production record, provider session, review, upload or purchase was created by these checks. Log: `/private/tmp/flowpath-demo-release-3b93a6e-readiness.log`.

Actual new revision scaling: minimum **0**, maximum **2**, CPU throttling **true**. App Hosting again reset the service-wide maximum to 20 during rollout; it was restored to **2** with service minimum **0**, without changing revision or traffic. Manual scaling/count annotations are absent: the service uses autoscaling. Old tags/revisions were retained and were not visited or changed. The separately configured native $20/month Cloud Run cap remains unchanged; it may pause hosting and does not cover all Google services or OpenAI. No always-on floor was introduced.

Real provider startup/audio, streaming delivery through App Hosting, real deadline dispatch/finalization, role/session changes during real calls and live creation-review quality are **not verified**. The user explicitly chose manual live testing and revoked the proposed paid batch. Known residuals include unknown provider IDs, lost finalization, task delays/retry exhaustion and a hosting pause while a primary browser connection exists; no guaranteed provider hard cutoff is claimed. An abruptly closed tab can race finalization before its cleanup receiver attaches and leave admission held.

Manual acceptance: refresh the website, enter the corrected shared code and verify unlocking starts no call; tap to start the introduction and confirm its three-minute connected-time cap, including when signed in as founder. Then use an invited account's private waveform and confirm its cumulative daily allowance across reconnect/refresh. For the founder's own saved waveform, use **Review this version** in settings if its exact hosted version has not yet passed, save as needed, then open it and test voice/Text Box. End through **End conversation** or the waveform control and verify a new start is possible after cleanup. Hosted Knowledge and real customer charging remain off. No auth provider, secret, billing-account setting, queue, rules, always-on resource or old traffic tag is changed by this source release. The native $20/month Cloud Run cap was configured separately and is not raised or cleared here.

## October 27 website/settings release

The user explicitly authorized deploying the current limited version while the next hosted beta is built. Scope: App Hosting website/settings, current UI/loaders and private drafts. Hosted voice, Knowledge ingestion/retrieval, creation-review inference and payments remain disabled. Existing auth providers, secrets, rules and production user data are unchanged. The website may return from its manual-zero pause to request-based autoscaling with a zero-instance idle minimum and existing maximum of two; no warm instance or always-allocated CPU is requested. The local server should be off whenever active local testing is finished, per the latest user instruction.

The subsequent version targets hosted voice, Knowledge and safety, payment-free publishing, 180 seconds total/day per regular signed-in account across waveforms, and an authenticated founder exemption including the introduction waveform. Those features are not asserted active by this website/settings release. The next beta also requires the owner-approved combined $5/day operating budget, advance alerts and approval before increases. This website/settings release does not claim that a cross-vendor billing hard cap or budget notifications are implemented; AI operations remain off. Release source `53a3ede0df39698bfe26ee844c44c529b34da0c7` was pushed normally to GitHub `main` from `codex/voice-lifecycle`. A clean export of 218 tracked files (excluding the source archive, private runtime and env files) was deployed only to App Hosting backend `flowpath-studio`, project `flowpath-studio`, region `us-east4`. Cloud Build `705f5f26-3b7b-493d-b406-e5395f89be5c` succeeded; ready revision `flowpath-studio-build-2026-10-27-001` serves 100% of traffic. No Firestore rules, auth provider, secret value or billing-account setting was changed.

The rollout replaced the old manual-zero pause with autoscaling. Verified new revision: minimum 0, maximum 2, CPU throttling enabled (CPU allocated during requests). App Hosting reset the service-wide maximum to 20 during rollout; it was reduced to 2 with service minimum 0, without creating a new revision or changing traffic. All five retained tagged older revisions have minimum 0 and maximum 2, but still retain their historical always-allocated CPU configuration; they receive no percentage traffic. Their tags remain reachable, so minimum 0 does not prove that no older instance could ever incur cost. No old tag was requested or changed during verification.

Anonymous HTTPS checks returned 200 for `/` and `/account`; account readiness reported Firebase mode and no user, session readiness reported `enabled: false`, billing reported `enabled: false`, creation review reported `enabled: false`, and Knowledge rejected an anonymous request with 401. Knowledge's local-only runtime gate remains closed in hosted mode. The first verification script incorrectly expected a `creationSafetyEnabled` account-response field; that field is absent, so review readiness was checked on `/api/creation-review` instead. This was a verification assertion error, not an application failure.

The in-app browser origin permission gate denied the visual smoke check. Rendered pages, signed-in settings, live voice and real provider behavior are therefore **not browser-verified in this release**. No paid call, upload, account creation or production-data write was performed. The local server and temporary test servers are off. Source validation passed `npm run check` (350 tests, lint, types, build) and seven focused mocked browser checks; the broader preceding UI/draft source also passed 77 standard and eight synthetic paid-preview browser checks.

## October 27 Workspace/draft release preparation

The user requested committing, pushing and deploying the current version. Source validation passed `npm run check` (348 unit/integration tests, lint, types, production build), 77 standard browser tests and eight synthetic paid-preview browser tests. Workspace settings, shared loaders, startup request cancellation/parallel reads and private draft versus explicit publication are included. The current application code matches the checked source-only copy.

Read-only deployment preflight confirmed backend `flowpath-studio` in `us-east4`, latest ready revision `flowpath-studio-build-2026-10-19-001`, with Cloud Run service-level manual scaling set to **zero**. The existing hosted admission code gate, live-payments gate and local-only Knowledge/review activation remain. A release of this candidate alone does not activate the full local voice/Knowledge/review experience. Hosting reactivation versus a paused-source rollout needs a clear release decision; do not silently change manual scaling, enable voice, create credentials or activate paid features.

## October 27 hosting pause and lifecycle prerequisite

The separate billing investigation reports user-requested manual scaling to zero and zero-instance metrics; the public hosted app/voice are reported unavailable. This thread has not independently inspected production or session records. Firebase Auth/Firestore and local voice routing are separate and preserved. The deployment/availability evidence below is historical.

The isolated [lifecycle candidate](voice-lifecycle.md) closes hosted starts in code and makes known-session cleanup request-owned with durable settlement fencing. It does not establish an active hosted voice worker, an upstream hard cutoff or unknown-ID recovery. Following direct user approval in this chat, source `apphosting.yaml` sets `minInstances: 0`, `cpuAlwaysAllocated: false` and `FLOWPATH_LIVE_ENABLED: "0"`. The earlier forwarded-approval retry was rejected and stopped; the later direct approval permitted the source-only patch. See the lifecycle handoff for the approval history and verification.

These are candidate source settings, not a deployment or a change to the actual paused service. No cloud setting, secret, permission or service was changed here. Review source and actual scaling together before any future release, and obtain explicit deployment/reactivation authorization. The separate reported production pause is preserved; zero minimum instances does not eliminate all cloud/storage costs.

## Confirmed resources

- Project: `flowpath-studio` (FlowPath Studio), project number `317729996674`.
- Web app: `1:317729996674:web:0536b9d2047044fffe199b`.
- Database: `(default)`, Firestore Standard, `us-east4`.
- Existing TheVoice project `thevoice-93998` and News are untouched.
- Twenty-five single-use invitations were published. Their plaintext is in a private, Git-ignored `.local-invites/` batch file; Firebase contains hashes only. Codes expire after 30 days.
- Blaze was activated by the user. The `flowpath-studio` App Hosting backend is linked to the web app; Google/email sign-in and the `flowpath.studio` authorized domain are configured. The expiry queue and its scoped service identities are configured with three closure attempts.
- The first rollout, `build-2026-10-18-001`, failed during preparation with `fah/misconfigured-secret`: metadata-only checks found correct backend IAM access, but no `OPENAI_API_KEY` versions. The user privately added version `1`, now confirmed enabled; its value remains unread. Build `002` established hosting, and the corrective build and rollout `build-2026-10-18-003` completed successfully.
- All five generated apex/`www` DNS records were saved in Squarespace and verified on all four authoritative nameservers. The Squarespace parking preset's apex A, `www` CNAME and apex HTTPS hint were removed; mail/security records and `_domainconnect` were preserved. App Hosting has `www.flowpath.studio` configured to redirect to `https://flowpath.studio`.
- Custom-domain HTTPS is verified: `https://flowpath.studio/` returns `200`, and `https://www.flowpath.studio/` returns `302` to the main HTTPS address.
- Initial public acceptance exposed App Hosting's rewritten transport Host. The verified transport is `flowpath-studio-317729996674.us-east4.run.app`; the deployed correction pins `FLOWPATH_TRUSTED_PROXY_HOST` to that exact host and requires a single canonical `X-Forwarded-Host`. Account, voice and authenticated expiry share the policy. Exact browser Origin, membership, owner and OIDC checks remain intact.
- The initial deployed anonymous checks passed: `/api/account` returned `200` with Firebase mode and managed SDK configuration enabled; `/api/session` returned `200` with the then-required sign-in message. Cross-origin writes, cross-site reads and account requests through the default Firebase hostname returned `403`; expiry without authentication returned `401`. A separate anonymous browser verified the invitation, Google and email signup form. No identity, invitation, reservation or paid provider session was created by these checks. Real signup, authenticated task delivery and paid voice remain user/live verification.

Local verification passed `npm run check` (95 unit/integration tests, lint, types and production build) and 31 isolated browser checks. Independent review found a provider-ID recovery gap; it was fixed and rechecked before rollout. These tests use synthetic Firebase/voice fixtures. Real invitation hashes were published, database rules were deployed, and infrastructure metadata was verified; real user sign-in and paid voice remain separate verification.

The hosting-proxy follow-up passed `npm run check` with 98 unit/integration tests and all 31 isolated browser checks. Independent review confirmed exact proxy/forwarded-host matching, unchanged browser Origin and local fixture rules, and retained task OIDC authorization. No paid provider call was made.

The public welcome follow-up enables a three-minute anonymous homepage conversation and adds matching News/account corner links. Its separate prompt explains FlowPath, invites general questions, and accurately describes the independent News example and invitation-only account flow. Personal prompts remain isolated. `npm run check` passed all 122 unit/integration tests, lint, types and production build; all 33 isolated browser checks passed, including simultaneous-tab readiness and navigation cleanup. Independent review found no remaining blocker.

Source commit `cc3edfa` was deployed as `build-2026-10-18-004`; deployment succeeded and the ready revision serves 100% of traffic. Public HTTPS returned `200`, with `www` still redirecting to the canonical address. Fresh anonymous readiness returned `enabled: true` and issued the expected Secure/HttpOnly/SameSite=Strict host cookie with private/no-store caching; the next readiness check retained the same identity. Anonymous account readiness remained Firebase mode with no signed-in user. Private waveform, cross-site readiness, cross-origin writes and direct-backend readiness returned `403`; unauthenticated expiry returned `401`. An isolated anonymous browser verified both corner links and the welcome page. These checks created no account, reservation or paid provider conversation. Real listening remains user verification.

The greeting/startup follow-up, source commit `a81ac75`, was committed and pushed on `codex/simple-waveform`, then deployed as `build-2026-10-18-005` with 100% traffic. The public greeting now briefly explains FlowPath and invites natural conversation and interruptions while retaining both link directions. Connecting/Getting ready status follows setup and the first unblocked output audio; the transport and 800 ms motion are unchanged. `npm run check` passed 122 unit/integration tests, lint, types and production build; all 34 isolated browser checks passed, including delayed first speech, per-call reset and blocked playback recovery. Independent review found no introduced blocker. Deployed HTTPS, public readiness and the same access guards passed again, and the new status strings were verified in the served client scripts. No paid voice call was made for these checks; real speech and listening remain user verification.

The October 19 combined release, application source `f8ffbbe`, was pushed to `codex/simple-waveform` and deployed as `build-2026-10-19-001`. It includes the Studio label and per-refresh public allowance, browser-only opt-in diagnostics, and the logo's blue default while preserving saved colors. The current source passed `npm run check` with 138 tests and all 38 isolated browser checks; independent release review found no blocker. The upload manifest contained 85 tracked files and no private or untracked files. Existing deployment configuration, dependencies, auth providers, secret references and global limits were unchanged.

App Hosting confirms the new build serves 100% of traffic, with active apex and `www` certificates. Anonymous HTTP and browser checks verified the blue homepage, Studio label, normal page without diagnostics, and unchecked diagnostics controls at `/?diagnostics=1`. Served scripts contain diagnostics and per-page identifiers. HTTPS returned `200`; `www` redirected with `302`. Public readiness returned enabled with a Secure/HttpOnly/SameSite=Strict visitor cookie that remained stable on a repeated check. Account readiness returned Firebase mode without a user; private-waveform, cross-site and direct-backend readiness returned `403`. No account, invitation redemption, voice reservation or paid provider conversation was created during release verification. Real provider transcript delivery and listening remain separate user/live verification.

## Application and usage

The homepage adds Studio beneath the existing logo, and a per-page public identifier makes refresh start a fresh 180-second allowance. The visitor cookie stays stable, legacy cleanup remains supported, and the shared budget and member limits are unchanged. These changes are live in the October 19 combined release above. Desktop, mobile, landscape, reduced motion, private appearance and late cleanup remain covered by synthetic checks.

`/` offers the FlowPath welcome waveform, with FlowPath News example at the top left and Create your waveform at the top right. Both links remain available during the welcome conversation. `/account` supports Google and verified email/password with an invitation code for joining. `/w/<id>` remains private to its owner. Firebase can contain an identity before invitation redemption; that identity has no application access. News is independent.

The hosting profile permits one 180-second public reservation per page visit and one 900-second reservation per member per UTC day, sharing 3,600 seconds per UTC day across the beta and two simultaneous conversations. Refreshing supplies a new page UUID; repeated starts on the same page reuse its allowance. Every attempt consumes its full reservation, including short or failed calls. The anonymous Secure/HttpOnly/SameSite=Strict cookie plus page UUID identifies usage only and grants no account access. These are soft usage scopes; the shared budget remains the spending bound. Unknown visitor cancellation IDs consume the same allowance, preventing unlimited cancellation records. These are conservative beta allowances, not measured paid balances. Customer billing is absent. `FLOWPATH_PUBLIC_DEMO_ENABLED=1` enables public starts; pausing it preserves cleanup of known conversations.

App Hosting runs the deployed standard Node.js 24/Next.js server. Runtime metadata confirms CPU throttling is disabled, a service-level minimum of one instance, a revision maximum of two, concurrency of 80, and a 300-second request timeout. One warm instance and up to two instances incur ongoing Cloud Run usage. The explicit build/run commands avoid reliance on preview Next 16 adapter behavior. Browser Firebase defaults must be injected at install/build time by linking the web app to the backend; do not disable install scripts or copy real SDK keys into source.

## Activation sequence

1. The user activates Blaze with their selected existing billing account. Do not open payment details or accept legal terms for them. The user has granted a narrow exception for this project's Blaze activation; other financial safeguards remain in force.
2. Create the backend linked to the new web app. This provisions its managed runtime identity and necessary App Hosting services:

```sh
firebase apphosting:backends:create --project flowpath-studio --backend flowpath-studio --primary-region us-east4 --app 1:317729996674:web:0536b9d2047044fffe199b --root-dir / --non-interactive
```

3. Enable Google and email/password in Firebase Authentication. Use the FlowPath Studio OAuth brand, confirm the support contact, and authorize `flowpath.studio`. Preserve the default `flowpath-studio.firebaseapp.com` auth helper domain; do not change the client authDomain to the custom site.
4. The user enters an OpenAI API key privately into the new project's Secret Manager as `OPENAI_API_KEY`. Never read/copy the local key or print a secret. Grant only the new backend access:

```sh
firebase apphosting:secrets:grantaccess OPENAI_API_KEY --project flowpath-studio --backend flowpath-studio --location us-east4
```

5. Provision the independent closure queue with finite retries and a dedicated task identity. These tasks only close existing conversations; they never create paid conversations:

```sh
gcloud services enable cloudtasks.googleapis.com --project=flowpath-studio
gcloud iam service-accounts create flowpath-voice-expiry --project=flowpath-studio --display-name="FlowPath voice expiry"
gcloud tasks queues create flowpath-voice-expiry --project=flowpath-studio --location=us-east4 --max-attempts=3 --max-retry-duration=10s --min-backoff=10s --max-backoff=30s --max-doublings=1 --max-dispatches-per-second=1 --max-concurrent-dispatches=3 --log-sampling-ratio=0
gcloud tasks queues add-iam-policy-binding flowpath-voice-expiry --project=flowpath-studio --location=us-east4 --member="serviceAccount:firebase-app-hosting-compute@flowpath-studio.iam.gserviceaccount.com" --role="roles/cloudtasks.enqueuer"
gcloud iam service-accounts add-iam-policy-binding flowpath-voice-expiry@flowpath-studio.iam.gserviceaccount.com --project=flowpath-studio --member="serviceAccount:firebase-app-hosting-compute@flowpath-studio.iam.gserviceaccount.com" --role="roles/iam.serviceAccountUser"
gcloud iam service-accounts add-iam-policy-binding flowpath-voice-expiry@flowpath-studio.iam.gserviceaccount.com --project=flowpath-studio --member="serviceAccount:service-317729996674@gcp-sa-cloudtasks.iam.gserviceaccount.com" --role="roles/iam.serviceAccountUser"
```

The newly enabled Cloud Tasks API creates its normal service agent role. Do not add broad Token Creator roles. Verify queue settings before enabling voice. Task OIDC audience and target are both `https://flowpath.studio/api/voice-expiry`; the application verifies the signature, audience and task identity. Check that hosting forwards Authorization during deployed verification.

6. Run the local checks, review and commit, then deploy only this backend:

```sh
npm run check
npm run test:browser
firebase deploy --only apphosting --project flowpath-studio
```

7. Add `flowpath.studio` through App Hosting's custom-domain wizard and add `www.flowpath.studio` as a redirect to `https://flowpath.studio`. These exact generated records are now **saved in Squarespace and verified on all four authoritative nameservers**:

| Type | Squarespace host | Value |
| --- | --- | --- |
| A | `@` | `35.219.200.199` |
| TXT | `@` | `fah-claim=023-02-71ffda3c-da4d-46f9-aabd-c44791ee6e84` |
| A | `www` | `35.219.200.199` |
| TXT | `www` | `fah-claim=023-02-2ca884c9-cdce-4524-b22d-45a5ec159dcc` |
| CNAME | `_acme-challenge_iovrwfvptd5miz7t` | `2ae0c608-1113-454f-bf10-111a1a5bb19f.8.authorize.certificatemanager.goog` |

The new apex A record replaced Squarespace's four website A records (`198.185.159.144`, `198.185.159.145`, `198.49.23.144`, `198.49.23.145`). The old `www` CNAME to `ext-sq.squarespace.com` and apex HTTPS hint were also removed with the parking preset. Mail/security records and `_domainconnect` remain intact. Both domains share the certificate challenge CNAME; keep it for renewal. After provisioning completed, public HTTPS and the `www` redirect were verified independently.

8. Verify HTTPS, invitation rejection/redemption, both sign-in paths, settings privacy/persistence, task authentication, and closure. Real sign-in/verification mail and paid voice remain separate from synthetic checks; user credentials and microphone permission require user interaction.

## More invitations

From an already authorized admin development environment:

```sh
npm run invites:create -- --project flowpath-studio --count 25
```

The explicit project protects the old app. A private recovery file is flushed before one atomic hash-only publication. A failure is marked NOT_CONFIRMED and is not automatically retried; do not share or regenerate that batch blindly. No codes appear in logs, source, or deployment archives.

## Operational limits

Normal timers and an independent task close sessions at their deadline, but queue delivery can be late. If creation succeeds and its response/identifier is lost, the application cannot identify that provider; durable admission stays blocked for investigation. If a known ID is received but initial persistence fails, uncertain cleanup preserves the ID for a fresh worker. Never clear an uncertain reservation merely because its timer or day expired, and never claim a REST acknowledgment confirms final usage.

Official references: [App Hosting configuration](https://firebase.google.com/docs/app-hosting/configure), [managed Firebase SDK defaults](https://firebase.google.com/docs/app-hosting/firebase-sdks), [custom domains](https://firebase.google.com/docs/app-hosting/custom-domain), [HTTP tasks and OIDC](https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks), [queue retry semantics](https://docs.cloud.google.com/tasks/docs/reference/rest/v2/RetryConfig).
