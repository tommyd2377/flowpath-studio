# Publisher arrival and chat composition — September 28, 2026

This pass implements the publisher opening choice and the visitor's two focus layers. It builds on the [greeting correction](qa-greeting-2026-09-28.md); opening appearance, spoken welcome, introductory topics and ongoing assistant role remain separate settings.

## Implemented behavior

- **Studio → The Voice → Visitor arrival:** Website is the backward-compatible default. Voice invitation opens with the publisher's logo, or name when no logo exists, their selected waveform style and a tap-to-start instruction. Browsing is available without microphone permission. Chat-only or disabled assistants cannot trap visitors behind a voice invitation. The old duplicate First view selector has been removed from website design review; existing saved values remain readable.
- **Chat composition:** selecting Chat or editing a follow-up glides the same input toward 42% of the usable viewport. Its target follows the visual viewport when a phone keyboard opens. Submission glides it back to the dock. Motion is suppressed with reduced motion. The empty welcome card and suggestion rows are absent from initial chat composition.
- **Two focus layers:** the regular website remains mounted and softens behind the assistant. Existing answer content additionally softens and becomes inert while composing, then becomes readable again on submission. It is not cleared or remounted just to change focus. Escape or tapping outside restores an existing answer, or returns to the website when there is no answer. Close, voice/chat switching and empty-chat dismissal release scroll locks and keyboard focus.
- **Dictation:** an explicit microphone action fills editable text without submitting or starting a live voice conversation. Typing, submitting, hiding the page, closing and switching modes cancel stale dictation. Connected sites use a bounded server transcription path so they do not depend on Brave's incomplete browser speech-recognition implementation. Offline previews retain browser recognition when supported.

All behavior uses shared publisher settings and components. No business names, products or domain-specific rules select these paths. No real publisher's draft or published settings were changed during this pass.

## Dictation implementation and limits

The recording path captures at most 20 seconds, releases the microphone when stopped, converts the recording locally into bounded 24 kHz mono PCM, and sends one transcription request. It never retries or automatically submits the resulting message. The endpoint validates byte length rather than trusting a claimed duration. Audio is not written to recording logs or disk by the application. Server transcription requires HTTPS/localhost, permission, connected AI configuration and remaining chat/dictation allowance.

`gpt-transcribe` is used only for transcription. It does not answer the visitor or select display actions. Separate daily dictation counters are bounded by existing chat limits and do not consume the subsequent chat answer. Local QA accounting reserves a conservative full minute per bounded recording and retains that reservation rather than pretending a transcript proves billed cost. Existing application secrets and account settings are untouched.

Sources checked September 28: [OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text), [GPT-Transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe), [API pricing](https://developers.openai.com/api/docs/pricing), [Brave browser speech-recognition issue](https://github.com/brave/brave-browser/issues/2802), and [Brave on-device implementation work](https://github.com/brave/brave-browser/issues/56487).

## Verification

The final server/client implementation passed production build, full ESLint, TypeScript checks and `git diff --check`. There were **108 passing focused tests** across dictation (native and recorded), route validation, daily/QA reservations, voice settings, greeting and answer/conversation history, plus **3 passing surface rendering tests**. The new route checks cover cross-origin, malformed, oversized, aborted and offline requests without making provider calls.

The final entry/composer browser suite passed **11/11**, including a browser with no native SpeechRecognition: one bounded PCM upload, editable text without automatic Send, immediate microphone cleanup, cancellation during editing and a late transcript discarded after dismissal. Desktop/mobile invitation, real publisher logo versus name fallback, old-publication defaults, empty-chat dismissal, retained answers, Back/Forward, keyboard focus and reduced motion are covered. Invitation instruction contrast is checked at a minimum 4.5:1. These tests use isolated demo data, mocked provider replies and mocked audio devices.

The existing voice-settings suite passed **5/5** and mode-motion passed **4/4** in separate fresh-data runs: **20 browser cases passed in total**. Final TypeScript verification includes the new recorded-audio browser fixture. No browser test made a paid request or used a real microphone.

Relevant commands: `npm run lint`, `npm run typecheck`, `npm run build`; focused Node tests run with Node 24, `--conditions=react-server --import tsx`. Browser checks use `npm run test:browser -- tests/browser/assistant-entry-composer.spec.ts`, then separate invocations with `tests/browser/voice-settings.spec.ts` and `tests/browser/visitor-mode-motion.spec.ts`, each receiving fresh isolated data.

Manual in-app-browser checks used the isolated Sophie Chen photographer fixture: choose/save/publish the local invitation, open Chat, submit a demo request, refocus the input, restore the answer with Escape, and close to the website. The 393 × 852 viewport had no horizontal overflow. No permission prompt was accepted and no real microphone or paid provider was used.

Visual evidence is in [screenshots/assistant-entry-2026-09-28](screenshots/assistant-entry-2026-09-28). The screenshots are synthetic publisher fixtures, not changes to the user's real sites.

## Remaining acceptance

- Physical iPhone keyboard, microphone permission and real transcription quality need device verification.
- No live OpenAI transcription request was made in this pass; mocked integration checks do not establish live audio accuracy or provider latency.
- This is a local implementation. It has not been deployed, merged or pushed.

The isolated manual server on 3220 and browser-test server on 3225 are stopped. Temporary manual-preview tabs are closed. The screenshots and this record remain available for the next acceptance pass.
