# FlowPath Studio Firebase launch

Prepared October 18, 2026. This is the new waveform product, not the archived Studio builder.

## Confirmed resources

- Project: `flowpath-studio` (FlowPath Studio), project number `317729996674`.
- Web app: `1:317729996674:web:0536b9d2047044fffe199b`.
- Database: `(default)`, Firestore Standard, `us-east4`.
- Existing TheVoice project `thevoice-93998` and News are untouched.
- Twenty-five single-use invitations were published. Their plaintext is in a private, Git-ignored `.local-invites/` batch file; Firebase contains hashes only. Codes expire after 30 days.
- Blaze was activated by the user. The `flowpath-studio` App Hosting backend is linked to the web app; Google/email sign-in and the `flowpath.studio` authorized domain are configured. The expiry queue and its scoped service identities are configured with three closure attempts.
- The first rollout, `build-2026-10-18-001`, failed during preparation with `fah/misconfigured-secret`: metadata-only checks found correct backend IAM access, but no `OPENAI_API_KEY` versions. The user privately added version `1`, now confirmed enabled; its value remains unread. The next build and rollout, `build-2026-10-18-002`, completed successfully. Cloud Run is ready and directs 100% of traffic to this revision; an HTTPS HEAD request to the Firebase-provided hostname returned `200`.
- All five generated apex/`www` DNS records were saved in Squarespace and verified on all four authoritative nameservers. The Squarespace parking preset's apex A, `www` CNAME and apex HTTPS hint were removed; mail/security records and `_domainconnect` were preserved. App Hosting has `www.flowpath.studio` configured to redirect to `https://flowpath.studio`.
- Both custom domains currently report `OWNERSHIP_ACTIVE`, `HOST_NON_FAH` and `CERT_VALIDATING`, with reconciliation in progress. Their DNS status snapshots can lag the authoritative records. Custom-domain HTTPS HEAD checks still fail during the TLS handshake, including when directly resolving to the correct App Hosting address; certificate provisioning is incomplete.
- Custom-domain HTTPS, real user sign-in and paid voice remain unverified. The successful rollout and default-hostname HTTPS check do not establish those flows.

Local verification passed `npm run check` (95 unit/integration tests, lint, types and production build) and 31 isolated browser checks. Independent review found a provider-ID recovery gap; it was fixed and rechecked before rollout. These tests use synthetic Firebase/voice fixtures. Real invitation hashes were published, database rules were deployed, and infrastructure metadata was verified; real user sign-in and paid voice remain separate verification.

## Application and usage

`/` retains the FlowPath welcome waveform. `/account` supports Google and verified email/password with an invitation code for joining. `/w/<id>` remains private to its owner. Firebase can contain an identity before invitation redemption; that identity has no application access. News is independent.

The prepared hosting profile permits one 900-second reservation per member per UTC day, 3,600 seconds across the beta, and two simultaneous conversations. Every attempt consumes its full reservation, including short or failed calls. These are conservative beta allowances, not measured paid balances. Customer billing is absent. Public homepage visitors cannot start paid voice anonymously.

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

The new apex A record replaced Squarespace's four website A records (`198.185.159.144`, `198.185.159.145`, `198.49.23.144`, `198.49.23.145`). The old `www` CNAME to `ext-sq.squarespace.com` and apex HTTPS hint were also removed with the parking preset. Mail/security records and `_domainconnect` remain intact. Both domains share the certificate challenge CNAME; keep it for renewal. DNS/TLS can take up to 24 hours after the required changes are saved. App Hosting now recognizes both ownership claims, but its host checks still show `HOST_NON_FAH` and certificates remain `CERT_VALIDATING`; authoritative DNS verification does not yet establish working custom-domain HTTPS.

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
