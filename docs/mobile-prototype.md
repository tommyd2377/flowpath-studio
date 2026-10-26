# Mobile prototype contracts

October 26, 2026. This is a framework-neutral contract prototype, with pure TypeScript functions and in-memory examples. No native project, app registration, dependency, token transport, provider activation, platform association file, cloud build, device permission or deployment was created. The existing web app and backend remain the implementation to reuse.

## Implemented prototype

`prototypes/mobile-contracts/links.ts` exports `canonicalPublicWaveformUrl(id, approvedOrigin)` and `resolvePublicWaveformLink(url, approvedOrigin)`. Both return null on invalid input. The latter returns `{ kind:'public-waveform', waveformId, path, webFallbackUrl }` for an exact HTTPS origin and `/p/<v4-UUID>` route. The ID is normalized to lowercase; its web fallback is always the same approved origin and public path. Origin configuration is supplied explicitly, not inferred from a link. No domain is selected or renamed here.

The resolver rejects other hosts/subdomains, credentials, nonstandard ports, private `/w` routes, custom schemes, query/fragment data, whitespace, backslashes, encoded paths, traversal and extra path segments. It validates raw syntax before URL normalization. This deliberately narrow sharing contract has no auth, payer, checkout or arbitrary redirect parameters. A valid link identifies a requested public waveform; the existing server still decides whether it is published and usable. A link never starts voice or grants access.

`contracts.ts` reuses `AccountUser`, `Waveform`, `PublicWaveform`, `PaidActor`, `PaymentMode` and `MinutePack` through imports. It defines internal verified/fake identity context, public/private resource views, a private balance/pack projection, explicit payer intent and a proposed read-only transport seam. Type-only imports of server models do not load their implementations. No duplicate UID system, waveform schema, wallet or ledger is added.

The guards detect mixed UID/session/owner/balance snapshots. They never compare email strings or link accounts. Permission values are UI hints only; `/api/waveform`, publishing and admission must retain their own server verification and transaction checks. Public projection cannot grant editing rights. Private balance views preserve the exact server pack and available seconds, remove internal extras and do no price-to-entitlement conversion. A self-funded intent requires a matching account and explicit own-balance consent; it is only an intent, not a reservation or charge. Capacity, review status, funding eligibility and atomic accounting remain server-owned.

`fixtures.ts` contains synthetic in-memory examples with arbitrary pack values, unrelated to proposed prices. No file persistence or real transport is used. `node --import tsx --test tests/mobile-contracts.test.ts` exercises links, malformed input, ownership and payer consent using Node 24. No iPhone, Android, installed-app handoff, voice audio or real identity has been verified.

## Screen flow proposal

1. Open a shared HTTPS `/p/<id>` link. Use the same published resource on web or in the installed app; show unavailable when the server denies it. Do not carry private prompts, UID, tokens or payer choices in the URL.
2. Display the waveform and server payment/readiness state. A tap explicitly requests the advertised payer. Intro exhaustion offers sign-in and a clearly selected own-balance continuation; it never silently changes payer or resets use on refresh.
3. Signing in resolves the same backend UID, membership, owner waveform and wallet. Clear previous private snapshots on identity changes. Preserve original request/actor identity for cleanup until closure is confirmed.
4. Owner settings load through the existing ownership boundary. Exact-version creation safety, publication and admission stay server authoritative. A native client cannot bypass review with a local permission flag.

## Framework decision, still open

| Option | Practical benefit | Cost to verify for this product |
| --- | --- | --- |
| Swift / SwiftUI | Apple-native UI and direct integration with Apple frameworks; SwiftUI supports Apple platforms and UIKit interoperability. | A separate UI implementation/language alongside this React app; Android needs another client. Verify microphone, playback, WebRTC/sideband lifecycle, interruptions and waveform rendering before estimating effort. |
| React Native / Expo | Reuses React/TypeScript skills and pure contracts across iOS and Android. React Native renders platform-native components; Expo provides a development-build workflow. | Current Next DOM/CSS/canvas UI is not a drop-in native screen. Native voice/media libraries and configuration require compatible development builds and real-device checks; Expo Go does not prove that stack. |

These benefits follow [Apple's SwiftUI overview](https://developer.apple.com/swiftui/), [React Native's components guide](https://reactnative.dev/docs/intro-react-native-components) and [Expo's development-build documentation](https://docs.expo.dev/develop/development-builds/introduction/). The React Native page carries a warning that some API examples reflect legacy architecture; no API from those examples was adopted. The reuse/effort implications above are engineering judgments for this repository, not measured benchmarks. No framework is selected.

## Deep-link and native-auth prerequisites

Apple universal links use the same web URL and can fall back to the browser when the app is absent. They require a two-way association between the app and controlled domain. The app's entitlements and website association file must name the approved identifiers/domain. Apple also documents cases where a same-domain Safari navigation remains in Safari, so opening the installed app on every tap is not a valid acceptance assumption. See [Apple's universal-link guide](https://developer.apple.com/documentation/Xcode/allowing-apps-and-websites-to-link-to-your-content). Expo likewise requires domain association and recommends development builds for linking tests; Expo Go support is limited. See [Expo linking overview](https://docs.expo.dev/linking/overview/) and [iOS association steps](https://docs.expo.dev/linking/ios-universal-links/). App identifiers, team identity, Android association/signing data and domain approval remain unresolved; no association files were added.

Apple sign-in is not currently supported by the reviewed Studio backend. Before implementation, the owner must approve the provider design and perform necessary Apple/Firebase account configuration. Firebase's Apple guide describes developer-program prerequisites, app/provider setup, random nonce plus SHA-256 binding, and consent considerations when linking anonymized Apple identities. These are prerequisites, not actions performed here. See [Firebase Apple authentication](https://firebase.google.com/docs/auth/ios/apple).

Native auth transport also needs an explicit design. Firebase documents sending a signed-in client's ID token to a custom backend over HTTPS and verifying it server-side to derive UID. Basic token verification does not by itself check revocation; Studio additionally needs its existing membership, durable active/changing/revoked session, ownership and logout/cleanup guarantees. Decide the native exchange/refresh/revocation and secure-device-storage contract without weakening the existing web cookie/Origin boundary. Never trust a UID or provider claim supplied beside an unverified token. See [Firebase token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens).

Provider linking must prove control of the signed-in identity and new provider credential while preserving the same UID. Matching emails must never merge owners, wallets or entitlements. Firebase documents credential linking to retain UID and currently flags a known issue affecting some projects, so linking needs a dedicated acceptance check before activation. See [Firebase account linking](https://firebase.google.com/docs/auth/ios/account-linking). This prototype implements no linking or account migration.

## Before a native implementation

Choose target platform/framework, approve native auth/session transport, identifiers and domain associations, then perform a separately scoped media spike. Acceptance should cover installed/uninstalled link behavior, unpublished links, account switching during an active call, revoked identity, microphone denial, interruptions/backgrounding, headphones/speaker routing, confirmed cancellation and cumulative paid intro. Real provider/audio testing requires its own host/app/task/call budget approval. App-store payment/distribution requirements and any account/legal actions remain owner decisions outside this prototype.
