# Astra defaults, published knowledge and assistant identity

September 27, 2026. Implemented in the current FlowPath Studio checkout. This pass is offline/mocked and local-browser verified; it is not a live provider, microphone or latency acceptance result. No customer draft, publication, credential, deployment configuration or API budget was changed.

## Connected model policy

All active connected Responses paths now default to **GPT-6 Astra, high reasoning, Standard processing**: source/website interpretation, image interpretation, Studio editing, visitor chat, external research and delegated voice tasks. The shared defaults are in `lib/ai-model.ts`, derived from the standalone Live protocol's backend constants. GPT-Live 1 remains the speech model. No paid Fast tier, model fallback, automatic retry or additional tool round was added.

Output ceilings include reasoning: visitor/research/backend requests allow 8,192 tokens, Studio editor/media 16,384, ingestion 32,768. Visible/spoken length preferences remain separate and concise. Connected Studio transport timeouts and Studio's voice-backend deadline allow 90 seconds; the chat task retains its existing separate deadline. These ceilings prevent premature truncation but are not response-time targets or proven improvements in speed. Higher reasoning can increase latency and cost.

Existing published websites do not get reimported or redesigned simply because the model default changes. The ordinary website still uses the shared validated React templates and Motion system. The separate FlowPath repository was not migrated in this task.

## Published knowledge available before the first question

`lib/visitor-voice-priming.ts` builds one startup reference message from the current publication: website prose, catalog records and qualifications, collection/relationship information, published capabilities, approved photo labels/associations and approved video transcript intervals. It includes publication identity, an as-of timestamp and exact coverage counts. It excludes private sources/drafts, and cannot establish live inventory or claim that an action happened.

Small publications can fit completely. Larger publications explicitly report omissions; omitted information is still accessible through the backend and must not be described as absent from the website. The packet admits whole records, retaining competing assertions and qualifications, and is conservatively bounded to **7,680 UTF-8 bytes including its envelope**. Live's documented startup input limit is **8,192 tokens**, independent of session instructions. This byte bound leaves unused capacity for ordinary English in exchange for a conservative limit without assuming an undocumented tokenizer. It is not a claim that all large-site content is preloaded. Future expansion should be measured against startup latency, provider tokenization and direct-answer quality.

Both publication formats are supported. Large v2 catalogs reuse the publication-scoped context and fetch at most 48 full authorized records; total coverage remains explicit. Normalizing both sides before publication comparison prevents harmless JSON field-order differences and retired renderer fields from blocking valid voice startup. Real content/revision changes still fail the fence before records are read.

Live can answer directly from sufficient current published context even if it has never displayed that information. Straightforward general knowledge also stays in Live. Missing publisher facts, careful reasoning, calculations, research and display/actions use the backend; actions still need normal browser acknowledgment. The old question-shaped 1.8-second fallback no longer forces every factual question into a paid backend request. Explicit action recovery remains. A direct answer clears its pending status without discarding the transcript needed for a genuine later delegation.

The existing heartbeat checks publication currency every 15 seconds, with one check in flight. A changed or unverifiable publication closes the old session through its normal cleanup; reconnecting loads the current version. This bounds stale session knowledge rather than promising instantaneous per-word freshness. Startup diagnostics now include `knowledge_ready` to separate preparation from provider connection time.

## Publisher role and self-description

The existing optional `visitor.assistantPurpose` is now prominent under **The Voice → Assistant role → Role and identity**. No schema migration is needed. A publisher sets the assistant's continuing identity, audience and useful outcomes independently of its welcome text and up to three opening topics.

The same role builder is included in chat and Live instructions. “Who are you?”, “What are you?” and “What is your purpose?” explicitly answer from that role in first person; a request to recite the assigned role repeats the quoted publisher description. The assistant identifies as the website's AI assistant. This does not grant human identity, credentials, facts or capabilities, and needs no lookup/delegation. With no role configured, both channels use a helpful website-guide role. Greeting edits do not replace it.

Saving only updates the draft. Publishing makes that role available to visitors; reconnecting uses the new published configuration. Browser checks cover role persistence, greeting independence and the private-draft boundary. Prompt/request tests establish what is sent, not that every model response will comply.

## Deferred capacity and selection follow-up

**September 28 update:** the user activated this work and it is now implemented locally. The expanded briefing, supported-field budgeting approach, measured coverage and outstanding live acceptance are documented in [the capacity report](qa-voice-priming-capacity-2026-09-28.md). The historical deferral below no longer applies.

**AI-PRIMING-CAPACITY-01 — approved future work, deferred from the current pass.** The user clarified on September 27 that the coordinator must remember and resume this later without requiring another request. The Dynamic to-do coordinator owns follow-up at the next engineering prioritization and implementation in a subsequent suitable work batch, subject to newer priorities or deferral. Future work will use accurate supported token budgeting and a compact publication-wide briefing that prioritizes useful knowledge across the site, with detailed records retained for lookup. Preserve qualifications, competing facts, truthful partial coverage and applicability across publishers. Evaluate startup latency, cost and answer quality before changing the budget or selection policy. This deferral leaves the current 7,680-byte packet limit and fixed-order selection unchanged; the shared master backlog carries the same task ID. This approval does not itself extend API budgets or authorize deployment or customer publication.

A daily 10 a.m. thread follow-up was created on September 27: `follow-up-on-voice-knowledge-priming`. It was paused on September 28 after local implementation and verification; the shared backlog retains the normal live acceptance check.

## Verification and remaining acceptance

- Final production build passed, including TypeScript; full ESLint and `git diff --check` passed. After the identity follow-up, **171 focused offline tests passed** across role/policy, request builders, voice/session control, priming and budget accounting. These overlap with the earlier full run and are not an additional unique project total.
- The full server run at the integration checkpoint reported **980 passing tests and one known sibling-runtime byte-parity failure** (981 total). The separate FlowPath copy still differs from Studio; this was already failing before this migration. No assertion was weakened and no sibling file was changed to conceal it.
- All **53 presentation tests** passed separately because the full test script stops at that server-suite failure.
- All **four isolated Studio/voice-settings browser scenarios** passed with synthetic data and provider-free previews, including desktop/mobile greeting editing, role save/reload/publish and unchanged customer publications. They made no voice-provider calls.
- Desktop and mobile Studio screenshots were visually inspected: the role field is prominent before voice/language controls and uses the existing responsive settings layout. The isolated browser server exited normally; listener checks confirmed ports 3220, 3221 and 3225 were stopped.
- Focused coverage includes Astra/high request bodies for each connected builder, encrypted reasoning continuation, cache-prefix freshness, incomplete-response rejection, bounded budget accounting, direct-answer/action separation, publication invalidation, full/partial knowledge coverage, conflicting facts and two publication formats.
- The local budget guard now bounds Astra Standard/Fast and long-context/image/search accounting without enabling them or changing a cap. Unknown usage keeps its reservation; unsupported/accounting-overrun cases block further paid calls. The existing Live-duration reservation is unchanged.

**No paid API calls were made in this pass.** The earlier day's conservative total remains $2.946261 of its $5 allowance; this is prior local accounting, not a provider invoice or a reset allowance. No live latency or spoken-quality claim follows from these checks. Still to verify: actual Astra access/completion with representative imports and complex tasks, direct Live answers from prose and qualified facts, exact spoken phone numbers, identity replies, initial connection cost/latency, and physical iPhone interruption/reconnect behavior.

Suggested short recorded acceptance: ask who the assistant is; ask its purpose; ask it to recite its assigned role; ask a qualified fact from the site's published prose; then request a visual action. Identity/fact replies should use sufficient primed context while the visual action still follows confirmed execution. Changing the greeting alone should not change identity. Repeat with an unrelated publisher role and an unset role.

References: [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [reasoning](https://developers.openai.com/api/docs/guides/reasoning), [Live startup input](https://developers.openai.com/api/docs/guides/live-conversations#seed-a-session-with-prior-conversation), [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation). Current prompt wording and interpolated values are indexed in [the prompt inventory](model-prompt-inventory.md).
