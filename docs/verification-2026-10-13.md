# First waveform milestone verification — October 13, 2026

## Archive and independence

- Studio source recovery: all 1,540 archived files restored and SHA-256/mode verified before active source retirement. Git bundle and restored object connectivity verified.
- Independent acceptance review rechecked all restored source hashes and archive checksums. No blocking runtime issue remained.
- News: lint, typecheck, all 193 unit tests and production build passed. Only its sibling-comparison test and runtime ownership documentation changed. Existing source was clean before that two-file change.
- Secrets/private runtime data and deployment files were left untouched. No commits, pushes, deployment, domain changes, emulators, accounts, real payments or live API tests occurred.

## New waveform application

- npm run check passed: lint, strict types, 14 mocked server tests and production build.
- npm run test:browser passed: 12 isolated Chromium tests with fake media/provider responses and external browser requests blocked.
- Browser coverage: quiet page load, real default-paused readiness, start/speech/end, denied microphone, delayed microphone and provider creation cancellation, playback recovery, Escape, silence/deadline closure, desktop/mobile centering, 1.5-second fade and return, canvas pixels, reduced motion and no uncaught browser errors.
- Visual inspection of generated desktop opening and mobile connected screenshots passed. Screenshots are under test-results/waveform-{1280,390}-{idle,connected}.png.
- Browser checks use the existing dedicated Chromium testing binary when the current Playwright binary is unavailable. Every launch has a fresh isolated profile.

The actual local readiness check caught Next's internal localhost normalization. The guard now separately validates browser-facing loopback Host, matching Origin and exact port; a unit regression covers it.

Live remains disabled by default and in production. The localhost development preview was started with FLOWPATH_LIVE_ENABLED=0. Tapping it requests neither microphone access nor a provider session. GPT-Live independent answer quality, real audio, WebRTC provider behavior, physical devices, deployment supervision and public quota/account behavior remain unverified.

The active prototype has only the home page and local session endpoint. Account creation, owner instructions UI, prepaid minutes, News subdomain migration and plugins remain later milestones. The current application prompt is in lib/voice-config.ts.

## Opening transition update

At the user's request, the logo and invitation now fade together over 800 milliseconds while the waveform glides to the logo image's center using the same duration and easing. Ending returns all three to the opening view. Reduced motion applies the transition immediately.

Lint, types, all 15 mocked server tests, production build and all 13 mocked browser tests passed. The browser checks include desktop, mobile and short landscape alignment, unchanged waveform dimensions, return position and keyboard/reduced-motion behavior. Mobile and landscape connected screenshots were visually inspected. No live API calls were initiated by the agent for this visual update. The user explicitly requested a fresh local live-test allowance.
