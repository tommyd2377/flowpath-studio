# Privacy-safe observation boundary

`lib/analytics-events.ts` defines a vendor-neutral, strict allowlist. `lib/analytics-sink.ts` supplies a no-op default and a bounded in-memory test adapter. No analytics SDK, vendor, cookie, browser storage, network delivery or persistent user identifier is introduced. External delivery requires a separate provider, consent and retention decision.

## Events

Every event has `schemaVersion: 1`, a fresh telemetry `eventId` UUID, integer epoch-millisecond `occurredAt`, `source: client | server`, `platform: web | ios | android`, `eventName` and `properties`. There is no arbitrary metadata map. `validateAnalyticsObservation` and `validateAnalyticsEvent` reject unknown keys at every level, unknown enums, malformed envelopes, accessors and custom prototypes; successful output is detached from its input.

| Event | Allowed properties |
| --- | --- |
| `session_visited` | `surface`, `visit: first_in_tab | return_in_tab` |
| `waveform_viewed` | `surface` |
| `demo_started` | Empty properties object; emit after observed connection. |
| `demo_ended` | `reason` |
| `navigation_selected` | `destination: home | account | news | private | public` |
| `creation_step` | `step: opened | editing | review_pending | review_approved | review_rejected | saved | published`; `outcome: success | blocked | failure` |
| `voice_start_requested` | `surface` |
| `voice_connected` | `surface` |
| `voice_ended` | `surface`, `reason` |
| `paywall_shown` | `mode: creator | intro | visitor` |
| `payer_selected` | `payer: creator | self` |
| `usage_observed` | Server only: integer `seconds` from 0 through 86,400; `evidence: provider_confirmed | ledger_committed` |
| `cost_observed` | Server only: integer `amountMicrounits` from 0 through 1,000,000,000,000; `currency: USD`; the same `evidence` enum. One microunit is one millionth of a currency unit. |

`surface` is `home | account | private | public`. `reason` is `user | silence | limit | navigation | failure | unknown`. Use fixed reason labels; never forward an exception message or provider reason verbatim. Do not treat a clock estimate as confirmed usage or cost. The bounds are telemetry validation limits, not a price or entitlement choice.

The tab-visit label supports observation of return navigation during the current page session. The candidate keeps only generic surface labels in tab/module memory; these labels do not identify or join people across account changes. A future persistent delivery adapter must define its identity/consent reset explicitly. It does not measure cross-session retention or unique people. Do not derive the event UUID from an account, visitor cookie, admission, provider session or ledger operation. Version 1 intentionally carries no waveform or user ID.

No prompts, transcripts, audio, names, emails, cookies/tokens, owner IDs, private/public waveform IDs, provider IDs, raw payloads, URLs or free-form errors are accepted. Explicit local conversation diagnostics remain separate and must never be passed to this boundary.

## Host integration

```ts
const analytics = createAnalyticsRecorder({ source: 'client', platform: 'web' });
analytics.record({ eventName: 'waveform_viewed', properties: { surface: 'public' } });
analytics.record({ eventName: 'navigation_selected', properties: { destination: 'account' } });
// Before replacing the host or identity:
analytics.close();
```

`record(unknown)` returns `false` for invalid input, a closed recorder or a synchronous delivery failure. `true` means only that validation passed and delivery was attempted. Asynchronous rejection is swallowed without retaining/logging the error; it is not a delivery acknowledgment. Invalid observations are rejected before a timestamp/event UUID is generated. Exceptions from clocks, UUID factories and sinks cannot escape into host cleanup. No retry is performed.

`noopAnalyticsSink` is the default. Synthetic tests can opt into `createInMemoryAnalyticsSink({ maxEvents })`, whose default capacity is 100 and maximum is 1,000. It drops additional events when full, deduplicates retained telemetry event UUIDs, returns detached `snapshot()` values and supports `clear()`. `close()` erases the buffer and blocks late writes. Keep the buffer local to its host; close it on identity changes/navigation. No export function is provided.

Only server code should create a recorder with `source: 'server'` for confirmed usage/cost observations. The source label itself is not authentication, proof of a provider event or financial authority. Billing emits an observation after the authoritative committed operation; do not make a ledger transaction depend on sink delivery. Consumers must tolerate missing, duplicate and forged events.

Analytics must never admit a session, change balances, reset allowances, choose a payer, issue credit, charge, refund, settle usage or decide provider cleanup. Those operations remain authoritative in the existing server modules, even if analytics fails or is disabled.

## Verification

```sh
node --import tsx --test tests/analytics-events.test.ts
```

Synthetic tests cover every event, bounds/enums, client metric rejection, privacy rejection, detached snapshots, capacity, deduplication, clear/close and synchronous/asynchronous sink failure isolation. They make no live provider call and establish no real-world usage, cost, cross-session retention, external delivery or deployment claim.
