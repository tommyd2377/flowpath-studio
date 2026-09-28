# Meaningful spoken and visual introductions — September 21, 2026

Scope: the five approved greeting upgrades in Dynamic to-do. Changes are shared across publishers and do not change customer drafts, publications, voice preferences or account settings. Testing uses isolated synthetic publications and mocked providers/audio; no paid API calls.

## Findings and implementation

1. **Studio was too busy.** Conversation opening now starts with “Who speaks first?”. Assistant-first reveals one optional topic, with add/reorder/remove controls for up to three. Each selected topic shows its approved substance. Preview and custom welcome text are separate disclosures. Visitor-first hides those controls without deleting the selections. Website opening remains separately labeled in Content. Colors use the existing Studio light/dark tokens; narrow layouts retain readable fields and touch controls.
2. **Entity selections supplied only names.** `greetingPointTopic` now resolves descriptions and up to two complete qualified facts. Individual fact choices retain their subject, conditions and conflicting assertions. Both ordinary imported attributes and explicit graph facts are selectable. Topic resolution is limited to selected items rather than retrieving the entire catalog for every option.
3. **The greeting callback addressed obsolete existing-card positions.** It now installs the selected topic as a validated published-reference information state. Its approved related image may accompany it; illustrative labels remain visible. Topics use the existing Motion information frame, region transitions and Back/Forward. Desktop places related imagery beside the text; mobile stacks bounded imagery beneath it. Empty selections and a generic hello do not invent a visual topic.
4. **The introduction must yield to the visitor.** Existing immediate-listening/interrupt behavior is preserved, with instructions to stop permanently when interrupted. Speech activity or manual interaction cancels pending visual changes; late captions cannot advance the introduction afterward. Completion leaves the last introduced topic available for a follow-up. Restored history sends its real subject back into the voice context, without replaying speech or actions.
5. **Verify content, timing and lifecycle together.** The model receives every complete topic in its own bounded commentary part. This prevents a richer three-topic introduction from being cut by the existing 2,000-character append limit. Each topic allows at most 1,800 characters of approved context; longer material requires a specific fact or a short publisher-authored point. Instructions request one brief meaningful sentence per topic, natural naming, accurate qualifications and an invitation to ask a question. The deterministic preview is approved source material, not a promised verbatim live script.

## Verification

- **104 focused unit tests passed:** `tests/site-greeting.test.ts`, `tests/greeting-presentation.test.ts`, `tests/adaptive-workspace.test.ts`, and `tests/visitor-realtime-control.test.ts`. Coverage includes descriptions, qualified/conflicting facts, complete delivery beyond one append, zero through three topics, source removal/pruning, draft/publication boundaries, caption ordering, cancellation and shared voice safeguards.
- **13 mocked voice browser scenarios passed:** ordered topic states on desktop and mobile with reduced motion; zero/one/two selections; microphone availability during the introduction; speech/manual cancellation; late-caption rejection; semantic entity/fact context; related media; Back/Forward; and local/model clear-all behavior. The short mobile introduction and photo are checked for complete unclipped geometry.
- **Four Studio browser scenarios passed** across the focused runs: independent voice-setting persistence, divider positioning, the new setup flow and the semantic-fact picker. They cover optional rows, reordering/removal, saved choices after returning to the site, visitor-first preservation, published-versus-draft isolation, ordinary attribute facts and qualified fact previews. The final two greeting cases passed again after correcting theme tokens and test navigation. Together with the 13 voice cases, this is 17 distinct browser scenarios.
- Production build (including TypeScript), focused ESLint and `git diff --check` passed. This is focused verification, not a claim that every legacy browser case was migrated or the complete repository suite passed. The separate menu/photo task documents the existing sibling-runtime parity failure in its own report.

Commands use Node 24:

```sh
node --conditions=react-server --import tsx --test tests/site-greeting.test.ts tests/greeting-presentation.test.ts tests/adaptive-workspace.test.ts tests/visitor-realtime-control.test.ts
npm run build
npm run test:browser -- tests/browser/visitor-realtime.spec.ts --grep 'opening narration|opening with|cancels opening transitions|published entity and fact introductions|microphone remains|clear-all chat controls|model-generated bulk close' --output=test-results/greeting-2026-09-21
npm run test:browser -- tests/browser/voice-settings.spec.ts --output=test-results/greeting-studio-2026-09-21
npm run test:browser -- tests/browser/voice-settings.spec.ts --grep 'greeting setup starts|greeting picker previews' --output=test-results/greeting-studio-final-2026-09-21
```

Local screenshots and traces are under `test-results/greeting-2026-09-21`, `test-results/greeting-settings-2026-09-21`, and `test-results/greeting-studio-final-2026-09-21`. They are generated artifacts, not published customer media. The final Studio pass follows corrections to test navigation (reselecting its synthetic site after reload) and theme tokens; an earlier failure came from navigating to the default demo site, not lost greeting persistence.

## Remaining live acceptance

Real spoken wording, interruption and caption/audio alignment still need a short recorded microphone test. No new live allowance was granted for this implementation. GPT Live is a continuous conversational model: the visual observer follows topic captions plus detected output activity, not a word-aligned greeting-complete event. Substantially different wording can still miss a caption cue. See the official [Live prompting guide](https://developers.openai.com/api/docs/guides/live-prompting).

When authorized, publish one to three approved topics on a test site, start voice and let the first topic begin. Interrupt with “Tell me more about that.” Verify that the assistant listens immediately, answers about the visible subject and does not resume the unused introduction. Start a fresh session to hear all selected topics; verify semantic information, corresponding visuals, then Back/Forward and one follow-up about the restored topic. Visitor-first and an all-empty selection must remain quiet/default respectively. Record this once on desktop and once on a physical phone before claiming live acceptance.
