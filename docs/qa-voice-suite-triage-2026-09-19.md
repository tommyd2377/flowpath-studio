# Voice browser-suite triage — September 19, 2026

This is a read-only runtime review of `/tmp/flowpath-loop-voice-final.log` and `test-results/platform/voice-final`, followed by two test-selector updates. It is not live speech verification and made no paid API calls.

## Observed failures

- The successive-panel tests receive applied navigation acknowledgments and render the requested Portrait content. Their assertion expects two additive workspace objects. Current `VisitorWorkspace.navigate(open)` replaces the information composition, so the legacy multi-panel scenario needs a deliberate rewrite around whole-state Back/Forward.
- One-tap streaming and unpublished-reference tests locate the removed `data-workspace-focused` element. Their failure snapshots contain the expected Wedding content inside **Current information**. The one-tap test now checks that surface; its interruption, stale-plan rejection and explicit Stop assertions remain.
- Stream failure produces the correct visible ended-connection alert. The test used the old **Site assistant** region. It now targets the **Assistant exploration** dialog; disconnect, no automatic retry and typing-fallback checks remain.
- Manual browsing tries to click website content behind the active information overlay. That website is intentionally inert. This scenario needs to use Return to website before browsing, then verify the retained call and cancellation semantics.
- After these failures, successive Playwright worker processes recreate the module-scoped publisher fixtures. **24 of the 33 recorded failures** stop during setup at the unchanged 12-site demo cap. They do not exercise their intended runtime behavior and must not be counted as handshake regressions or passes.

## Unresolved greeting composition

The greeting tests refer to removed **Welcome highlights** and carousel-card selectors, but renaming those selectors is insufficient. Their snapshots show the information surface remaining at **What would you like to explore?** despite configured greeting points.

`VisitorAssistant.beginGreeting` resolves the approved points but passes only an index to `VisitorWorkspace.greeting`. That method selects `cardsRef[index]`; it does not install the configured points or their associated visual content. This revision-zero opening path is separate from the new per-request preparation handshake. A subsequent fix should compose the approved greeting content into the existing surface, preserve immediate interruption and cancellation, and verify both desktop and mobile behavior. No greeting runtime change was made during this triage.

## Focused verification to run

The two changed tests passed scoped ESLint. The coordinator reran this fresh isolated subset after the combined build: **all eight passed**. Reproduce with:

```sh
npm run test:browser -- tests/browser/visitor-realtime.spec.ts --grep 'microphone remains available|one tap maintains streaming|cancelling pending microphone permission|stream failure stops|readiness waits|a failed control update|speed: cold preparation' --output=test-results/platform/voice-safeguards-final
```

These eight cases cover desktop/mobile microphone readiness, interruption and stale plans, explicit Stop, disconnect without retry, media/control readiness, failed control updates and cancellation during cold preparation. The full legacy suite still requires migration; a passing focused subset does not establish that the full suite or actual speech behavior passes.
