# Prompt context and model-round speed pass — September 27, 2026

This implements the highlighted follow-up to [the earlier mobile/speed pass](qa-mobile-speed-design-2026-09-27.md): duplicated context and unnecessary model rounds. Changes use shared publisher contracts; the live restaurant is test content, not runtime routing logic. Existing unrelated working-tree changes remain intact.

## Changes

- **Lossless per-round prompt data:** chat and voice serialize `currentView` once. Exact repeated server-returned objects and long strings share references defined by an application-owned manifest. Matching IDs alone never merge facts, and publisher fields that resemble references remain literal unless the manifest identifies them. Historical views cannot become current-screen evidence. Old tool replies remain self-contained.
- **Complete-request accounting:** payload measurements include developer guidance, tools, input and cache framing. The final synthetic restored-reading fixture falls from **87,729 to 81,201 bytes (7.4%)**, with exact expanded-data equality. That is a controlled size check, not a measured latency improvement.
- **Compact capability definitions:** repeated schemas and authorization/demo metadata share exact definitions, with explicit exceptions preserved. The published registry falls from **35,934 to 25,014 bytes (30.4%)** versus its unfactored form; this is a separate component measurement, not an additional 30% reduction of the whole request. Dense 24-record follow-ups, retained research and long category descriptions remain within the unchanged 48 KB task-context ceiling.
- **Fewer closing rounds for display-only filters:** the existing model-selected completion option accepts polite phrasing and media collection subjects. It still requires a complete acknowledged query; questions, comparisons, calculations, research and enrichment continue through the model. This does not add a deterministic gallery fallback.
- **Combined query and comparison:** `query.compare` applies typed filters/scope/sort and compares the complete set in one operation. Exactly two to six matches are required; no silent truncation, relaxation or first-page substitution. Existing query evidence can feed `selection.compare` directly without a record-ID copying round. Further calculations remain separate dependent work.
- **No impossible local probes:** live chat skips the local-command round trip only when the shared syntax gate proves that the existing parser cannot handle that form. Published field names and meanings still resolve on the server. The route's cancellation/save behavior and model handoff guards remain unchanged.

The implementation follows the principle of reducing unnecessary calls and repeated context in OpenAI's [latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization), without assuming that input-size savings translate proportionally into response-time savings.

## Live chat evidence

The coordinator used the normal configured provider through the Codex in-app browser at the approved local Cuts & Slices visitor page. No worker made paid calls. Today's existing $5 cap was carried forward, including its retained reservation; it was not reset. No voice connection was started.

Recordings: `97751106-155e-405e-b5c2-d4221451e889` and `bf96dbe3-f599-4c49-b8b7-2b0fec68386b`. Private JSONL and ledgers remain ignored local artifacts. Times below are individual development-server observations from submission, including preparation and display acknowledgment. They are not controlled performance benchmarks.

| Request | Result | First visible | Committed | Model calls |
| --- | --- | ---: | ---: | ---: |
| Complete menu, cold setup | 62 structured items | 3.86 s | 4.26 s | 0 |
| Polite vegan slice filter below $8, descending | $7.50, $6.75, $6.75 in requested order | 8.27 s | 10.06 s | 1 |
| Two of first result and one of second | Correct $21.75 before-tax estimate | 6.24 s | 9.68 s | 2 |
| Same quantities, whole pies, before final probe change | Correct $149.15 before-tax estimate | 8.30 s | 13.25 s | 2 |
| All photos | 10 published images | 2.45 s | 2.90 s | 0 |
| Only the vegan photo | Correct photo displayed; later synthesis blocked by the QA guard | 7.36 s | Failure, not successful completion | 1 sent |
| Compare vegan whole pies below $50; calculate two of each | `query.compare` → `prices.total` → `present_answer`; correct $167.50 | 7.89 s | 15.28 s | 3 |
| Explicit two-Speciality/one-Veggie slice estimate | Correct $21.75 | 6.66 s | 9.93 s | 2 |
| Same quantities, whole pies, after probe change | Correct $149.15; **zero command probes** | 8.97 s | 12.52 s | 2 |
| Polite vegan-slice filter below $1, final prompt format | Correct empty result; no relaxed filter or invented matches | 8.10 s | 9.12 s | 1 |

The earlier polite-filter sample used two model requests and committed in 12.05 s. This pass proves that redundant request was eliminated; the 10.06 s observation is not a stable speedup guarantee. The whole-pie request previously spent 1.47 s probing a local parser that could not accept it. The final run eliminated that probe, but its first model call took 5.43 s versus 3.26 s in the earlier same-pass sample. First-result latency therefore did not improve consistently. The compound request finishes all requested work within three model calls; the previous interrupted compound run provides no valid completed baseline for comparison.

The photo failure was **not** provider throttling or budget exhaustion. After showing the correct photo through `update_workspace`, the next round included the active image; the current local guard has no supported media-input cost bound and refused it before sending. Paid tests paused for diagnosis, and subsequent text tests started from a fresh view. The guard was not disabled and no automatic retry was added.

## Remaining work

1. First results are still too slow on several model-mediated requests. Further work should target repeated preparation/publication reads and needless closing synthesis while retaining semantic decisions, complete outcomes and receipt authority.
2. Model choice of the photo path remains variable; photo display succeeded here but full completion could not be live-verified under the text-only guard. Add an explicit bounded media accounting policy before testing image-bearing follow-ups.
3. The resumed-frontline voice test exposed a separate last-six-history cutoff. The subsequent fix below resolves its original assertion; physical-iPhone recall and startup latency still need live verification.

## Verification and closeout

- **203/203 focused server tests pass**, covering exact prompt/schema reconstruction, dense contexts, compound comparisons, display-only completion, stale publications, cancellation, workspace authority and query/control adapters. Evidence: `/tmp/flowpath-complex-final-tests-20260927.log`.
- At the prompt/round pass close, the separate conversation-recall suite was **5/6 passing**. The existing resumed-frontline assertion was retained rather than weakened; all 28-message backend retention assertions passed. Historical evidence: `/tmp/flowpath-conversation-recall-envelope-final-20260927.log`. The subsequent memory fix below resolves that failure.
- This pass made **14 paid model requests**, conservatively accounted at **$0.527439**. Including the earlier pass, cancelled-request reservation and retained voice allowance, today's cumulative accounted amount is **$1.445950 of $5**, leaving **$3.554050**. These are conservative local ledger amounts, not provider billing totals.
- The live recorder and local development server are stopped. Recordings and budget ledgers are preserved; the local guard remains in place. Further paid testing requires a fresh active recording configured against the remaining allowance.
- **Lint, typecheck and production build pass.** Logs: `/tmp/flowpath-complex-lint-20260927.log`, `/tmp/flowpath-complex-typecheck-20260927.log`, `/tmp/flowpath-complex-build-20260927.log`.
- **11/11 isolated browser speed tests pass** with mocked providers: impossible-probe bypass, ambiguous handoff, repeated submission, interruption, partial text/failure handling, settled display acknowledgments, scrolling observations and desktop/mobile status behavior. Evidence: `/tmp/flowpath-complex-browser-20260927.log`. The temporary browser-test server exited, and no listener remains on ports 3220 or 3225.
- Physical-iPhone and audible voice behavior are not verified by these chat tests. No publication or deployment changed. Existing unrelated working-tree changes were preserved; this pass was not committed or pushed.

## Subsequent resumed-voice memory fix

The user asked to continue concrete improvements independently while discussing note 15. The smallest confirmed reliability issue was the resumed voice startup's extra `.slice(-6)` cutoff. The backend had the complete accepted history, but the frontline voice lacked an earlier hypothetical assumption after twelve exchanges.

`visitor-realtime-control.ts` now sends the accepted completed-history prefix once per connection. The existing 32-message / 24,000-byte serialized-history limit remains unchanged. Roles, exact text, qualifications and chronological corrections remain intact; history is untrusted reference data rather than published truth or an instruction to repeat old work. The last unfinished user fragment stays excluded. Repeated readiness cannot replay history or start unsolicited speech. No summarizer, extra model round, per-round replay or history acknowledgment wait is added.

The root independently reran recall, realtime-control, conversation-history and live-context tests: **118/118 pass**, including the original oldest-assumption assertion, full backend retention, chronological corrections, silent resume, long/escaped text, maximum history and one-time replay. Log: `/tmp/flowpath-resume-memory-root-20260927.log`. Scoped lint and TypeScript no-emit also pass.

Tradeoff: a maximum fixture with 24,000 bytes of accepted history produces 27,254 bytes of labeled context in bounded append messages; the tested conservative content ceiling is 27,296 bytes, excluding transport framing. A longer reconnect can therefore send more context than the prior six-message replay. Physical-phone startup time, model recall quality and live token impact were not measured in this offline fix. It does not promise unlimited or durable cross-visit memory.

No paid API call, server start, publication, deployment, commit or push occurred in this follow-up. The day's earlier API accounting is unchanged.

## Subsequent mobile and recovery pass

The [mobile composition and recovery report](qa-mobile-refinement-2026-09-27.md) continues this work under the same daily allowance. Fresh local reads now avoid workspace rewrites, invalid field/reference calls receive bounded repair guidance, and the guard supports the configured low-detail photo input. Its live photo retest passed that guard and displayed the photo, but the provider connection closed during the final answer; this is separate from the earlier text-only guard rejection. The newer report owns current cumulative cost, browser verification and remaining work. Earlier measurements and limits above remain historical evidence.
