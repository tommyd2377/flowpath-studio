# Voice startup investigation — September 24, 2026

## Recorded evidence

Recording `a9d135b1-eb48-45c2-b75b-c0d56ea06c8c` includes a complete restart at 13:07:45.799 EDT, browser trace `bc946552-f055-40eb-9792-e58a15254a01`. It took **5.12 seconds from activation to input readiness**. The other two supplied recordings attached to existing voice connections and do not provide comparable startup measurements.

| Milestone | Elapsed from activation |
| --- | ---: |
| Audio context ready | 11 ms |
| Microphone acquired | approximately 137 ms |
| Page/context preparation complete | 2,497 ms |
| Local offer ready; session request starts | 2,644 ms |
| Session answer received | 4,225 ms |
| Control connection ready | 4,619 ms |
| Owner acknowledgment and input ready | 5,120 ms |

The preparation interval contained overlapping refreshes, two HTTP 409 responses, recovery/restoration of the retained view, and another refresh after restoration. Hover and keyboard focus both warm up task state; activation can request the same work again. Workspace preparation already synchronizes an existing task, but voice startup and request preparation synchronized it a second time.

The earlier September 18 startup path only settled task state. Subsequent saved-view preparation added necessary restoration, but retained the separate settlement afterward. This code history explains added work; it does not establish how much faster a previous live session was. No equivalent older complete startup recording was available for a direct comparison.

## Local changes

- Share concurrent task synchronization for the same current view and interaction generation. Release it when complete; do not cache completed synchronization. Reject stale completion after navigation before it can pause observation of the newer view.
- Reuse workspace preparation of an existing task instead of refreshing again. A fresh visit still initializes its task session; saved-state restoration and validation remain required.
- Prepare the local connection offer while page preparation is pending. Wait for successful preparation before creating a paid voice session, and read the current context at that point. Failure or cancellation releases media, including a microphone that becomes available late.

The approximately 147 ms of local offer work in this recording can overlap preparation; that is not a prediction of the total live improvement. The larger avoidable cost was repeated synchronization. No model, authorization, quota, provider configuration, or paid retry policy changed.

## Verification and limits

All **11 focused mocked browser checks passed**, covering shared hover/focus/activation preparation, retained results, fresh initialization, offer overlap, failed preparation, cancellation, late microphone cleanup, owner-acknowledged readiness, restart history, and desktop/mobile audio gating. The production build (including TypeScript checks), targeted lint, and `git diff --check` passed. These checks exercise the browser orchestration with synthetic publishers and mocked audio/providers, without paid API calls. The isolated test server was stopped afterward.

A new live recording is still needed to measure the actual startup improvement. Provider connection time, real microphone behavior, and deployment are not verified by the mocked checks. `first_audio` records remote audio activity even when playback is muted, so it is not evidence of audible speech. Use `input_ready` for connection readiness; deliberate listening-first silence and waiting for a verified answer are separate from connection delay.
