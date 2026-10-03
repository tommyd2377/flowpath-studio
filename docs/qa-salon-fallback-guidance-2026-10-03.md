# Unmatched visitor request recovery

The Salon Van Sickel local browser audit exposed a misleading deterministic reply: it directed visitors to browse information “below” while the assistant made the website background inert. The matcher can also miss information that is present, so a failed match cannot establish that the publisher omitted it.

The generic unmatched reply now offers a more specific name or the **Close assistant** control to return to the website. This is the existing dismiss button’s accessible label. The change only replaces that reply; routing, matching, published content and other clarification messages retain their behavior.

## Verification

- Ten focused server tests passed: the dedicated regression exercises an unmatched request with an empty workspace and an existing focused item; existing workspace command and bounded retrieval tests cover adjacent behavior. The current approved view is preserved.
- Scoped ESLint and the shared package build passed.
- Fresh isolated Chromium contexts at 320 and 390 pixels passed recovery checks against the local deterministic demo: the prior Haircuts card and price remain, keyboard activation of **Close assistant** removes the inert background, native details can be opened with the keyboard, and Escape returns focus to their website card. Neither width overflowed. External browser requests were blocked.

These browser checks use an explicitly curated source control and real demo responses, not live provider responses. Evidence is in the task's `evidence/fallback-browser/report.json` and screenshots. The first harness run incorrectly expected the exact-name local shortcut to issue a chat POST; the corrected assertion and retained first-run report distinguish that harness error from a product failure. No production build, real voice or Safari verification was added for this copy-only change.

The underlying semantic matching limits remain. The independent saved-HTML salon price-comparison and follow-up live case is separately queued with the primary task’s budget guard; this wording fix does not establish that those answers succeed.
