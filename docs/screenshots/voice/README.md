# The Voice verification — September 16, 2026

These are actual browser captures of synthetic local sites. They do not contain customer data. Provider calls and media devices were mocked or unused. No real microphone, paid model request, production publication or deployment was used.

## Passing checks

- `npm run check`: lint, typecheck, **544 server/unit tests**, **21 shared rendering tests**, packed independent package consumer and production build passed. Log: `/tmp/flowpath-voice-check.log`.
- `npm run test:browser -- tests/browser/voice-settings.spec.ts tests/browser/ai-carousel.spec.ts --max-failures=1 --output=test-results/voice-current`: **12 passed**. Includes new settings plus current desktop/mobile card navigation, filter/refinement/order, details/return/reset, voice receipts, chat switching, dismissal, late-result cancellation, 10,000-record paging and a mocked YouTube player. Log: `/tmp/flowpath-voice-current-browser.log`.
- Final `npm run test:browser -- tests/browser/voice-settings.spec.ts --output=test-results/voice-final`: **1 passed**, with additional cross-site isolation and light-theme checks. Its 17 screenshots are copied here. Log: `/tmp/flowpath-voice-final-browser.log`.
- A focused run also passed the existing **Branding saves independent options**, **eight palettes preview immediately**, **disabled capability stays hidden until saved and published**, **mock voice receives the active card receipt**, and **cancelling pending microphone permission** scenarios.

The Voice case checks all fourteen options in the voice chooser, all nine immediate waveform/chat color updates, keyboard activation, reduced motion, desktop/mobile/embedded layouts, preset and independent-control persistence, unchanged site facts/style, reloads, original publication isolation, an explicit synthetic local publish, disabled conversation preference retention and separate site defaults. No voice session or external request is permitted during this settings test.

## Wider legacy-suite failures

The entire browser suite is **not** reported as passing. An attempted `visitor-realtime.spec.ts` + settings run produced **1 pass / 34 failures**. The initial failures include expecting two retained workspace objects where the current card renderer replaces the active object, and waiting for former `[data-workspace-content]` elements / multi-panel greeting views. Failed-worker fixture recreation subsequently exhausted the unchanged 12-site demo allowance, causing most later failures and preventing a meaningful settings result in that run. Log: `/tmp/flowpath-voice-browser.log`.

A fresh focused run isolated two legacy cases—**readiness waits for connected media and the owner ACK** and **a failed control update stops once**—which still fail trying to open the former `[data-workspace-content$=":section:weddings"]` surface. That run had **5 passed / 2 failed / 1 not run** (stopped at two failures). Log: `/tmp/flowpath-voice-focused-browser.log`.

`VisitorWorkspace.tsx` and its current single-active-card `replace` behavior were not changed in this task. A separate checkout of the pre-task application was not browser-built; therefore these results are documented as unresolved legacy coverage mismatches, not a measured before/after regression claim. Current UI navigation is covered by the passing `ai-carousel.spec.ts`, and mocked session/readiness/cancellation tests are part of the passing unit suite. The new settings case is registered in its own isolated browser group so it does not share this fixture exhaustion.

## Browser captures

- [Desktop Studio, dark](voice-studio-desktop.png), [light](voice-studio-light.png), [mobile](voice-studio-mobile.png), [embedded mobile preview](voice-studio-embedded.png).
- [Conversation habits](voice-conversation-habits.png), [all nine choices on mobile](voice-colors-mobile.png).
- Voice-color selections with the actual chat preview: [Amber](voice-amber.png), [Slate](voice-slate.png), [Ocean](voice-ocean.png), [Teal](voice-teal.png), [Jade](voice-jade.png), [Indigo](voice-indigo.png), [Plum](voice-plum.png), [Rose](voice-rose.png), [Copper](voice-copper.png).
- [Published synthetic website and waveform](voice-website-desktop.png), [mobile chat](voice-chat-mobile.png).

Desktop/light/mobile/color-picker/published-wave/chat screenshots were visually reviewed. Individual swatch captures document each immediate update; color contrast was also computed across every old/current site palette. Screenshots wait for the outgoing waveform to unmount before capturing chat, including reduced-motion mode.

Actual GPT Live voice timbre, accent fidelity, pronunciation, personality adherence and live audio latency remain **unverified**. The feature uses documented provider voice IDs and instruction guidance; mocked transport confirms the outgoing configuration, not acoustic quality.
