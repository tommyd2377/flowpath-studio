# Recorded voice handoff repair — September 24, 2026

Scope: the three recordings explicitly supplied in this task. All were stopped by the tester and report zero dropped recording events. The recorded source hashes matched the checkout at the start of this audit. No raw audio is present; output transcript text shows generated speech, not proof of what was audible. No hidden model reasoning was inspected or inferred.

## Findings

| Recording / local time (EDT) | Evidence | Cause or limit |
| --- | --- | --- |
| `a9d135b1-eb48-45c2-b75b-c0d56ea06c8c`, 13:06–13:08 | The recorded research and calculation completed, then “comparison … cheapest” became an ascending price sort. | A keyword shortcut discarded the comparison part of the request. A price order alone does not make a comparison or establish equivalent quantities. |
| Same recording, 13:07:42 | The call ended at its two-minute limit; late context/control work then failed during teardown. | Intentional application duration limit, not a missing site record. The cap stays unchanged. |
| Same recording, 13:07:50–13:08:32 | Restart produced unsolicited old item descriptions. Published prose and research arrived in many serial context appends over about 35 seconds. Requests to open Pineapple were acknowledged, but no delegation or navigation followed. | Startup instructions alone did not suppress speech; the app only launched work when Live delegated. Slow context delivery is a measured contributor to stale context, not proof of the model's internal cause. |
| `6fbbcaff-9ccb-4ec1-a170-caff7df942bb`, 13:13–13:14 | Whole-cake requests waited through several exchanges. The eventual filter matched “Cakes” inside “Cupcakes” and asserted items were larger than slices before application. | Substring matching on category facets; negative slice filtering was treated as positive evidence of whole-cake size; spoken action claims preceded the browser receipt. Some records have no stated unit, so “not labeled slice” cannot establish “whole cake.” |
| `cd30b80d-ce5c-4408-84b0-e11744756de4`, 13:18–13:19 | “Only chocolate” produced ten records, including labeled photos and a general menu article. “Open up the … German” was split across captions; three promises to open it had no delegation or action. | Broad whole-site search mixed offerings with prose that mentioned the word. More importantly, the app had no first-attempt recovery when Live acknowledged but did not delegate. |

## Changes

1. **Recover missed handoffs.** Explicit requests may start one ordinary backend job after a short quiet period when Live has not done so. The runtime uses null application delegation identity, the same acceptance checks, quota reservation, cancellation and deadline. Native and recovered work cannot both own the same input. No automatic retries after failure.
2. **Preserve paused requests.** Incomplete phrases stay together across caption gaps. Backchannels do not pollute the following request. Status questions and requests for silence preserve an explicit request waiting for handoff; cancellation discards it. A pronoun request such as “open it up” remains complete. The semantic backend still resolves item names using the publication and current context.
3. **Control premature/stale speech.** Browser output stays muted on visitor-first/restarted calls until fresh speech, and while a request has no verified result. Microphone capture remains available. Success, failure and cancellation release or reset the gate through the existing generation checks. The application supplies actual task state for status questions.
4. **Correct query behavior.** Comparison language bypasses the price-sort shortcut. Faceted text `contains` matches whole words/labels, so “cakes” does not match “cupcakes”; ordinary non-faceted text retains substring behavior. Backend guidance requires affirmative unit/size evidence, compatible comparison bases, actual comparison presentation, and offering scope for offering-only requests. These guidance changes still need live semantic verification.
5. **Deliver useful context sooner.** Live receives compact, whole published facts and research summaries with bounded recall entries. Visibility and research take priority over longer prose. Full evidence and bounded dialogue remain accessible to the backend and recorder; unknown or omitted information is not represented as absent.
6. **Keep mobile progress legible.** Browser review found long progress messages overlapping the Voice/Chat controls. The compact dock now reserves horizontal space for those controls. Long visible labels truncate while their complete accessible text remains. The waveform height and border-centered control position are unchanged. [Mobile pending-state screenshot](screenshots/qa-voice-2026-09-24/mobile-progress.png).

These are shared Studio visitor paths. No cake-shop ID, flavor, price, tax rate or image was hardcoded; no publisher content or production configuration was changed. Session duration, quota and task limits are preserved.

## Verification

- 124 focused offline regressions passed, including missing handoffs, paused item names, late native delegations, active microphone input, failure without retry, cancellation, comparison routing, category word boundaries, Unicode labels, and context bounds.
- 21 shared Live runtime tests passed with the separately tracked sibling-checkout parity test excluded. That comparison already fails on `protocol.ts` before this change; the separate FlowPath checkout has not been modified.
- 61 additional offline session, client, recorder, route and task-integration tests passed.
- TypeScript, targeted lint and the production build passed.
- 18 distinct isolated browser checks passed using mocked media and providers: desktop/mobile output gating and fresh speech after cancellation; microphone availability during introductions; streaming/interruption/Stop; failed controls and streams; readiness; retained 32-message history and silence on restart; idle expiry with retained information; progress and reduced motion; menu/item opening and clarification history. Fifteen passed together, then the corrected current-surface assertion in the idle test and two menu/history checks passed in a separate run. No actual microphone or speaker was used.

The broad browser suite is **not certified green**. An earlier 43-case voice run still contained tests for the former stacked-panel model; repeated worker restarts also exhausted its demo site allowance. Relevant fixtures were updated to the current completed-answer protocol, 32-message bound and information-surface context. Two separately rerun legacy successive-panel cases still expect two retained workspace objects where the current single information surface replaces the previous primary content. These need migration with the other old browsing/panel fixtures; the application was not changed to restore the old panel model. The separate sibling-runtime parity check also remains open as described above.

Reproduce the focused checks with Node 24:

```sh
node --conditions=react-server --import tsx --test tests/visitor-realtime-control.test.ts tests/visitor-query-command.test.ts tests/visitor-query.test.ts tests/visitor-live-context.test.ts tests/visitor-voice-context.test.ts tests/visitor-voice-input.test.ts
npm run test:browser -- tests/browser/visitor-realtime.spec.ts --grep 'confirmed-result|microphone remains|one tap maintains|bounded voice history|quiet minute|spoken cancellation|background work stays visible|readiness waits|stream failure|failed control|speed:'
npm run test:browser -- tests/browser/retained-task-view.spec.ts --grep 'recorded menu requests|clarification replaces'
```

The browser commands require the demo production build described in `CONTRIBUTING.md`; their isolated server uses port 3225 and was stopped after the checks.

No paid model/API calls, deployment, publication, commit or push were performed. Real voice recognition, timing and audible wording remain unverified after these local changes.

## Next recorded acceptance check

After a fresh reload and recording start: ask for the menu, compare the cheapest comparable items, ask for only a published category, open one item using its partial name across a pause, and ask for its details. Verify the actual items and units, the displayed comparison, one opening action, and no premature claims. Then pause/end/restart, confirm silence until fresh speech, and ask to open a different item. Repeat with a non-food publisher. A future paid test requires an explicit allowance; mocked results are not a live-model quality claim.
