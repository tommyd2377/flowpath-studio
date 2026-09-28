# AI editor setup

The AI editor is implemented as an optional server feature. It uses OpenAI's Responses API with `gpt-6-astra`, high reasoning effort, Standard processing, and a strict structured response. Shared defaults live in `lib/ai-model.ts`; the editor allows up to 16,384 output tokens including reasoning, while the existing proposal schema keeps visitor-facing content bounded. No new SDK dependency is required. [Model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra), [structured responses](https://developers.openai.com/api/docs/guides/structured-outputs).

## Enable it locally

1. Finish Firebase sign-in and site storage first. Real AI is available only to signed-in Firebase workspaces; `VOICE_BACKEND=demo` always uses offline commands.
2. In this project's existing, ignored `.env.local`, add your OpenAI project key as `OPENAI_API_KEY` and set `VOICE_AI_MODE=openai`. Enter the key locally; never paste it into chat, source code, screenshots, or a `NEXT_PUBLIC_` variable. Keep the existing Firebase settings as they are.
3. Restart the development server using Node 24 (`nvm use`, then `npm run dev`) and reload the dashboard. The composer will say **AI editor** when the server configuration is present. This status does not verify key validity or API access.
4. Sending a message now makes one paid OpenAI request. Start with a small edit, such as “Make my introduction warmer and more concise.” Read the proposed wording, choose **Apply to draft**, inspect the preview, then **Publish** when ready.
5. Set `VOICE_AI_MODE=demo` and restart to return to offline commands. Missing or invalid AI configuration fails clearly; it does not silently substitute a demo result after a failed AI request.

No credentials, auth providers, billing settings, deployment settings, or cloud resources are changed by installing this code. No paid request was made by the implementation's mocked tests. Any agent-run live verification requires separate explicit approval for this app and a request budget.

## Documents and privacy

OpenAI receives the current saved draft, the last six conversation messages (up to 1,000 characters each), the names and IDs of this site's available logos, the current request, and only the text documents selected beside the composer. Select at most three `.txt` files; each contributes up to its first 8,000 characters. The server rejects foreign-site file IDs, PDFs, and image files as document context.

This text-editor request does not receive image bytes or extract PDFs. Logo selection uses existing image names/IDs. PDF extraction and semantic review are separate [Knowledge workflows](platform-foundation.md); selected-image analysis is a separate, explicit [Photos action](photo-library.md). The text editor has no tools, URL fetching, file upload endpoint, or access to domains, billing, other sites, or publishing. Uploaded text is reference material, not trusted instructions. All proposed values still pass the site's normal validation and ownership checks.

Requests use `store:false`. This disables stored Responses application state; it is not a claim of zero provider retention. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

## Limits and recovery

- At most **10 attempted generations per owner per UTC day**, shared across all their sites, and **100 per Firebase project per UTC day**. Text edits, connected knowledge interpretation/correction and connected photo interpretation share this reservation pool. Visitor requests use a separate ledger. These are request caps, not dollar budgets or subscription entitlements.
- One attempt per owner per minute. The text editor has a 30-second request timeout, at most 6,000 output tokens, and bounded input (60,000 context characters / 120,000 UTF-8 bytes, plus the current request of up to 4,000 characters). Other interpretation paths have their own payload/output limits; see the [architecture](architecture.md).
- The server atomically reserves an attempt before calling OpenAI. Model calls happen outside Firestore transactions. No automatic API retries, background workers, triggers, or queues are created.
- A request ID can only be reserved once. Refusals, timeouts, invalid output, and failed saves still consume that attempt. If a response is lost, **reload first** to look for a saved proposal. Re-sending the same in-flight request never calls the model again. After checking the result, editing or clearing the message starts a new request; it may use another attempt.
- If the site changed during generation, the result cannot overwrite it. Reload and ask again against the current draft. Only Apply updates the draft; only Publish updates the public snapshot. Undo continues to work.

Daily counters live in dedicated `voiceAiUsage` records; `voiceAiOwners` stores the cooldown across day boundaries. Permanent `voiceAiRequests` reservation records hold request metadata, not prompts or keys; they prevent replay after process restarts and UTC rollovers. At most 100 are created per day with the current cap. Studio shows recent activity and measured tokens for instrumented knowledge, media and visitor paths; the text editor does not yet report its per-call token usage. It does not calculate invoices or enforce monetary spending limits. Counter/reservation retention and cleanup remain future work; keep reservations when exact replay protection matters. Existing browser-deny Firestore rules cover all three collections. No rules deployment or new indexes are required for these document reads/writes.

Before a public launch, add abuse controls for account creation and a production usage/budget policy. Do not treat these MVP caps as a complete public-service billing system.
