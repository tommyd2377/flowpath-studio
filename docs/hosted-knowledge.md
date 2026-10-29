# Private hosted Knowledge — October 29

Deployed October 29 from application source `8fdeee28b09daca67398e99045b93d6aeccf8660` as `flowpath-studio-build-2026-10-29-001`, serving 100% of traffic. The owner requested hosted Knowledge before the production rollout and approved a $5/month estimated document-storage guard. Accounts, existing voice allowances, the 50¢ per-waveform review budget and disabled customer payments are unchanged.

## Activation and privacy

`FLOWPATH_KNOWLEDGE_ENABLED=1` explicitly activates the existing managed retrieval adapter only in the production Firebase `flowpath-studio` configuration at `https://flowpath.studio`, with live service and the approved creation-safety policy enabled. Missing/mismatched configuration fails closed. The existing runtime secret binding is reused; no credential, provider permission, rule, scheduler or billing setting is created or changed.

Only the current signed-in owner can upload, select, search or remove their library. Uploads require an explicit 18+ and upload-permission self-attestation; the server checks its confirmation header before parsing the file. This is self-attestation, not identity verification. Private files never become public/paid-waveform material or enter the anonymous Franklin demonstration. Model tools remain selected server-side from reviewed, selected documents. Public document publication remains out of scope.

The hosted library uses the existing production `waveformKnowledge` collection. Full-local testing uses the isolated `localStudio_` namespace, so local sample files are not automatically migrated. The owner can upload the desired references into the hosted library after release. Files remain with OpenAI until explicitly removed; no inactivity expiration or automatic deletion is added.

## Storage guard

The approved target is $5/month **for this app's hosted document storage**. `knowledge-storage-budget.ts` tracks current estimated storage capacity, not customer credits, payments or refunds. Using the documented $0.10/GiB/day rate, a 31-day month and no free-tier assumption gives approximately 1.61 GiB of steady indexed capacity. Each pending upload conservatively reserves 1 GiB before any provider side effect. Once indexing reports verified `usage_bytes`, that reservation becomes the reported amount. This deliberately limits simultaneous ingestion; an owner can wait for preparation to finish before another upload. Existing 10 MB/file and 20 documents/waveform limits remain.

A reservation, metadata mutation and platform total change share a database transaction. UUID replay cannot create or reserve twice. Invalid accounting blocks ingestion. Unknown creation/upload outcomes keep their holds and explicit reconciliation records. Confirmed authorization refusals are distinguishable from network/5xx uncertainty and can be cleaned up without inventing an unknown resource. Reported overrun blocks more uploads while retaining the user's documents. Capacity is released only after confirmed file/index cleanup, idempotently. Refresh, month changes and analytics events do not grant capacity or money.

This is an **estimate/admission guard, not a provider billing hard cap**. Parsed index size can differ from source size or the provisional estimate; retained storage keeps accruing charges until removal. The guard excludes local libraries, other applications, voice, model delegation, reviews and hosting. It cannot control provider price changes or resources created outside this application. Founder Knowledge settings show the estimate/target, indexing reservations and a notice near 80%; there is no automatic email or external budget notification. Direct vector-store search is used, rather than a Responses `file_search` tool call; delegation/model charges remain separate.

References: [Retrieval storage](https://developers.openai.com/api/docs/guides/retrieval), [pricing](https://developers.openai.com/api/docs/pricing), [indexed-file usage](https://developers.openai.com/api/reference/resources/vector_stores/subresources/files/methods/retrieve).

## Deletion and failure behavior

Remove disables a document before contacting the provider. The adapter verifies deletion of both its vector-store association and original file. Removing the last document also deletes the empty search index. Not-found responses are idempotent success; an unconfirmed deletion retains the entry and reservation with an explicit retry action. A library removal lock prevents concurrent ingestion/deletion from deleting a newly attached file. Unknown identifiers require reconciliation rather than a false success report. Selection and exact-review state are rechecked after every search, including eventual provider deletion consistency.

## Verification

Source-only isolated checks passed lint, generated types/TypeScript, **435 source tests** and the production build. The full mocked browser suite passed **114/114**, including desktop/mobile adult consent, retention/budget notice, all existing account/voice/carousel/Streamdown behavior and resource cleanup. The final focused Knowledge browser pass also passed 3/3 after the authorization-refusal handling adjustment. Unit coverage includes concurrent global reservations, idempotent measurement/removal, isolation, overrun/corrupt accounting, known refusal versus unknown outcomes, last-index cleanup, failed cleanup/racing intake and strict hosted configuration.

Codex made no live provider request, production upload, search, review, voice call or account change for these checks. Provider permissions and real hosted document processing still need owner/live acceptance after rollout; source/mocked success is not that evidence. Only temporary isolated fixture servers run during checks; the regular local app is stopped. The [deployment receipt](firebase-launch.md#october-29-plugin-and-private-knowledge-release) records successful HTTPS/access checks, active hosted configuration and preserved zero-to-two instance scaling.
