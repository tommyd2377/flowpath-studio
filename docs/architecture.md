# FlowPath waveform architecture

The browser connects audio directly to GPT-Live over standard WebRTC. The application server creates and supervises the same session through a sideband WebSocket. The application has no delegated model or tool executor.

The waveform host owns visuals and browser media. A short application prompt defines identity and limits; each call uses empty starting history and store:false. The provider may retain data under its own policy: store:false is not a zero-retention guarantee.

Live is disabled unless development mode explicitly opts in. Readiness is checked before microphone access. Local requests require a loopback host and matching origin; bodies and SDP are bounded, and non-audio media is rejected. A browser-generated UUID identifies a local reservation so a canceled handshake can still close a late-created provider session. Provider IDs stay on the server.

The controller admits one local session, up to three starts per minute and at most three provider starts for the entire local process, including failed starts. It has a 30-second startup watchdog and a 180-second absolute cap from the confirmed creation response. Browser inactivity closes after 45 seconds of silence. These local test limits are distinct from future customer trial accounting. Normal closure waits for session.closed and final usage; uncertainty blocks new starts. No automatic retries are performed.

Standard WebRTC is the starting transport. WARP and hosting optimizations are deferred until actual latency is measured. Deployment runtime supervision, durable public quotas, concurrent owner budgets and payment reconciliation remain future work.

News is an independent application. Later a News module will own its data, actions, settings and panel, while this host retains voice, accounts, usage and opening/closing views. No plugin framework or sibling source dependency is introduced now.

## Official references

- https://developers.openai.com/api/docs/guides/voice-webrtc?api=live
- https://developers.openai.com/api/docs/guides/live-conversations
- https://developers.openai.com/api/docs/guides/live-prompting
- https://developers.openai.com/api/docs/guides/voice-server-controls?api=live

GPT-Live standalone conversational quality is unverified. Mocked connection tests do not establish provider behavior or physical microphone/playback quality.
