# Invitation-only hosted beta

October 27, 2026. Target requested by the owner after `fd97f9c`; this document distinguishes the intended release from implemented/verified behavior. The hosted app is still manually scaled to zero. Nothing here enables production voice, paid APIs or deployment.

## Confirmed release behavior

- Payments stay disabled. No checkout, purchase, subscription or assumed minute-pack price is part of the beta. Usage is platform-funded.
- Accounts retain the existing invitation and Firebase identity boundaries, one free waveform each, and the approved 18+ eligibility requirement. Existing Google sessions must keep working. Founder authority comes from verified server identity/role, never an email-string comparison or account merge.
- The introduction waveform retains its ordinary three-minute visitor allowance. Regular signed-in accounts get 180 seconds total per UTC day across all waveforms, not 180 seconds for each waveform. Refresh, a second tab or a new waveform must not renew the allowance. Confirmed usage/holds must remain server-authoritative and concurrency-safe.
- The verified founder account has no artificial daily/start-count/session-duration/silence quota on the introduction, private draft or owned published version. Connection cleanup, revocation, version approval, concurrency and unresolved-session protections still apply; these are not minute packs.
- Save draft, Preview draft, Publish / Update published version and View published version retain the `fd97f9c` separation. Ordinary viewers never receive private draft content or instructions.
- Knowledge files remain creator-private and are kept until deleted. Public document sharing requires a separate explicit version/publication/revocation design; it is not implied by publishing a waveform.
- Creation review uses the existing approved policy and GPT-6 Luna, with the existing 50-cent cumulative budget per owner/waveform. Pending, changed, rejected or manual-review-required versions cannot execute or publish through a direct API call.

The owner subsequently selected a combined $5/day operating budget across founder and visitor usage, with advance notification and explicit approval before any increase. This total includes voice, delegation, review, documents and hosting. The founder is exempt from personal minute/session quotas, but not this shared operating budget. The application should warn before exhaustion (proposed warning at $4) and reject new paid work when its conservative budget is exhausted. Provider billing lag, ongoing storage and hosting charges prevent promising an exact cross-vendor invoice ceiling. Enforcement and notifications are not implemented by the website/settings release; inference remains off. No provider billing-account setting or notification transport has been changed.

## Current readiness

| Area | Status |
| --- | --- |
| Existing local app and draft/publication/UI contracts | Committed and pushed as `fd97f9c`; local server was stopped per the latest operating preference. |
| Hosted creation-review adapter | Source now supports explicit production opt-in with a pinned approved policy preset or valid JSON policy. Firebase mode/project/origin checks fail closed. Actual hosted configuration is unchanged. |
| Production voice execution | Still gated. An HTTP handshake followed by orphan process-local sockets/timers is insufficient on request-scoped hosting. Active supervision, recovery/cancellation and acceptance of lost creation/finalization outcomes remain required. |
| Founder introduction exemption and regular shared daily allowance | Confirmed requirements, not yet wired into hosted admission. Existing local founder behavior remains unchanged. |
| Payment-free publishing/visitor routing | Needs explicit separation from the sandbox billing gate. Do not make checkout available or grant wallet credits to simulate a free beta. |
| Hosted Knowledge | Still gated pending operating controls, indexing/deletion recovery and hosted acceptance. Private source ownership and selected-document revocation must remain enforced. |
| Eligibility and retention | 18+ and keep documents until deletion are confirmed. Hosted enforcement/wording and the separate moderation-record retention period still need completion. |
| Deployment/live acceptance | Not performed for this beta. No new credentials, cloud resources, provider calls, production data or billing settings changed. |

## Provider evidence

Official documentation checked October 27: [session close/final usage](https://developers.openai.com/api/docs/guides/live-conversations#usage-and-graceful-close), [WebRTC connection sequence](https://developers.openai.com/api/docs/guides/voice-webrtc#understand-the-connection-sequence) and the OpenAPI definition of `POST /v1/live/sessions`. A valid `session.closed` confirms finalization; a dropped transport does not establish final usage. A configurable WebRTC hard expiry and recovery lookup for a lost creation identifier have not been established. Do not infer those guarantees from SIP limits or a scheduled cleanup task. See [voice lifecycle](voice-lifecycle.md).

[OpenAI pricing](https://developers.openai.com/api/docs/pricing) lists GPT-Live at $0.05/minute, with backend models/tools separate. That means a three-minute conversation is $0.15 in voice alone; backend work, documents and hosting are additional. WebRTC starts have a 15-second initialization charge credited against running-session usage, rather than added on top of it. No price is hard-coded into customer products by this document.

Use mocks and test-mode fixtures for source work. Any live acceptance needs explicit app/host/task/call-budget approval. Keep hosted AI admission closed until the agreed beta is ready. The separately authorized website/settings release restored request-based hosting with zero minimum instances; this does not activate voice or other inference.
