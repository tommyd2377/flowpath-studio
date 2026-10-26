# Desktop waveform concepts

October 26, 2026. Preview concepts generated with built-in Codex ImageGen from the user's supplied current-app screenshot as a visual reference. No browser/bookmark/OS chrome is included in the outputs. These are design explorations, not application screenshots or validated responsive implementations.

- [Portrait left — recommended](desktop-portrait-left.png): identity first, waveform beside it, complete panel below.
- [Portrait right — alternative](desktop-portrait-right.png): wave first, identity at its right, complete panel below.

The requested design target was approximately a 1440×900 app content viewport. The generated files are 1586×992 pixels with the same approximate aspect ratio; they do not specify exact CSS dimensions. The product rules and next implementation boundaries are in [experience design](../experience-design.md). Both images illustrate a panel after an explicit visitor request; before that request it must be absent.

## Shared generation prompt

Use case: ui-mockup. Create ONE exceptionally polished, restrained desktop web-app UI concept image, approximately 16:10 landscape, a complete 1440x900 app CONTENT viewport with no browser or OS chrome. The supplied screenshot is a REFERENCE for FlowPath Studio's existing personal waveform: nearly black background, delicate cobalt-blue and pale blue-white waveform, Benjamin Franklin circular historical portrait, understated sans-serif type. Reimagine the layout instead of reproducing the screenshot's excessive vertical spaces. Do not include browser tabs, bookmarks, browser menus, desktop, FlowPath News, marketplace, analytics, settings fields, device frames, charts, extra plugins or decorative objects. This is the individual Benjamin Franklin waveform during a live conversation AFTER the visitor explicitly requested the Text Box. All title, content and toolbar must be visible with generous bottom clearance and no clipped edges. Typography must be crisp, legible, precise. Preserve the calm existing visual language; no gradients, glow effects, marketing headings, oversized cards or elaborate dashboard.

The page has a compact conversation row near the top, and a single large Text Box below it, centered on an approximately 1120px-wide workspace. The conversation row combines the circular portrait (64-72px, thin accent rim), the identity 'Benjamin Franklin', a delicate elongated waveform, a small 'Listening' label, and a discreet 'End conversation' button. Waveform has a narrow actual stroke but enough visible amplitude to be clear. It is an active voice control, visually dominant over the portrait.

Panel from approximately y=190 to y=815; subtle charcoal surface with a fine desaturated blue edge, small corner radius. Panel heading 'Text Box' at upper left, 'Writing' with small blue dot at upper right. Body contains the exact short illustrative text:

```text
Conversation notes
Tell me about your first trip to London.
What did you learn from working as a printer?
Which idea should we explore next?
```

Use comfortable readable 17-18px-ish text with proper line spacing and ample remaining writing room. A toolbar INSIDE the bottom of the panel contains 'Stop writing', 'Undo', 'Clear', 'Copy text', and 'Hide', with simple tasteful line icons. Stop writing modest accent treatment; Copy text easy to find; all other controls quiet. Put 'Text stays in this conversation. Copy to keep it.' below the toolbar in legible muted type. No other text or invented data. The panel height adapts to available viewport, not a giant square. This image is an actual app layout concept, not a comparison board or annotated presentation.

## Variant A suffix

VARIANT A: portrait at the LEFT end of the conversation row at x160,y72; small name/Listening beside it, waveform occupies the generous middle of the row, End conversation sits at the right edge. The portrait and waveform share the same horizontal centerline. No separate centered portrait row. The panel aligns with the conversation row edges. This is the recommended clean and natural left-to-right composition.

## Variant B suffix

VARIANT B: portrait at the RIGHT end of the conversation row, near x1235,y86; Benjamin Franklin identity immediately to its left with Listening beneath it. A generous waveform occupies the left and center, on the SAME vertical centerline as the portrait. End conversation is a small quiet control near the upper right ABOVE this row, not a second tall row. Keep the overall header compact and panel beginning near y190. The large Text Box remains centered and fully visible. This is an alternate composition emphasizing the wave first, identity to the right.
