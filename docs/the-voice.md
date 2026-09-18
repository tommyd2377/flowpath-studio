# The Voice: per-site conversation settings

Implemented September 16, 2026. Studio now has **The Voice** beside Branding. Website content and opening composition stay in Content; all conversation settings live together in The Voice. Changes use the existing Save draft → Publish workflow.

## Publisher guide

1. Open **The Voice** for the current site. GPT Live 1 is the fixed voice model.
2. Choose a speaking voice and language. Start with **Quiet**, **Helpful** or **Expressive**, then adjust answer length, warmth, formality and energy. Open **Conversation habits & pronunciation** for pace, listening acknowledgements, pauses, follow-up questions, small talk and pronunciation hints.
3. Choose **Amber**, **Slate**, **Ocean**, **Teal**, **Jade**, **Indigo**, **Plum**, **Rose** or **Copper** for the waveform and chat controls. Amber is the new-site default. This color is independent of your website palette; it does not recolor website buttons, content cards or expanded publisher details.
4. Set the welcome message, optional approved greeting points and who speaks first. Set the assistant purpose, voice/chat availability, initial website/assistant preference, session duration, inactivity timeout and daily allowances. Optional external search, image search, map and annotation settings are here too.
5. **Save draft**, review your site preview, then **Publish** when ready. Existing visitors must reload to adopt the new publication; an active session cannot continue using a superseded publication. A new voice requires a new conversation.

Each site's saved settings are independent. The existing published `/s/{slug}` address uses its site's snapshot. This change does not provision subdomains, DNS or custom domains; the Domains section still reports the current hosting limitations.

The preview demonstrates appearance without AI calls. The welcome's existing Listen control uses a locally installed device voice, **not** the selected GPT Live voice. Actual timbre, pronunciation, accent, pacing and instruction adherence need an authorized live audio test.

## Configuration and compatibility

`SiteContent.visitor.conversation` is an optional strict schema. Fields are optional to keep old drafts and publications readable. Unsupported keys/values are rejected before saving; raw prompts, temperatures, VAD thresholds, arbitrary provider models and custom-voice IDs are not accepted.

| Field | Choices / bound |
| --- | --- |
| `voice` | Marin (default), Cedar, Quartz, Ripple, Vesper, Willow, Stone, Gleam, Meridian, Bossa, Tempo, Beacon, Delta, Cinder |
| `language` | Follow visitor; English, Spanish, French, German, Italian, Portuguese, Japanese, Korean, Mandarin Chinese, Arabic, Hindi |
| `verbosity` | Minimal, brief, balanced, detailed |
| `warmth` | Reserved, neutral, warm, enthusiastic |
| `formality` | Casual, natural, professional |
| `energy` | Calm, balanced, lively |
| `pace` | Deliberate, natural, brisk |
| `backchannels` | None, light, moderate |
| `followUp` | Clarification only, relevant, proactive |
| `smallTalk` | Minimal, welcoming |
| `listening` | Natural, patient |
| `pronunciation` | Up to 500 characters, quoted pronunciation data |
| `color` | Nine validated solid-color identities |

Optional `visitor.voiceSessionSeconds` accepts 30, 60 or 120 seconds; absence retains the existing two-minute cap. The shorter choice is enforced by the session owner, including cleanup. Existing inactivity options, quotas and the platform cap still apply. Turning conversations off preserves the configured choices and normal website browsing.

Quiet sets reserved/professional/calm behavior, minimal answers, patient pauses, no filler and no unsolicited follow-up. It still permits necessary clarification. Presets patch only the nine behavior fields: voice, language, color, pronunciation, greeting, purpose, entry preference, search and usage limits survive. Individual controls also merge rather than replacing their parent settings.

Old `opening.tone` remains valid saved data, with direct → neutral/on-task and calm → calm/unhurried fallbacks. Its control moved from Content to the richer personality choices. Both legacy `voiceTier` values still resolve to `gpt-live-1`; publishers cannot choose an unsupported model. No content migration, reimport, AI interpretation or automatic publication occurs.

An absent explicit voice color preserves the old appearance. Changing unrelated settings does not insert a color into existing content. Fresh sites store Amber. Branding resets keep conversation settings and the website/assistant entry preference. Changing the entry preference in The Voice preserves all website styling.

## Runtime and design

The existing Live session creator sets `audio.output.voice` and appends validated personality instructions at startup. The shared mirrored `lib/gpt-live/` protocol/runtime is unchanged. Voice and chat backends use the same resolved conversational preferences and published content. Old hardcoded warm-tone, English-greeting and automatic acknowledgement instructions were removed where they conflicted with publisher choices.

Delivery preferences are **guidance, not hard guarantees**. The bounded task runner uses length targets of 25/75/120/180 words for voice and 45/120/200/300 for chat. Necessary qualifications and explicit visitor requests take priority. No token ceiling, tool budget, quota, search permission or capability validation is increased. Untrusted pronunciation hints cannot establish facts or authorize actions. Published facts, attributed outside evidence and model background knowledge remain separate.

The portable `@thevoice/platform-ui/voice-design` module owns the validated color IDs and tokens. Each is a single hue, with a dark and light shade and deterministic contrast adjustment. Accent text meets 4.5:1 against the site's background and surface; button text also meets 4.5:1. CSS variables are overridden only inside conversation controls. The waveform uses the chosen solid stroke and retains the existing motion/audio envelope and reduced-motion behavior. No images, fonts or dependencies were added.

Voice and publication validation, screen acknowledgements, manual cancellation, interruption handling and source authority remain in the existing runtime. Configuration edits incur no model calls. More talkative settings can increase output/audio duration and cost within existing limits; quieter or shorter sessions may reduce usage. These are expectations, not measured cost or latency results.

## Provider references

- [GPT Live session configuration and additional voices](https://developers.openai.com/api/docs/guides/live-conversations#configure-a-session): Marin default and twelve additional documented voices; voice selected at startup and immutable for that session. Regional influences do not guarantee accent fidelity.
- [OpenAI voice-agent evaluation example](https://developers.openai.com/cookbook/examples/audio/voice_agent_evaluation#view-results): Cedar used for the GPT Live assistant in the documented example. The chooser exposes these fourteen documented voices; it does not assume every TTS/Realtime voice is supported.
- [Prompting GPT Live](https://developers.openai.com/api/docs/guides/live-prompting): personality, pacing, backchannels, listening, language and pronunciation are instruction-guided. Numeric speed/VAD/temperature controls were not invented.
- [Custom voices](https://developers.openai.com/api/docs/guides/custom-voices#use-a-custom-voice-with-gpt-live): require provider authorization and consent. Account setup and custom voice creation are outside this change.

## File map

| Files | Responsibility |
| --- | --- |
| `components/VoicePanel.tsx`, `VoicePanel.module.css` | Per-site settings, presets, voice/language controls and no-audio color illustration |
| `Dashboard.tsx`, `EditorPanels.tsx`, `Workspace.tsx` | The Voice navigation and routing; corrected setup guidance |
| `VisitorSettings.tsx`, `GreetingSettings.tsx`, `ExploreSettings.tsx` | Reused availability/limits, welcome and external search controls |
| `BrandingPanel.tsx`, `OpeningSettings.tsx` | Removed relocated entry/tone controls; content and styling preserved |
| `lib/voice-settings.ts`, `visitor-model.ts`, `site-model.ts` | Strict additive schema, defaults, shared prompt guidance and human-readable change descriptions |
| `lib/visitor-realtime-session.ts`, `visitor-realtime-control.ts` | Startup voice/configuration, duration bound, language-aware welcome and matching backend guidance |
| `lib/visitor-chat-task.ts`, `visitor-provider.ts`, `visitor-task-runner.ts` | Shared chat personality/length and bounded task execution |
| `packages/platform-ui/src/voice-design.ts`, package export | Framework-independent color contract and deterministic contrast tokens |
| `lib/site-style.ts`, `VisitorAssistant.tsx`, its CSS, `Waveform.tsx` | Independent voice styling, immediate preview updates and solid waveform stroke |

## Verification

Automated checks use synthetic content and mocked providers. No live paid calls, microphone capture, customer publications, deployment, account configuration or signed-in browser automation were performed.

- Unit and mocked integration: schema bounds, legacy tone/color fallbacks, all fourteen outgoing provider voice configurations, session duration, Quiet/language prompt propagation, chat/voice length targets, authority boundaries, review descriptions, all nine colors across old/current website palettes and template-independent tokens.
- Browser: settings/preset persistence, all nine immediate wave/chat previews, keyboard activation, reduced motion, responsive Studio/embedded/published surfaces, preservation of other settings/content, draft isolation, explicit synthetic local publication and disabling conversations without losing preferences.
- Existing regression coverage: visitor navigation, cancellation/readiness, source review, templates, greetings and optional external search remain exercised through the existing suites. See [screenshots and check results](screenshots/voice/README.md) for the exact runs and inspected captures.

No actual voice audition or provider-specific delivery quality is claimed by these tests. The offline welcome preview is deliberately labeled as a device voice.
