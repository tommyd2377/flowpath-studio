# Optional Search and explore

Publishers can enable **Content → Search and explore**, choose web image search and interactive maps, restrict search to up to eight public domains, and set a daily allowance of 1–100 search requests. The default is off, including for existing publications. Save changes to the draft and publish explicitly; saving alone does not enable public search. Visitor conversations must also be enabled.

The visitor surface presents external results separately from published knowledge. Web results have clickable inline citations and source cards. Image results have numbered thumbnails, source links, an accessible enlarged viewer, Escape dismissal and focus return. Map requests open an attributed OpenStreetMap embed with drag/pan and zoom. A bounded six-view history and local image/zoom controls work without another search, including after search allowance exhaustion.

Visitors can use the dedicated Web / Images / Map composer. The main typed composer also recognizes explicit web searches, requests to find images, maps, and ordinal photo follow-ups such as “Open the second photo.” The continuous voice assistant can request the same views or open an existing image by its displayed ID. Ambiguous voice references require clarification. Voice waits for the browser's navigation acknowledgment before claiming the view was applied. These controls do not open outside tabs automatically; visitors choose source links themselves.

## Providers and boundaries

- **Web and images:** the existing server-side OpenAI Responses integration, using `gpt-5.6-luna`, `store:false`, one required `web_search` tool call and `max_tool_calls:1`. Images use `search_content_types`, `image_settings` and `web_search_call.results`. URLs come from hosted-tool results and citation annotations, not model-written links. Domain filters apply to source pages (image CDNs may use a different domain), and the application filters results again. Unsafe protocols, credentials, explicit IP hosts and local hostnames are rejected. The application never fetches or proxies result pages/images.
- **Maps:** United States/world overviews resolve locally. Other explicitly named regions, cities and landmarks use one bounded structured model response to select an approximate viewport. Unknown or ambiguous locations may return no viewport. The app constructs a fixed OpenStreetMap embed URL from validated numbers. These are approximate area overviews, not geocoded business pins, verified addresses, directions or live inventory. Overview zoom controls reset to the named area; native panning inside the third-party iframe is not observable as exact viewport state by Studio. Multiple destination markers and geocoding are not implemented.
- **External content:** results never become draft or published knowledge and cannot create executable capabilities. Images load directly from source hosts without a referrer; they are not imported into the publisher's media library. Attribution is not a grant of reuse rights. The map background always comes from OpenStreetMap, even when web search is domain-restricted. It is a best-effort service, not a commercial map SLA.
- **Preview:** deterministic synthetic results, labeled illustrations and an offline map placeholder. No model, map-tile or third-party image request occurs in the demo path. Preview does not establish live search quality or provider/model compatibility.

The result components are currently Studio host components, separate from the published-catalog render-plan contract. Provider credentials and retrieval orchestration remain server-side. A bounded browser context contains result IDs, image captions and overview coordinates for navigation; it carries no arbitrary source URLs and grants no authority over published facts.

## Usage and cancellation

Typed and voice searches share a transactionally reserved per-site allowance, default 10/day, plus a global 100/day cap. This is separate from chat/voice generation limits. Request IDs share replay protection with visitor turns; cancelled and failed attempts remain counted. A voice search also consumes its normal voice turn. Known map requests count toward the search-request allowance even though they do not call OpenAI. Manually opening images, switching existing views and zooming do not consume search requests.

Only one Responses request is made per external search or non-preset map lookup, with a 25-second timeout, bounded output and no automatic retries. Voice allows at most one search/navigation tool action followed by one tool-free spoken continuation. Manual interaction, new speech, stopping a search and closing a voice session abort or suppress stale search work. Publication changes are checked before and after retrieval. Existing Stripe-test paid-AI blocking also covers search. No billing rates or credit deductions are added; request caps are not monetary enforcement, and search-tool charges are additional to model tokens.

No Firecrawl integration, new account, extra API key, deployment, or live provider test is part of this implementation.

## Verification

- `tests/explore.test.ts`: settings, URL/domain filtering, citations, hosted image parsing, single-call limits, map construction, quotas and offline published routes.
- `tests/explore-voice.test.ts`: browser acknowledgment, disabled tools, cancellation and tool-free continuation.
- `tests/browser/search-explore.spec.ts`: publisher controls, image keyboard/focus behavior, typed follow-ups, mobile layout, history, failures, stale responses and a mocked map embed.

Use `npm run check` and, after a build, `npm run test:browser -- tests/browser/search-explore.spec.ts tests/browser/visitor-realtime.spec.ts`. Tests use synthetic data and mocked providers. Live OpenAI image-search support for the configured model, relevance, cost, latency, image-host availability and actual map rendering require separately authorized verification.

Official references: [OpenAI web search and image results](https://developers.openai.com/api/docs/guides/tools-web-search#image-search-results), [OpenStreetMap embedding](https://wiki.openstreetmap.org/wiki/Export), [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/).
