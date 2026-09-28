# Complex requests, connection recovery and motion — September 27, 2026

This pass continues the same local **$5 daily API allowance**. Its starting conservative balance was $2.153371, including the previous request whose usage was not returned. Live testing uses the normal chat interface in the Codex in-app browser; speech, microphone permission and physical iPhone behavior are separate acceptance work. No publisher content/settings, production configuration or deployment is changed.

## Findings and changes

- A new turn invalidated the previous query handle, forcing an already-visible comparison through a fresh lookup. `selection.compare` can now resolve the complete current query using its exact ID and revision. It still rejects stale queries, unauthorized references and results outside the two-to-six comparison bound. A simple display-only comparison can finish after its confirmed display; explanations and further operations still run.
- Named comparisons can also use two-to-six exact published record IDs directly, avoiding a lookup merely to rebuild known records. This input is mutually exclusive with current-query handles and full record bindings; authoritative reference and field validation still apply. A model-selected display-only comparison finishes after acknowledgment of the complete ordered rows. Requests for photos, other media, explanation, research or calculation continue processing. Contradictory tool guidance requiring a lookup was removed. This is not a fuzzy name matcher or a publisher-specific shortcut.
- Request setup waited for operational event persistence before starting useful work. Those observations now start immediately and finish under Next.js `after`; authoritative quota, local budget, publication and task checks remain awaited. Chat focus prepares the unpaid session while the visitor types. Mailbox pruning/creation and initial session/viewport reads overlap, retaining their validation and lifecycle boundaries.
- The prior photo answer lost its HTTP connection before headers. Its precise underlying network cause is unknown. Normal SSE completion now returns the result immediately and drains a small bounded tail to EOF instead of cancelling every successful connection. New transport events distinguish headers, first event, completion and failure, with bounded request identifiers. A subsequent WebSocket request reconnects a closed socket without reusing its connection-local response cache. Failed paid requests are never replayed automatically; missing usage remains reserved.
- The Voice/Chat picker uses one persistent Motion highlight which slides and can reverse between fixed labels. It remains borderless, centered on the separator, keyboard accessible and at least 44px high. A live change to reduced motion immediately settles the highlight.
- Cross-publisher testing found that a recognized collection name allowed unrelated residual words to become a literal local filter. Unexplained collection qualifiers now defer intact to the model, while exact names and explicit keyword filters retain their fast path.
- A rich answer could retain an obsolete empty-result placeholder as supporting content. Only placeholder-only empty support is omitted when an answer is primary. Real records, clarification, estimates, research and actions remain; task state and history are preserved and screen acknowledgments describe the actual visible composition.
- A text-only model answer could advance the server task generation without updating the browser's retained query metadata. Successful completion now supplies an exact task checkpoint from the existing final state. The browser accepts it only for the same session, query, result, operation and local interaction. This synchronizes authority without replacing the displayed answer or bypassing stale-command rejection. Old-generation viewport observations pause during the model handoff. For legacy/error cleanup without a checkpoint, one unpaid reconciliation preserves displayed clarification/content only when the exact session/query/result/operation still matches; changed results restore server-confirmed state and newer manual interactions retain ownership. No paid request is retried.
- Compact voice context now retains a short prior answer, including its qualification, when the entire answer fits the existing 1,951-byte ceiling. Longer answers receive an explicit backend-recall notice; the full accepted text remains in backend context. No partial sentence or qualifier is silently truncated, and no speech verification is claimed.

## Live observations

These are individual development-server observations, not a controlled latency benchmark or a promise that every request finishes this quickly.

| Site / request | Result | First visible | Committed | Model requests |
| --- | --- | ---: | ---: | ---: |
| Cuts & Slices: vegan slices under $7, cheapest first | Correct two $6.75 options; cold session preparation was still on the path before focus warm-up | 8.89 s | 10.21 s | 1 |
| Cuts & Slices: compare their slice/whole-pie prices | Correct complete comparison, using current query directly | 4.89 s | 5.76 s | 1 |
| Cuts & Slices: Vegan Speciality photo and identity qualification | Photo and final answer both completed; no transport failure | 5.19 s | 8.35 s | 2 |
| GoSite: all six Indigenous nations named in the guide, before parser correction | Incorrect empty literal filter; diagnosed and corrected in shared parsing | — | 2.62 s | 0 |
| GoSite: compare Coast Salish and Chinook without guessing | Correctly distinguishes shared guide content from missing group-specific details; old empty support exposed the composition issue | — | 11.00 s | 3 |
| GoSite: coastal versus inland rainfall | Correct short source-grounded answer | — | 4.30 s | 1 |
| Doc's Cake Shop: Blue/Red Velvet prices and photos, before direct named comparisons | Correct $9 slice comparison and explicitly illustrative images; unnecessary lookup/binding repair exposed a further named-comparison speed opportunity | 11.18 s | 18.06 s | 5 |
| Doc's Cake Shop: three Blue Velvet and one Red Velvet, before tax | Correct $36 estimate; no ordering or payment action | 8.60 s | 12.47 s | 3 |

The previous recorded current-result comparison took 8.92 s to first display and 13.34 s to commit with three model requests. This pass's equivalent wording used one request. The successful photo retest establishes completion for that request, not elimination of all network failures. Rich synthesis and multi-step requests remain slower than simple retrieval.

Private ignored recording IDs: `648362db-e6db-4690-ad5e-b5598f0fa255` (Cuts), `72107857-9084-435d-891e-cc4ae2a593d0` (guide), `cd2c27d5-46a5-4e02-8568-e4649f852dcc` (cakes). Recordings and conservative budget ledgers are retained locally, not committed.

## Design rationale and documentation

The existing website already has distinct template opening/section choreography, bounded image treatment and finite scroll effects. This pass keeps those patterns and targets the picker and stale supporting content instead of adding competing decoration. Motion's [layout guidance](https://motion.dev/docs/react-layout-animations), [accessibility guidance](https://motion.dev/docs/react-accessibility) and [scroll-animation guidance](https://motion.dev/docs/react-scroll-animations) inform continuity, fixed readable labels, reduced motion and bounded scroll work. The existing public Motion dependency is sufficient; no paid component package or dependency upgrade is required.

Transport decisions follow [OpenAI request diagnostics](https://developers.openai.com/api/reference/overview#debugging-requests), [WebSocket connection recovery](https://developers.openai.com/api/docs/guides/websocket-mode#reconnect-and-recover) and [Undici body handling](https://undici.nodejs.org/). Connection reuse is an engineering correction, not a measured guarantee about provider latency.

## Final live retest after the implementation freeze

Fresh pages used the normal visitor chat, with no injected results. The same $5 allowance continued across each recorder.

| Site / request | Result | First visible | Committed | Model requests |
| --- | --- | ---: | ---: | ---: |
| GoSite: all six Indigenous nations named in this guide | Correct six published records; the previously failing natural wording now reaches the model intact | 8.25 s | 9.66 s | 1 |
| GoSite: coast versus inland rainfall, briefly | Correct wetter-coast/rain-shadow explanation; retained real supporting records | 6.82 s | 7.53 s | 2 |
| GoSite: “Show me Indigenous Nations Named.” after the answer | Correct six-record collection; no stale-generation error | Not separately captured | Not separately captured | 0 |
| Doc's Cake Shop: compare Blue Velvet/Red Velvet slice prices | Correct $9/$9 comparison using exact published IDs, without a lookup or closing model round | 4.76 s | 5.48 s | 1 |
| Doc's Cake Shop: same comparison with published photos | Comparison, both published image references, qualification and final answer completed | 5.25 s | 11.84 s | 3 |

Guide Back restored the prior explanation with its supporting collection; Forward restored the latest collection. No new model call was needed. Recordings: `80e46ad8-222e-47ff-b7bc-574e0344e4af` (guide), `d226a820-ea41-4233-aae6-aba0a3b0e087` (cakes).

The compound cake request improved from 11.18 to 5.25 seconds for its first result and from 18.06 to 11.84 seconds to commit, with five model requests reduced to three. This is one before/after observation with different session context, not a controlled performance claim. The request was not prematurely cut off after its price comparison. Neither final recording had a provider transport failure.

One displayed “Red Velvet — test image” looked blank. Browser inspection confirmed successful decoding, positive natural dimensions, full opacity and an unobstructed image element. Opening its current-publication source showed the same solid beige image. This is a source/test-data quality issue, not failed loading or Motion. No publisher data was relabeled or republished in this pass. Future ingestion/review should flag flat or uninformative images without inventing identities or silently discarding authorized media.

## Verification

- Production build (including TypeScript) and whole-project ESLint passed after the final runtime edits.
- Root integration groups passed: 56 focused core tests, 52 transport/routing/budget tests, and 17 comparison tests. The final named-comparison implementation additionally passed its 35 focused cross-domain chat/voice cases; these overlap with the integration groups and are not an additional unique total.
- **50 distinct offline browser checks passed; one optional published-site test was skipped.** Coverage: 17 picker/speed cases, 11 retained-answer/history cases, seven regular-website Motion cases, and 15 mobile-component/template-composition cases. Synthetic publishers include products, services and a travel guide. Narrow widths, enlarged text, live reduced-motion changes, cancellation, failed-answer recovery, clarification preservation and Back/Forward are covered.
- Two test-harness issues were corrected: retained tests now use separate isolated workspaces so their accumulated sites do not hit the unchanged 12-site fixture quota; the mocked reduced-motion timing test pauses its clock safely ahead of RPC overhead, retaining the same 300ms paint-acknowledgment assertion. Final affected cases passed. These were not changes to production limits or a relaxation of display-speed acceptance.
- Regular website opening/scroll behavior was verified across the existing three templates, including Off/reduced motion and Studio scrolling. It is existing choreography verified this pass, not a newly invented set of effects.
- Live chat was exercised on all three approved local sites. This does not verify physical iPhone microphone permission, voice interruption, audible accuracy or mobile connection recovery. No deployment occurred.

Browser evidence for the shared picker:

- [393px mobile screenshot](screenshots/complex-motion-2026-09-27/chat-picker-393.png)
- [1440px desktop screenshot](screenshots/complex-motion-2026-09-27/chat-picker-1440.png)

## Remaining work and closeout

Complex latency is improved, not solved. Fresh-session retrieval still took about eight seconds to first display, and the compound photo answer took almost twelve seconds to finish. Next work should separate session/publication setup, model inference, tool execution and display acknowledgment costs using the new diagnostics, then remove only proven redundant reads/rounds. Explanations and research must not be dropped to make a timing number look better. Physical iPhone voice acceptance remains a separate recorded check. The original pre-header provider closure has no proven underlying network cause; the transport recovery/cleanup changes and passing retests do not guarantee future provider availability.

All five recordings from this pass are stopped. The conservative daily accounting is **$2.946261 of $5**, including the full reservation for the earlier unknown-usage failure; **$0.792890** was added by this pass. This is the local budget guard's conservative accounting, not a provider invoice. The remaining $2.053739 is not permission to reset or extend the allowance. The local development server exited cleanly, and listener checks confirmed ports **3220, 3221 and 3225** are stopped. Final scoped test-file lint and `git diff --check` passed. Changes remain local and uncommitted; no deployment or push occurred.
