# Visitor voice and chat QA

The release gate has three distinct layers: deterministic contracts, isolated browser execution, and bounded live model/device evaluation. Chat and voice share published references, workspace operations, search authorization and rendering. Chat does **not** exercise microphone permission, WebRTC, Live delegation, speaker playback or voice interruption; passing chat is not proof of voice quality.

## Changes in this pass

- Session creation returns validated audio SDP while the server control connection is still opening. Browser audio negotiation and sideband setup overlap. The existing combined readiness gate still blocks microphone transmission and greeting until the browser and server acknowledge readiness. Knowledge and media publication reads run concurrently. Starting voice while already browsing preserves the scroll position and visible subject. No speculative paid requests or automatic retries were added.
- Voice navigation normalizes `entity:` IDs and now resolves the corresponding published entity details correctly for the backend continuation.
- Voice instructions allow stable general background about a resolved published subject, distinguish publisher-specific claims, and use current attributed web findings when needed. A detail question alone does not mandate search. Publisher web/annotation opt-ins still apply. The assistant is instructed not to announce tools or searches; visible activity indicators remain useful feedback.
- The focused subject, the full discoverable published directory, and observed website/workspace position remain available. Large browser scene summaries include browse items even when there are no open workspace objects.
- Voice retains at most six server-returned search evidence summaries (2,400 answer characters and six sources per result), and only includes results still referenced in the current validated browser context. Browser labels cannot manufacture this evidence. The cache is per voice session, not a persistent knowledge source.
- Chat has a separate bounded `answer` field for explanations. An explanation leaves cards in place and appears as ordinary text rather than an error. Display batches still require validation and browser application. Recent conversation and the same general-knowledge policy enter its prompt.

- Browser QA exposed a browse-mode CSS rule that hid the voice dock and mode switch. Those controls now remain reachable while browsing long pages. The pending-chat test now uses an explanatory request, since exact item opening is intentionally handled locally without an HTTP request. Legacy browser fixtures were updated to the complete website surface and to distinguish hidden workspace objects in Browse mode from geometrically offscreen objects. Browser groups use separate data directories to prevent a failed group from exhausting another group's synthetic site limit.

- A live chat check identified an HTTP 400 schema rejection. Zod emitted `oneOf` for workspace operations; the provider wire adapter now converts it to supported `anyOf`, while runtime Zod validation remains strict. A regression walks both chat and voice schemas to check unions and required properties. See [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas).

- A real browser regression exposed comparisons being added behind Browse mode. New non-focused workspace results now reveal the workspace, and acknowledgments reject required objects that remain hidden. Chat explanations stay reachable above focused cards and can be dismissed without changing the workspace.

## Run one area at a time

Use Node 24. From this repository:

```sh
node scripts/test-visitor-qa.mjs --unit-only
node scripts/test-visitor-qa.mjs
```

The full runner builds the application, then runs voice/chat, search, workspace and website browser groups separately on port 3225. Each group uses synthetic demo data and mocked providers; the connected development server on 3220 stays running. The runner stops at the first failed group and writes `report.json` plus numbered logs to a fresh temporary folder printed in the terminal. Playwright retains failure screenshots and traces in `test-results/platform`; inspect a failed group before rerunning it. There are no paid retries.

Focused commands after a production build:

```sh
npm run test:browser -- tests/browser/visitor-realtime.spec.ts
npm run test:browser -- tests/browser/visitor-quality.spec.ts
npm run test:browser -- tests/browser/search-explore.spec.ts
npm run test:browser -- tests/browser/adaptive-workspace.spec.ts
npm run test:browser -- tests/browser/published-website.spec.ts
```

## Required acceptance scenarios

| Scenario | Expected behavior | Evidence layer |
| --- | --- | --- |
| Cold and warm voice start | Record request, SDP, control readiness, browser readiness and first audio separately; mic/greeting never start early | Mock ordering + actual device |
| Open a published named place or alias | Exact published reference opens; backend receives its details; no success before browser acknowledgment | Contract + browser + live selection |
| “Tell me more about this place” | Resolve focused subject; stable public background is allowed; preserve screen; no unnecessary search | Policy contract + live selection |
| Ambiguous “West Point” | Ask which location when context cannot establish identity; never confuse a public place with a publisher's private offering | Live evaluation |
| Current opening hours or price | Prefer qualified published facts; never invent current business details; search only if enabled and needed | Contract + live evaluation |
| Explicit web/image search | Authorized search returns a useful view or an honest error; no false claim of results | Provider mock + browser + bounded live |
| Open image A2 / source 2 | Resolve current result identifiers, not catalog order; no new search | Contract + browser |
| Search with a full workspace | Follow existing capacity/temporary-result rules; fail before paid search when placement is impossible | Contract + browser |
| Follow up on a fetched result | Reuse server evidence for that result; attribution retained; unknown browser IDs provide no evidence | Contract + live selection |
| Manual action during a pending reply | Cancel stale work; preserve newer screen; no late success | Contract + browser |
| Home, then a new request | Clear temporary views and resolve references from the new screen | Contract + browser |
| Provider, validation or permission failure | Visible actionable error, operational failure event, useful browsing retained | Contract + browser + device |

## Diagnostics

Development visitor pages have a collapsed **Developer diagnostics** panel. Browser events also appear in the browser console; server events appear in the local server terminal with prefix `[flowpath:visitor]`. Match their UUID `traceId` values. For chat/search, a succeeded browser event follows application of the response, not merely an HTTP success. A voice backend success alone is not proof that speech was audible; inspect browser `first_audio` and actual device behavior.

The allowlist contains only channel, stage, status, HTTP error status when available, elapsed time, revisions, operation kind and counts. It excludes prompts, transcripts, uploaded text, raw errors, provider bodies, SDP, URLs and credentials. The in-memory panel keeps the latest 400 events, resets with the process/page, and adds no database writes. Console retention is controlled by the running environment. This is diagnostic instrumentation, not billing accounting or analytics.

Summarize a locally saved server log:

```sh
node scripts/summarize-visitor-diagnostics.mjs /path/to/local-server.log
```

Only sanitized diagnostic lines are summarized. It reports failure stages and p50/p95 durations. Startup timings are cumulative from the start of the respective browser/server segment; do not subtract timestamps across those clocks. Use repeated cold/warm runs and separate permission wait, provider/session delay, control connection delay and first audible output. This pass proves overlapping work, **not a measured live latency reduction**.

## Live evaluation and remaining limits

Use a dedicated published test site and an agreed budget (at most three paid triggering actions if no number is given). First test an exact entity opening, then a general-background follow-up, then an explicit image search. Record the requested behavior, selected tool, browser acknowledgment, visible result and timing. Stop on unexpected calls, retries or permission prompts. Never treat a model's claim as an execution result.

For model quality, retain a small synthetic transcript corpus with expected actions and forbidden claims, run the identical cases when prompts change, and review failures by category: identity, retrieval, tool selection, validation, placement, rendering or speech transport. Mocked answers prove wiring, not semantic judgment. Real speech recognition, iOS startup protection and audible latency still require a human-operated microphone/speaker test.

Chat currently routes explicit searches through the shared search UI, while voice can choose a search tool itself. Chat does not import the voice session's server evidence cache, and a new voice session starts with an empty evidence cache. Do not claim complete conversational parity or cross-session verified web memory. General model knowledge stays explanatory; it never becomes publisher-approved catalog data.

## Code map

- `lib/visitor-realtime-session.ts`, session API route: provider startup, overlapped SDP delivery, publication/usage checks, cleanup.
- `lib/use-visitor-session.ts`: browser readiness, microphone gating, playback and startup diagnostics.
- `lib/visitor-realtime-control.ts`: backend guide, subject/evidence context, tools, acknowledgments and execution diagnostics.
- `lib/visitor-knowledge-context.ts`: shared knowledge authority policy and focused subject projection.
- `lib/visitor-workspace.ts`, `lib/visitor-provider.ts`: separate chat-answer versus voice-tool contracts.
- `components/VisitorAssistant.tsx`, `components/SearchExplore.tsx`: visible chat answers and browser operation diagnostics.
- `lib/visitor-diagnostics.ts`, `components/VisitorDiagnostics.tsx`: metadata allowlist and bounded development panel.
- `scripts/test-visitor-qa.mjs`, `scripts/summarize-visitor-diagnostics.mjs`: reproducible test groups and diagnostic summary.
- `tests/visitor-diagnostics.test.ts`, realtime session/control tests, `tests/browser/visitor-quality.spec.ts`: new regressions alongside existing search/workspace suites.

## Verification recorded for this pass (2026-09-13)

- Full offline QA runner completed successfully: 73 focused contract tests; production build; 53 browser checks (15 lifecycle, 20 voice/chat quality, 7 search, 9 workspace, 2 website).
- Separate full unit/rendering run passed 341 server tests and 21 rendering tests; lint and build/type validation passed.
- Diagnostic summary was exercised with synthetic input and retained only allowlisted fields.
- Two live chat actions were attempted on local GoSite. They failed; the instrumented second attempt identified an HTTP 400 schema rejection. The schema adapter was subsequently corrected and checked offline. Other simultaneous voice activity appeared in server logs, so agent-triggered live testing stopped. A successful post-fix live answer, image search and physical microphone/speaker latency remain unverified.
- Local connected server remained listening on 127.0.0.1:3220. The implementation is local; this report is not deployment evidence.

Recoverable diagnostic failures use `console.warn` while retaining `status: failed` in the panel and logs; they do not generate a Next.js console-error overlay. The visitor-facing failure message remains visible. Browser backend failure events use `sessionElapsedMs` for time since session start, never `durationMs`: that value does not measure a backend request or establish a timeout. Match the trace and revision with server diagnostics to investigate the actual failure.

### Waiting feedback

`LoadingIndicator` supplies a shared indeterminate, politely announced status with a static reduced-motion alternative. Visitor chat, voice connection/thinking and search operations show a viewport-pinned status so a focused card or scroll position cannot hide progress. Card web additions also show an inline busy state and disable duplicate requests until completion, failure or cancellation. Studio work, knowledge interpretation, photos, sign-in/out, site creation, preview loading, activity and billing preview loading use the same indicator. Loading state follows existing request lifetimes; no timers simulate progress or trigger retries. The delayed card-search browser regression checks visibility, duplicate prevention and cancellation cleanup using mocked requests.
