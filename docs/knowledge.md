# Knowledge: local private MVP

October 26 implementation. Knowledge is a reviewed, built-in capability alongside Text Box. It retrieves reference material; Text Box owns the display. There is no executable plugin upload or marketplace. See the [shared contract](parallel-work/contracts.md#shared-plugin-contract-implemented) and [Text Box behavior](text-panel.md).

## Creator flow

1. Use the normal Google/email account and save a waveform. In waveform settings choose **Plugins → Knowledge → Manage documents**.
2. Upload a text-based PDF, DOCX or UTF-8 TXT. Status progresses through Uploading, Preparing and Ready; preparation continues at the provider while the creator edits elsewhere. Reopening Knowledge resumes status checks without re-uploading. Ready files default to **Use in my waveform**; uncheck to disable them.
3. Start a new conversation on the private waveform. Ask a specific question about a document. GPT-Live delegates to GPT-6 Luna, which calls the app's server-authorized retrieval function and answers from returned passages. General knowledge remains available but must be identified separately from document evidence.
4. With Text Box applied/saved, ask **Show the relevant passages and sources about [topic]**. Exact extracted excerpts appear with filenames and expandable source details. Ordinary spoken Q&A leaves the panel closed. Stop/Hide/Undo/Copy retain their existing behavior. Copy includes filenames. Generated edits clear source attribution; Undo restores the corresponding text/source snapshot.

The Knowledge page also has **Try a question → Find passages** to inspect retrieval without starting a voice call. This is a real retrieval request in the full local app. Automated suites use synthetic files/providers only; their fixture owners never replace the user's normal account flow.

## Data and authority

- `knowledge-server.ts` checks the existing same-origin/host policy and current authenticated owner before reading a body or calling a provider. Scope comes from that owner's saved waveform. Client-supplied owner IDs, store IDs, file IDs and foreign waveform IDs cannot select a library. There is no anonymous/paid-visitor Knowledge route.
- `knowledge-store.ts` uses `VoiceDatabase` transactions, with one index per hashed owner and immutable document UUID/content digest. Metadata lives in `waveformKnowledge`; the validated local Firebase adapter prefixes it `localStudio_`. Existing account and waveform records are untouched; no migration/security-rule/provider configuration change is required.
- Originals and the managed search index live with OpenAI, not in the repository, browser storage or analytics. Processing/storage may cost money. The server loads the app's already-configured runtime credential without exposing it. Provider IDs remain server-side. The UI is explicit about external processing before upload.
- Upload ceilings are 10 MB/file and 20 entries/library, separate from voice-testing quotas. A streamed multipart request is bounded before parsing. Types and basic signatures are checked; text must be valid UTF-8. These are resource protections, not a malware scanner or OCR service. Scanned/image-only PDFs, complex layouts and encrypted/unsupported files may fail or extract poorly.
- Upload UUID replays do not create more files; concurrent starts are serialized. There are no paid retries. Interrupted/unknown outcomes stay visible for cleanup. A lost index-creation response blocks new ingestion until provider reconciliation; it never silently creates another index. A lost file-upload response can leave an unknown provider file requiring manual reconciliation; its entry cannot be deleted with a false success claim. Known file IDs are retained for explicit deletion. Empty zero-file indexes remain reusable; complete provider resource lifecycle/reconciliation is a hosted-launch prerequisite.
- Refresh polls existing indexing jobs only, with a server-side minimum interval and ten-minute preparation horizon. It does not restart ingestion. No background worker, scheduler, emulator or cloud resource is provisioned by this implementation.
- Search filters selected document attributes before retrieval, validates returned file IDs against the authorized ready set, and rechecks current identity/revision after retrieval. Deselection/removal revokes future search immediately, even while provider deletion is eventually consistent. Failed deletion remains disabled with a retryable Remove action. Previously delivered passages cannot be recalled from the user's tab or model context.
- Filenames and excerpts are escaped plain text. No raw HTML, fabricated URLs, provider downloads, guessed page numbers or model-authored source metadata. Each response contains at most four 850-character excerpts. They are extracted text, which can differ from original visual formatting. Source provenance applies to those excerpts, not a guarantee that every generated spoken statement is correct.

## Activation and remaining work

Actual provider use is restricted to the validated **full localhost** runtime with live APIs already enabled; hosted ingestion/search stays disabled. Private documents do not enter paid/public publications. No live price, payment, auth provider, deployment or production environment setting changed. Existing local founder unmetered voice testing remains intact.

Public Knowledge requires a separate explicit publication of document versions, exact-version safety review, revocation semantics and ingestion/storage/retrieval funding limits. Private reference documents are untrusted data, not changes to the saved persona or an approved public moderation candidate. They cannot grant tools or bypass the existing name/instruction review. Document OCR, page mapping, original-file viewer/downloads, selective per-document replacement, persistent notes and third-party developer distribution are future work.

UI actions update promptly and reuse the existing subtle 800 ms panel reveal/reduced-motion behavior. An explicit display request opens a calm Finding sources state immediately when its validated tool call arrives; it preserves existing text while retrieving. Search/model latency depends on network, indexing and provider execution; this implementation does not promise a measured sub-second answer. It does not execute partial function arguments. The server remains running through source edits; existing calls keep their original capabilities until the next conversation.

## Initial implementation validation

Focused suites: `tests/knowledge.test.ts`, `tests/plugin-session.test.ts`, `tests/browser/knowledge.spec.ts`, plus the Knowledge case in `tests/browser/voice.spec.ts`. Tests cover immutable/idempotent uploads, account isolation, permission/revision changes during search, cleanup failure, strict routing, provider errors, async continuation ownership, stale/hide/finish behavior and source display. Full check results belong in the coordinator handoff; mocked success is not live provider/Google/voice acceptance.

October 26 final local evidence:

| Check | Result |
| --- | --- |
| `npm run check` | Passed: lint, generated route types/TypeScript, 311 unit/integration tests, production build. |
| `npm run test:browser` | 60 passed using isolated accounts, synthetic documents/provider/media on port 3225. |
| `npm run test:browser:paid` | 6 passed using fake checkout/provider data on port 3226. |
| Actual app smoke check | Opened `http://localhost:3220/account/knowledge` in a background in-app browser; the existing normal account loaded its library and enabled upload controls. Visually inspected the screen. No upload, search or voice was triggered. Brave was left untouched. |
| Live ingestion/retrieval/voice | Not run. No paid provider calls or provider resources created by Codex; no real PDF/DOCX parsing or latency acceptance is claimed. |
| Git/docs | Diff whitespace check passed. New local documentation links resolve; the inherited README archive link is absent in this managed worktree and was not restored. Existing prompt-limit edits were preserved. No commit, push, merge or deployment. |

Checks ran from the source-only isolated copy `/private/tmp/flowpath-text-check-7ggkf2iw` without private runtime files. Logs: `/private/tmp/flowpath-knowledge-{check,browser,paid}.log`. The actual server on port 3220 remained running. Initial browser failures exposed and fixed nested approval/Knowledge transactions and delayed controlled-checkbox feedback; the final suites above passed after those corrections.

Provider contract verified against [OpenAI Retrieval](https://developers.openai.com/api/docs/guides/retrieval), [File search](https://developers.openai.com/api/docs/guides/tools-file-search) and [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation). No new model, SDK or parser dependency was added.

## Subsequent approved live acceptance — October 26

The user explicitly approved the exact synthetic file `/private/tmp/flowpath-franklin-knowledge-sample.txt`, one live preview search and one voice call of up to two minutes in the actual Brave app on localhost:3220, using the existing normal account. No synthetic owner, provider/media fixture or alternate app runtime was used for this acceptance.

- Real upload and OpenAI indexing reached **Ready** with the sample selected. The extension's file shortcut required an unapproved persistent file-access setting, so the native file picker selected the approved path instead; no browser permission setting changed.
- The live preview returned the exact fictional exhibit facts and sample filename.
- In the Benjamin Franklin waveform, the user spoke the sample question. Session-only diagnostics and actual playback state confirmed the correct Monday 2:17 p.m. start, Copper Press Room 7 and LANTERN-731 reference code. Franklin distinguished the fictional exhibit notes from historical facts. The spoken answer began approximately 4.8 seconds after the observed delegation, not within hundreds of milliseconds; this is one observation, not a latency benchmark.
- The user's second spoken request opened Text Box with the extracted passage and the correct filename under Sources. Ordinary Q&A had left it closed. This verifies the live document → retrieval → delegated answer → requested sourced-display path for TXT. Real PDF/DOCX extraction remains unverified.
- The user confirmed ending the call through a call control. Provider closure reported 93 seconds; no automatic retry or additional call was started. The planned live Hide-preserves-voice check was inconclusive because the call was already ended. The expanded diagnostic drawer covered the toolbar's Hide area; a selector click is not evidence that the underlying control received input. The normal, non-diagnostic behavior still has the separate mocked regression evidence above.
- The in-memory diagnostic capture was cleared through the UI; no transcript/audio log was saved. This record contains acceptance assertions, not a transcript. The user resumed the tab in settings, so browser interaction stopped and their tab was preserved.
- The synthetic document remains selected for the user's further manual testing. No other document, persona setting, price, payment, auth or deployment configuration changed. The existing server stayed on port 3220. Only this documentation record changed during live acceptance.

Useful next manual negative control: ask for the Saturday workshop time. The sample provides no Saturday schedule, so a document-backed answer should say it is absent rather than inventing one. This negative control was not run in the approved call.
