# Plugin access codes in the local app

Save the waveform draft, open **Plugins**, then use **Plugin access** to choose which applied plugins require a code. **Save plugin access** saves this policy separately from draft content. One shared code covers the selected plugins. Each successful unlock grants access only to the requested plugin and preserves any still-current grants from the same browser session. Existing waveforms start with protection off.

On the waveform page, open **Unlock plugins**, choose a plugin, and type the code. During a conversation, the server updates the existing session after checking the exact call, account or visitor, waveform, and saved approval. The browser applies the newly available controls after the server confirms the update. Show, Hide, and successful unlock retain the current microphone, peer connection, and workspace.

## Access boundaries

- Creator editing stays under existing owner authentication. The playback projection withholds locked display configuration, and the Knowledge search endpoint checks the grant before retrieval and again before releasing results. Knowledge remains owner-only. Displaying its passages in Text Box also requires Text Box access.
- The initial provider configuration omits locked tools and catalogues. It subscribes to the browser events those tools may need if unlocked. The approval digest still comes from the original approved content. The in-call update uses the existing backend and registered tools. OpenAI documents the update acknowledgment separately from asynchronous validation and speech delivery. [OpenAI delegation guide](https://developers.openai.com/api/docs/guides/live-delegation#configure-responses-delegation)
- Unlocking a curated demo plugin uses the existing visitor session and demo gate. Its published Text Box is the only eligible plugin. The private Knowledge library and Visual Display stay outside the curated audience. The visitor can unlock after starting the demo.
- Protection applies to playback and voice projections for paid-test snapshots too. Those separate previews currently withhold protected plugins without an unlock control. The normal local waveform and curated demo are the in-call unlock surfaces. The existing paid and hosted activation settings are unchanged.
- Codes use salted scrypt. Only hashes and salts persist. The opaque cookie expires after 30 minutes and is scoped to the browser/account, waveform, selected plugins, and policy revision. Attempt limits apply before password verification. Codes and cookies stay out of prompts, tool arguments, diagnostics, and publication snapshots.
- Changing protection or replacing a code invalidates old grants. Settings changes wait until calls for the waveform have closed. The policy and call admission share a transaction fence. A live update that may have partially reached the provider follows confirmed voice cleanup. Grant expiry clears protected browser state and uses existing call limits or the independent local founder supervisor to close affected voice. Unprotected founder calls retain the existing unlimited mode.

The local runtime uses separate, optional policy, grant, and attempt records through the existing application database adapter. Missing records default to off. No waveform migration, Firestore rules change, cloud TTL setting, or deployment configuration is needed for this isolated implementation. The code checks grant expiration at use time. Expired record retention is separate from access enforcement.

## Verification

Node 24.6.0 ran lint, type checking, all 498 source tests, and the production build. The isolated mocked browser suite passed 126 tests on port 3228. The synthetic publication suite passed eight tests on port 3229. After the final account-cookie and keyboard changes, three focused browser cases passed again.

The new browser case uses the actual settings, code verifier, cookie, playback route, and Knowledge search guard. It simulates the live provider update and confirms that the browser submits the existing conversation ID, enables Text Box, leaves Knowledge locked, and keeps the same peer connection and microphone. Fake-socket tests cover the provider command and acknowledgments. Actual provider behavior and speech were outside the synthetic verification.

Both fixture servers stopped. Temporary port and origin substitutions were restored byte-for-byte. The running app and the coordinator's checkout were outside the write scope.
