# Recorded menu and photo follow-up failures

## Evidence

The local recording `107cbc0f-1797-400a-a922-73cee191a15a` contains 2,698 events from September 21, 2026, 08:53:08–08:55:52 America/New_York. All eight captured source hashes matched the checkout inspected for this repair. The recording attaches to an existing call and contains subsequent restarts; earlier speech is unavailable, some payloads are truncated, and transcript generation does not prove audible playback. Raw recordings remain private and ignored by Git.

| Observation | Recorded cause | Consequence |
| --- | --- | --- |
| Menu request at 08:53:24 | Events 360 and 372: the root → chosen menu breadcrumb supplied to `query.patch` failed validation; `scopeRecords` threw `Invalid chosen collection path.` The recorded model context is truncated. | The entire task stopped, including the request for recommendations. |
| Address/contact request at 08:53:44 | Events 695 and 700: `update_workspace` attempted an entity detail, which the task-owned surface rejects. The backend recovered with `record.detail`. | An unnecessary model/tool round preceded the successful result. Generic workspace guidance advertised a route that the current transport disallowed. |
| Gallery opened at 08:54:59; individual-picture requests at 08:55:10, 08:55:22 and 08:55:31 failed | Gallery replacement hid the task view. Event 2173 refreshed server generation 7; event 2176 still carried browser generation 6 and `preparationAck: failed`. No model request followed any of the three failed preparations. | Repeating or rephrasing the picture request could not recover. `VisitorWorkspace.prepare` skipped synchronization when its visible task was null, then `tasks.settle` rejected the retained stale generation. |

The address/contact display, published-hours answer and gallery display received browser acknowledgments. The evidence does not indicate that photos or menu knowledge were missing. The previously repaired long-text retrieval overflow was not the failure in this recording.

## Repair

- Capability inputs accept a published collection ID without a reconstructed path. The server resolves unique ancestry and repairs an incomplete breadcrumb for that same collection before operation reservation. Existing valid breadcrumbs are preserved. Multiple possible parents require an exact path; unknown scopes and invalid unions return correctable `invalid_input` without reserving an operation, changing the view or consuming a capability call. Strict stored queries still require validated full paths. `schema.describe` returns exact `childScopes` for discovery.
- Surface preparation also synchronizes retained task state when a gallery or other workspace composition hides it. Restoration uses fresh server metadata and retains the hidden state, visible gallery, history, filters and record identities. It does not replay model work or reopen the old detail.
- Task-enabled chat and voice workspace schemas omit legacy collection/detail/comparison components. Their guidance routes those requests to the authoritative task capabilities; sources, photos and galleries retain workspace composition. The runtime guard also covers update/reset operations.

The independent website, publication authorization, display acknowledgments, cancellation and existing model-call limits remain in force. These changes add no provider calls or automatic retries.

## Verification

Verification uses synthetic publications, mocked model/audio events and isolated browser contexts. The focused server regressions cover unique and ambiguous hierarchy paths, no-mutation input rejection, exact display receipts and tool routing. The browser regression exercises real task refresh/restoration and receipts through detail → gallery → individual photo → another request → Back, advancing server generations at the same point as a delegated job.

Final verification:

- Lint, TypeScript, production build and independent packed-package checks passed.
- Server tests: 668 passed; the existing shared-core byte-parity test against the separate FlowPath checkout failed. The shared `lib/gpt-live` files were not changed. The overall `check` gate is therefore not green.
- All 30 rendering tests and 10 relevant isolated browser tests passed, including the new recorded-sequence regression, gallery visibility receipts, gallery close/website scroll, mode switching, Home, cancellation, clarification, retained detail/comparison and pagination.
- The dense context regressions passed under the unchanged 48,000-byte bridge limit after removing redundant schema encoding. No context-limit increase was needed.

Live speech recognition, final audible behavior and the original publisher session after reload require a separately authorized live test. No live API request, deployment or publication is part of this repair.
