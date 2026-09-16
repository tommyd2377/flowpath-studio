# Voice and chat speed implementation

September 16, 2026 · Current working checkout · Local and mocked verification

This implements the application changes recommended in [the research report](voice-chat-speed-research-2026-09-16.md). GPT-Live and Luna remain the defaults. There are no new providers, dependencies, automatic paid retries, speculative paid sessions, deployments, or changes to credentials, billing, or infrastructure.

## Implemented behavior

| Report priority | Implementation and limits |
| --- | --- |
| 1. Immediate feedback and separate timings | Voice enters “Preparing voice…” on the click, before task preflight. A persistent indeterminate indicator follows actual retrieval, search, display, and completion stages. Work remains cancellable while the call stays connected. Startup, permission, input readiness, visual results, display receipts, search, cache, and image preparation have separate diagnostic boundaries. |
| 2. Avoid redundant model rounds | An exact, short, cited factual web lookup can return its completed answer directly. A verified simple navigation can finish from its display receipt. Comparisons, compound requests, annotations, missing citations, and requests that still need explanation continue through synthesis. A completed carousel operation no longer requires a redundant answer card. |
| 3. Reuse prepared published data | Bounded detail reads use the retained record-ID set and load only the required chunks. Cold builds coalesce; failed builds are evicted. Immutable manifests/chunks and revision-bound query evaluations are bounded caches. Field projections are reused through filtering, sorting, and facets. New publication artifacts include lexical reading derivatives. |
| 4. Stream useful information | Responses HTTP calls use a bounded SSE parser. Chat renders eligible assistant final-answer text as a separate “Answer in progress” surface; it never becomes a committed result before completion. Voice receives one coherent, completed cited answer as soon as it is validated, while display work can continue. Terminal completion still waits for required receipts. |
| 5. Reduce confirmation overhead | Visible card identity, opacity, geometry, publication, query revision, result set, and generation replace the unconditional 340 ms minimum. The display receipt supplies the initial viewport scene; only later scene changes need another request. Completed navigation receipts enter the control queue immediately after layout confirmation, preserving serialized submissions and the 150 ms rate limit. |
| 6. Prepare earlier and overlap startup | Focus/pointer intent warms the nonpaid task context with shared pending initialization. After a click, task preflight, AudioContext preparation, and microphone acquisition overlap. Paid session creation remains behind successful preflight. Cancellation releases tracks, including tracks returned after cancellation. Complete ICE gathering and the existing iOS greeting/input guard remain intact. |
| 7. Stable work and bounded reuse | Capability schema serialization is cached and placed before changing context. Prepared photo derivatives are reused with fresh publication/asset authorization and bounded capacity. Clearly nonvisual requests skip image preparation. Identical research can reuse a bounded 60-second cache within its owning task/session; freshness-sensitive queries bypass it. Text questions request text-only search. |
| 8. Reasoning and concurrent reads | The task runner accepts an explicit `none` or `low` reasoning setting for a controlled comparison; its production default stays `low`. Independent immutable storage reads use at most four workers per batch. |
| 9. Conditional provider experiments | Exa/Tavily, Fast mode, paid WebSocket warmup, managed delegation, database placement, and control-transport replacement remain experiments, as recommended by the report. No evidence yet establishes that they would improve the remaining end-to-end bottleneck. |

The progress contract is shared by chat, voice, `search_explore`, and typed task capabilities. Events carry request or generation identity. Late events, cancelled work, failures, and timeouts cannot leave provisional text committed or a loader indefinitely active. Mobile and reduced-motion checks also cover the status/control spacing. Voice and chat docks reserve the same height so switching mode preserves website scroll. Rapid close/reopen/close explicitly restores hidden state.

## Safety and compatibility

- Current publication and task authority are checked before reuse and at existing mutation/completion boundaries. Quota reservations, usage accounting, evidence validation, cancellation, and exact display receipts remain authoritative.
- The SSE reader releases only complete event frames. It never executes partial tool arguments or forwards reasoning deltas. Structural JSON is not rendered as provisional chat text. Provisional text requires an identified final-answer message, or the tools-disabled final round; unsupported intermediate message phases remain buffered.
- Search lifecycle events are diagnostic progress only. Raw search fragments are not treated as validated sources. Full search output is parsed, bounded, and validated before display or early factual delivery. Complex requests retain their final synthesis.
- Search reuse is local to a continuous voice session or one chat task, not shared between visitors or separate chat requests. Annotation targets are part of the key; publication/domain settings remain fixed by the owning task's authority checks.
- Catalog artifacts keep version 2 compatibility: manifests without reading derivatives fall back to existing full-record indexing. New/reviewed publications gain derivatives when staged; existing sites need no forced migration. Derivatives add bounded publication storage, and all existing I/O, record, chunk, and memory ceilings remain enforced.
- Each task repository caches at most 16 manifests and 64 chunks/8 MiB of serialized chunk data. Prepared images have 32-entry/8 MiB estimated limits and at most eight in-flight preparations. Query evaluation caches retain at most 32 results per immutable compiled index. These estimates exclude runtime object overhead and total process RSS.
- Existing unpublished work, concurrent recorder changes, and the shared GPT-Live core were preserved. No real microphone, paid provider, personal signed-in browser, or production service was exercised.

## Measurements

The offline benchmark compares a source copy taken before this implementation with the current query implementation. It uses the same synthetic fixture and queries, Node 24.6.0 on Darwin arm64, five warmups, and 50 samples per case. Runs include both engines in one process; the values are local function timings, not a production latency distribution.

| 10,000-record case | Baseline median | Current median | Baseline p95 | Current p95 |
| --- | ---: | ---: | ---: | ---: |
| Two filters and numeric sort | 53.39 ms | 44.61 ms | 61.40 ms | 50.15 ms |
| Same query plus Boolean/enum facets | 86.29 ms | 67.42 ms | 91.06 ms | 70.06 ms |

Those medians are approximately 16% and 22% lower. The synthetic index's estimated size is unchanged at 19,514,955 bytes. Storage, authorization, model latency, browser rendering, audio, cold process startup, and total RSS are excluded. An overall voice-speed improvement is not established by these measurements.

[Raw measurements and source hashes](research-evidence/voice-speed-implementation-benchmark-2026-09-16.json) include the 100- and 1,000-record cases. The baseline is the original dirty working checkout, not Git HEAD. The reproducible current benchmark is:

```sh
node --conditions=react-server --import tsx scripts/benchmark-visitor-speed.ts
# Optional comparison: append a directory containing the earlier source snapshot.
```

Behavioral tests establish additional concrete savings: one bounded detail chunk is read and then reused; cold index requests share one build; independent reads stay at or below four; eligible completed navigation/search skips the closing model call; an unchanged initial scene needs no second request. These are local behavior guarantees, not live cost measurements.

## Verification

- `npm run check`: lint, typecheck, **522 server tests**, **21 rendering tests**, packed-package consumer verification, and production build passed.
- `visitor-speed.spec.ts` plus focused startup/progress cases in `visitor-realtime.spec.ts`: **8 passed**, with provider/audio APIs mocked and external browser requests blocked. Includes cold startup, deferred permission cancellation, failed preflight/retry, stale progress, mobile reduced motion, provisional chat completion/cancel/failure, initial scene reuse, and subsequent viewport updates.
- `ai-carousel.spec.ts`: **11 passed**. The complete suite covers desktop/mobile mode changes, scroll/focus return, filtering, detail/back/reset, 10,000-record browsing, gallery receipts, pending work, rapid close/reopen, and mocked video. Dependent ordinal/detail/back test steps wait for exact receipts; intentional interruption is covered separately.
- New unit cases cover SSE UTF-8/frame splitting, truncation and abort, incomplete tool responses, no hidden retries, compound-request exclusions, session/freshness separation, coalesced failures, legacy artifacts, and chunk authorization/checksums. The media storage lifecycle also verifies image-cache hits, retention of context for unfamiliar visual questions, skipping explicit nonvisual questions, and rejecting a cached asset after publication revokes it.

Browser reproduction after `npm run build` (each command starts a fresh, isolated local demo on port 3225):

```sh
npm run test:browser -- tests/browser/visitor-speed.spec.ts tests/browser/visitor-realtime.spec.ts --grep 'speed:|voice startup handles|permission'
npm run test:browser -- tests/browser/ai-carousel.spec.ts
```

The entire repository browser suite was not run. The complete carousel suite and the focused speed/startup suite are the browser acceptance scope for this change.

## Still requires an approved live experiment

Live provider latency, grounded-answer quality under real model output, useful audible speech, iPhone echo/interruption behavior, and connected Firestore contention remain unverified. `result_audio_candidate` means browser-observed audio after a verified-result notification; it is deliberately not certified as the first useful spoken answer. Useful-speech latency requires a recording with annotated request and answer boundaries. Browser spans use one monotonic timeline; server spans are correlated by IDs and must not be subtracted from browser timestamps.

A live comparison should name the app/host and call budget, compare identical tasks/publications, separate cold/warm and desktop/iPhone, and score successful completion and citation quality alongside latency. Keep Luna `low` until a `none` comparison passes those checks. Three smoke-test actions cannot establish production p95. Provider migrations, paid warmup, Fast mode, and infrastructure changes require separate evidence and authorization.
