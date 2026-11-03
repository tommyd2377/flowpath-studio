# Visual Display (local candidate)

October 30, 2026. Built against lifecycle checkout `001ed14` plus the completed ten-waveform patch, in a private source-only copy. FPC owns sequential integration. This document does not authorize live calls, deployment, cloud provisioning or publication.

## Creator and visitor behavior

Plugins → Visual Display → Apply Visual Display enables a curated built-in capability. Add up to four PNG/JPEG/WebP pictures, give each a unique title and an accurate description/caption, and optionally add accompanying text. A map is an ordinary picture. There is no layout editor. Save draft stays private; the existing explicit Publish action selects the reviewed visitor snapshot where publishing is available.

The conversation display starts closed. Ask “show the Town map,” “next picture,” “previous picture,” “add that explanation,” or “hide the display.” GPT-Live uses its existing managed Luna delegation to call `update_visual_display`; the browser applies the validated operation deterministically. Optional buttons/selectors invoke the same operation. No second model, image-generation service, search, URL fetching, paid retry or per-transcript-fragment model request is introduced.

The conversation models receive a bounded catalogue of IDs, titles, descriptions and accompanying text, **not raster bytes**. They must describe supplied creator descriptions honestly and must not claim to have seen/analyzed the picture. The existing creation reviewer separately inspects the actual images as part of its one bounded version review.

One picture is selected at a time. With accompanying text, the host chooses a two-column desktop layout and a stacked mobile layout; without text it uses the picture layout. The complete picture retains its aspect ratio and can scroll with its caption/explanation. Picture selection/next/previous loads that picture's creator text. Selecting a different image resets only the content scroll to the top, retaining navigation/selector focus. Explanation updates on the same image preserve the reader’s position. Show retains the selection and current visitor explanation; replace_text/append_text change only this call's explanation.

Hide unmounts the view immediately, restores focus when a display button held it, retains its content and leaves voice connected. Selection pauses dictation without losing notes or Knowledge passages. Switching cached presentations never searches again or restarts voice. Existing text/source buffers, dictation, interruption, playback-driven waveform, End/Escape and confirmed microphone/provider cleanup remain owned by the host. End ignores late provider work and retains requested content for local viewing; the next voice call resets Visual Display. Existing Text Box restart retention is preserved. Identity/navigation resets unmount the entire host.

## Content and security contract

`WaveformInput.visualDisplay` is optional or null for legacy records:

```ts
type VisualDisplayConfiguration = {
  type: 'visual'; version: 1;
  images: { id: string; title: string; description: string; src: string; text: string }[];
};
```

- Four pictures maximum; exact keys, unique IDs and case-insensitive unique titles. IDs have 1–64 ASCII letters/digits/underscores/hyphens; titles are 1–80 characters, descriptions 1–500, accompanying text 0–2,000. Control characters are rejected.
- Browser uploads accept at most 5 MiB and resize the full picture into a bounded raster. Server Sharp decoding is authoritative: static PNG/JPEG/WebP only, at most 32 KiB and 1,024 px per side, checked pixel budget/format/pages, metadata stripped, canonical WebP. Oversized/undecodable material is rejected; it is never silently dropped or truncated. Unchanged server-stored raster bytes can be reused exactly.
- The entire serialized configuration is capped at 192 KiB. Only waveform Save and creation-review POST increase their JSON ceiling to 512 KiB, covering bounded pictures plus the existing portrait and worst-case Unicode prompt. Generic `readBody`, portrait limits and other routes retain their limits.
- No SVG, HTML execution, remote URLs, arbitrary model-selected URLs, external uploads, new buckets, new collections or client permission flags. Images are inline data in the already-authorized selected waveform snapshot. Text uses the existing sanitized Streamdown renderer, with external links/media disabled.
- Owner lookup and the atomic ten-waveform cap stay unchanged. Each selected waveform has its own config; list projections contain only IDs/names. Other accounts cannot read/save it by guessing IDs.
- Canonical review includes every normalized image byte, title, caption and text. Null/absent Visual is omitted so old canonical digests remain identical. Changes stale the approval and client key; existing pending/manual/blocked/revoked and policy gates still govern Save, publication and admission.
- Existing single Luna creation-review input includes all image parts and captions/text; token preflight, budget, failure/manual and no-retry behavior remain. The founder queue shows the exact reviewed pictures and text. No model call is made simply to display an installed picture.
- Explicit publication projections select only their stored approved snapshot. Saving a new private draft cannot update that snapshot or its tool catalogue. Explicit publishing copies the reviewed config by value; review revocation/current policy checks remain authoritative. Anonymous curated Franklin visitors receive neither Visual config/images nor its voice tool/catalogue, even if the curated snapshot contains Visual. Its existing first-use snapshot capture is not publication consent for this new capability. Owner-private Visual and snapshot digest/revocation checks remain intact. Public Knowledge access is unchanged.

## Small reusable extension points

Composition today: Text Box provides dictation/notes; Knowledge provides document retrieval and sources; Visual Display provides a picture with optional accompanying text. These are separate capabilities sharing the host/carousel and safe `StreamingText` renderer. Text Box and Knowledge use `LiveTextPanel`; Visual Display uses `DisplayFrame` and `DisplayContent`. Visual Display does not replace Text Box, and rendering text does not require creators to apply the dictation capability.

Proposed: future plugins such as Evaluation can consume Knowledge and reuse the text/image presentation pieces without asking creators to enable those building blocks separately. That is composition of capabilities and components, not an executable plugin marketplace or an implemented general dependency framework. The host continues to own positioning, visibility, focus and transitions.

`lib/visual-display.ts` defines plain typed text/image content, strict configuration/action validation, bounds and the description-only voice catalogue. It contains no identity, storage, media or permission authority.

`components/DisplayFrame.tsx` supplies the host-sized labeled/scrolling frame, state announcement and fixed controls. `DisplayContent.tsx` supplies the safe text and raster pieces and one small mixed layout. `VisualDisplay.tsx` is a working built-in example: it maps those pieces to one selected image and sends typed actions upward. The existing carousel owns transitions; the host owns visibility, focus return, cancellation and media. Text Box/Knowledge keep their working controllers/renderer.

`createVisualDisplaySession` is the bounded deterministic controller. The existing `createLiveTextSession` composes its executor into `createPluginSession`, retaining a single owner per completed function call, deduplication, cancellation, generation/transcript barriers and one continuation after settled outputs. Local controls use that same validated action and invalidate obsolete delegated work. New session authority creates a fresh Visual controller; content never grants authority.

```ts
// Registered action; no owner, provider, account or arbitrary URL arguments.
{ action: 'select', imageId: 'town-map', text: '' }
{ action: 'append_text', imageId: '', text: 'The square is west of the river.' }
{ action: 'hide', imageId: '', text: '' }
```

`read`, `show`, `hide`, `select`, `next`, `previous`, `replace_text` and `append_text` are the only actions. Only select accepts an image ID; only text operations accept nonempty text. Unknown images/extra arguments/oversized text fail without changing display. Read does not reveal it. Read/edit pairs reject obsolete revisions. Partial, duplicate, stale and ended-call provider events never gain a separate executor or continuation.

See `tests/visual-display-fixture.ts` for a complete synthetic two-picture example and `tests/visual-display.test.ts` for the protocol/controller/renderer example. A future built-in can reuse the frame/content/dispatcher boundaries. There is no published SDK, remote code loading, marketplace or speculative layout engine in this change.

## Verification

All automated evidence uses synthetic image fixtures, fake accounts/providers/media, temporary fixture storage and an isolated browser. Source lint/types/tests/build, browser regression results and the sequential integration receipt are recorded below after completion. Real spoken intent recognition, latency, microphone quality, hosted persistence and live multimodal review remain unverified here; they require separate explicit authorization. No live API call, real account action, cloud mutation, deployment or external communication is part of this work.


### October 30 isolated evidence

- Node 24.6.0, source-only copy; private environment/runtime files were excluded. Installed dependencies were copied locally without installation/upgrades.
- `npm run check`: lint, types, 459 source tests and production build passed after the curated privacy gate and selected-picture scroll fix. A later invalid-input-message punctuation correction changes text only.
- Full `npm run test:browser`: 117/118 passed. The one keyboard-order failure came from placing Visual before existing plugins. Visual was moved after Text Box/Knowledge; the final focused rerun passed all five affected cases, including that keyboard check, anonymous Franklin, both Visual desktop/mobile scenarios and creator upload/selection. This covers 118 unique mocked cases across the full run and corrected rerun, not a single final full-suite pass.
- Final desktop Visual case uses motion enabled; mobile uses reduced motion. Both cover delegated actions and clicks, explanations/escaped HTML, next/previous/selector, long-content scroll reset with navigation focus retained, Hide/late actions, notes and Knowledge independence, Escape/End cleanup, after-End reopening and fresh-call Visual reset.
- Desktop 1280×720, mobile 390×844 and creator-settings screenshots were visually inspected. Synthetic content only.

`npm run test:browser:paid`: all eight existing synthetic publication/payment-preview checks passed. Both temporary test servers (3225/3226) stopped after testing.

FPC will append sequential integration verification. Source/mock results do not establish real spoken intent recognition, latency, hosted image persistence or live image-review acceptance.

## FPC sequential integration receipt — October 30

FPC independently reviewed the schema/normalizer, exact multimodal review input, snapshot privacy, dispatcher fencing and display lifecycle. The final worker manifest contains 45 changed/new files (11 new), SHA-256 `d329c10613def0a476f96a70673adf7874b8e62108d674cf49ef637e5e2cd6a9`. Every baseline hash matched the active `001ed14` checkout plus the completed ten-waveform handoff before application; every delivered result matched the independently tested copy. The shared checkout was written only by FPC during this integration. No unrelated path was reset, stashed or discarded.

The fresh source-only copy `/private/tmp/flowpath-visual-integrated-check-btr5eg1i` passed `npm run check` (lint, types, **459/459 source tests**, production build), a complete **118/118** mocked browser run, and **8/8** synthetic publication/payment-preview checks. Desktop, phone and creator-setting fixture screenshots were independently inspected. The first browser attempt was blocked by the filesystem/network sandbox when binding port 3225; the permitted isolated rerun completed successfully. No application failure or live-provider call was involved. Logs are `/private/tmp/flowpath-visual-integration-{check,browser,publication}.log`.

The integrated changes remain **uncommitted and undeployed** on `codex/hosted-tester-demo`, base `001ed14ecb876126c43a09599a2e664468f6bd13`, in the lifecycle checkout. Main on GitHub and production were not changed. No dependency manifest, lockfile, rule, deployment/environment configuration, secret, provider account or real account was modified. The regular app on port 3220 was not started; temporary fixture servers are stopped after verification. Real spoken commands, latency, Google/hosted persistence and multimodal provider judgments still require separately authorized live acceptance.

## October 31 local picture-save follow-up

Real local creation exposed a missing case: the browser prepared a 32,330-byte WebP, but the server's fixed quality-80 re-encoding enlarged it to 36,504 bytes and rejected it before AI review. Normalization now tries a bounded set of encoding qualities, preserving dimensions, static-raster decoding, metadata stripping and the existing 32 KiB limit. The same input deterministically produces the same reviewed/saved bytes. A local runtime cache-version update refreshes the saved account handlers without losing durable Firebase sessions.

A synthetic detailed-picture regression failed before the fix and passes after it. One subsequent normal AI review passed, and the real signed-in localhost app saved the new private Visual Test waveform with its picture and accompanying text; the existing waveform remained listed separately. No publication, voice test or deployment was performed. This confirms creation/review/save, not spoken picture selection, latency or hosted operation.

The draft initially had empty required instructions; adding the short test instructions let the normal background review start. Save then reused the completed approval without another AI review. Final Node 24 checks in the isolated source copy passed `npm run check` (lint, types, **460 source tests**, production build) and all **119 mocked browser tests**. The fixture server stopped afterward; the real app on port 3220 stayed running for manual testing.
