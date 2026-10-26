# Prompt limits and the small reasoning backend

At the user's explicit October 25 request, the prompt limit is 8,000 characters and GPT-Live can delegate factual questions to a small reasoning model. This replaces the earlier voice-only milestone's no-backend behavior; it does not authorize extra models, web tools, retries or production deployment.

## Prompt text

The previous textarea `maxLength=4000` caused the browser to discard characters during long pastes. The new editor has no native clipping limit. It retains the complete draft, shows a character counter, marks over-limit text invalid and disables Save. The save handler also checks the limit, and the owner-checked server endpoint separately rejects prompts above 8,000 without replacing the previous saved record. Supported prompts retain their complete ending and stable waveform ID after reload.

Existing prompts are not automatically rewritten. A saved prompt exactly at the old 4,000-character boundary receives a conditional reminder to re-paste its original if it was longer. Previously discarded text cannot be reconstructed from that record. The same prompt snapshot is sent to the voice frontend and reasoning backend when a new conversation starts. Existing conversations keep their original configuration.

## Model and delegation

`lib/voice-config.ts` selects `gpt-live-1` for audio and managed `responses` delegation with **`gpt-6-luna`**. The user explicitly selected Luna on October 26 as the default everywhere in the active Studio application; the prior nano model is no longer a default or fallback. Official Luna documentation supports `reasoning.effort=none` and Responses function calling. Standard short-context prices consulted October 26 are $0.10 per million uncached input tokens and $0.50 per million output tokens. This is not a measured claim of end-to-end voice or text latency.

Backend settings are server-selected: `reasoning.effort=none`, standard `service_tier=default`, `max_output_tokens=1024` and no parallel tools. Without Text Box, `tools=[]` and `tool_choice=none`. The enabled plugin registers only `update_text_box`, selects `tool_choice=auto` and allows up to 4,096 output tokens to encode bounded text replacements; its operations can read, start/stop dictation, replace, append, clear or undo this visitor's panel. The backend returns concise useful facts; the voice delivers them in the saved persona. There is no hosted web search, backend model fallback or application retry. Backend token usage is billed separately from voice seconds; paid wallet accounting remains time-based and paid voice/Checkout remain paused under their existing launch block.

The Live prompt uses the documented `Generate <|SpawnThinking|>` routing instructions. Dates, biography, missing factual context and reasoning can delegate; greetings, brief clarifications and facts already provided need not. The voice may give one short in-character thinking acknowledgment, waits for the result, and then answers without claiming to have browsed or exposing internal reasoning. A persona instruction alone does not make historical facts verified, and this change does not guarantee perfect recall.

The provider supplies conversation context to managed Responses and returns the result to GPT-Live. The application creates no separate Responses HTTP request and does not collect transcripts to build a backend prompt. The sideband accepts `session.delegation.created` with `target: responses` without sending the former unavailable-capability reply. Duplicate delegation IDs do not trigger extra application work. Unexpected client-tool delegations retain the deterministic unavailable-tools response. Failed/incomplete nested backend responses and configuration errors close through the existing supervisor, without retries. The existing 64-delegation guard, cancellation, deadline, durable settlement, microphone cleanup and explicit browser-only diagnostics remain.

No application conversation/history store or transcript/audio logging was added. `store:false` remains the Live setting; provider retention is governed separately by OpenAI policy, and this is not a zero-retention promise.

## Verification boundaries

Synthetic tests cover exact 8,000-character persistence, rejection of 8,001 characters without overwriting, preservation of over-limit drafts, legacy-boundary warnings, persona propagation to both models, the allowlisted cheap backend configuration, managed delegation handling and failure cleanup. Browser regressions keep real provider traffic disabled. No paid voice/backend call is needed for those checks.

October 25 local verification: `npm run check` passed lint, type generation/typecheck, 186 unit/integration tests and the production build. The standard browser run passed 43 existing cases; the new prompt case initially matched Next's route-announcer alert as well as the intended form alert. Scoping that assertion to the main form and rerunning the affected case passed, covering all 44 standard cases across those runs. All five synthetic paid-flow browser cases passed. `git diff --check` passed. Codex started zero paid voice/backend conversations; the existing saved Franklin prompt was preserved.

Real model access, managed-delegation compatibility, answer quality, in-character delivery and latency need the user's manual listening test. Start a new conversation after updating the prompt. Useful questions include first European travel, printing apprenticeship and a follow-up referring to the previous answer. Compare a direct provided fact with a question requiring backend knowledge; a thinking acknowledgment alone does not prove a successful backend answer. The existing opt-in browser diagnostic report can show a Responses delegation without server transcript logging.

Official sources consulted:

- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [Standard API pricing](https://developers.openai.com/api/docs/pricing)
- [Managed Responses delegation](https://developers.openai.com/api/docs/guides/live-delegation#configure-responses-delegation)
- [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting#recommended-prompt-structure)
