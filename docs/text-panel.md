# Creator text panel

The standalone panel displays approved creator-authored plain text. A visitor can choose **Show text** or **Hide text** locally. These buttons do not send a message to the model, start audio, call an API, change an allowance or store visitor input. There is no arbitrary visitor-text input or model tool.

## Configuration and validation

`lib/text-panel.ts` exports `TextPanelConfiguration`:

```ts
{ type: 'text', version: 1, text: string }
```

`TEXT_PANEL_MAX_CHARACTERS` is 4,000 JavaScript UTF-16 code units, using the same `string.length` convention as the existing editor. The configuration is optional; `null` and `undefined` validate as absent. Empty text is valid. Validation preserves exact text and line breaks, with no trimming, interpretation or clipping. Oversized input is rejected, so a creator can correct the original draft.

`validateTextPanelConfiguration(unknown)` returns `{ ok: true, value: configuration | null }` or `{ ok: false, error }`. Errors are fixed codes: `invalid_shape`, `unsupported_type`, `unsupported_version`, `invalid_text` and `text_too_long`. Unknown fields, custom prototypes, symbols and accessors are rejected. No raw input or errors are logged or retained.

`projectTextPanelConfiguration(unknown)` returns a detached validated configuration or `null`. Use it only after authoritative validation/approval when projecting public output; invalid saves should return an error instead of silently removing existing text. Passing the whole waveform record fails validation because owner, prompt and other fields are outside this projection.

## Host integration

```tsx
<TextPanel
  configuration={approvedWaveform.textPanel ?? null}
  scopeKey={hostResetKey}
/>
```

The default export in `components/TextPanel.tsx` accepts:

| Prop | Behavior |
| --- | --- |
| `configuration` | Validated text configuration or `null`. Invalid runtime values render nothing. |
| `scopeKey` | Required local reset key. Change whenever waveform or account identity changes; never send it to analytics. |
| `enabled` | Defaults to `true`. `false` disables the button and keeps creator text out of the DOM. |
| `initiallyVisible` | Defaults to `false`. A host can explicitly show an approved creator update on arrival. |

Mount the component below the waveform/status, within the host's existing responsive layout. It uses the existing secondary-button class, native keyboard button behavior, a labeled section and `aria-expanded`/`aria-controls`. Long text wraps within a maximum width of 36rem. Hidden text is absent from the content node; Show/Hide changes only component state. No animation, focus stealing or media lifecycle hook is added.

Identity, content, availability and initial-visibility changes remount the inner component through `textPanelResetKey`; old reveal/hide state cannot carry into a different waveform or identity. Hide is a local viewing preference, not a privacy boundary: an approved public configuration can already be present in the page's application data.

Creator changes arrive through `configuration`. The coordinator owns persistence, editor fields, public projection and mounting. Include exact material text in the same authoritative safety digest as the name/instructions. Do not publish an unchecked edit or expose private configuration. The panel cannot grant approval by itself.

## Verification

The focused Node suite uses React's static renderer and synthetic input. It covers bounds, safe projection, malicious text, origin labeling, initial/disabled states and reset-key changes. It verifies escaping rather than filtering strings: HTML, script tags, Markdown and URLs remain literal text without executable nodes or network requests.

```sh
node --import tsx --test tests/text-panel.test.ts
```

Host-level browser acceptance must additionally cover keyboard Show/Hide, live creator updates, identity switching, mobile placement and unchanged voice cleanup. This lane does not claim those integrated browser behaviors, live voice or deployment verification.
