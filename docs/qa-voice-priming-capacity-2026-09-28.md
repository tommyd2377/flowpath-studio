# Expanded voice knowledge priming — September 28, 2026

AI-PRIMING-CAPACITY-01 is implemented locally. The user activated the previously approved, deferred work on September 28. This pass changes the shared platform startup path, not any publisher's data or individual website. No customer publication, deployment, paid API call, model change or new dependency was made.

## What changed

- **More usable startup knowledge:** the existing developer input message can be supplemented with published reference JSON in unused instruction space. Trusted behavior and the publisher's ongoing role remain verbatim. Both reference parts explicitly treat publisher prose as untrusted data, never instructions or a request to speak. Display/action requests still delegate and require the existing validated execution/receipt flow.
- **Coverage across the publication:** identity, contact/hours and selected opening references receive priority; whole prose, offerings, structure and approved media then take turns. Catalog selection rotates across categories and ungrouped record types. Large groups are sampled across their full index range. The v2 path still hydrates at most 48 complete records in one authorized repository call, now chosen across the publication instead of taking its first 48 index entries.
- **Compact briefing and lookup guide:** duplicated record identity/selection metadata is removed without changing its meaning. A bounded directory preserves topic, category, album and video titles for lookup. Large collections/albums retain directory pointers rather than hundreds of opaque membership IDs. `directItems` means direct membership, not a parent collection's descendant total. Directory entries are not counted as complete records or sufficient factual evidence.
- **Qualifications remain intact:** facts, conflicting assertions, dates, units, conditions and complete prose records move together. Oversized records are omitted, never clipped or automatically summarized. Coverage counts combine both startup reference parts and explicitly retain missing-library/omission state. Detailed records remain available through the existing published-data lookup path.
- **Inspectable startup:** `voice.knowledge_coverage` records preparation time, complete-field byte counts, reference bytes, admitted/omitted records and directory coverage. Late recording attachment receives the same numeric diagnostics, without buffering previously unrecorded speech. Existing publication identity checks and heartbeat invalidation remain intact.

## Supported limits and deliberate boundary

OpenAI documents **8,192 combined startup input tokens** and a separate **16,384-token instruction field** in [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations). The implementation conservatively limits the complete text fields to **7,680 UTF-8 bytes for input** and **15,872 UTF-8 bytes for instructions**, including notices, policy, role, JSON envelopes and reference data. A larger role/policy leaves correspondingly less room for supplemental knowledge. Final serialized lengths are checked before any provider request.

These are conservative byte safety budgets, **not exact Live token counts**. No supported `gpt-live-1` tokenizer mapping was found in [OpenAI's tiktoken model mapping](https://github.com/openai/tiktoken/blob/main/tiktoken/model.py); the documented [token-counting endpoint](https://developers.openai.com/api/docs/guides/token-counting) accepts Responses payloads, with no documented Live compatibility. We therefore did not guess a different model's tokenizer or add a counting request to startup. The deferred task's useful capacity/selection improvement is delivered through documented fields; exact Live token-aware packing remains a provider-support opportunity, not a claimed result or reason to rerun this implementation.

With the benchmark's 6,360-byte trusted policy, the larger examples contain about **16.4–16.6 KB of reference context**, versus about **7.6 KB before**. This is not a guarantee that every site's content fits: size, language, qualification density and the publisher's role affect coverage.

## Reproducible offline evidence

Run with Node 24 from the repository root:

```sh
node --conditions=react-server --import tsx scripts/benchmark-voice-priming.ts
```

The script uses synthetic publications and mocked repository reads, three warmups and 20 measured runs. Raw [baseline](qa-voice-priming-capacity-2026-09-28-baseline.json) and [after](qa-voice-priming-capacity-2026-09-28.json) reports preserve the results. The following are local preparation measurements, not speech/network latency or a model-quality evaluation.

| Synthetic publication | Complete primed offerings, before → after | Categories represented, before → after | Warm preparation p95, before → after |
| --- | --- | --- | --- |
| Small service, 3 offerings | 3 → 3, still complete | 1/1 → 1/1 | 0.195 → 0.554 ms |
| Mixed catalog, 100 offerings | 7 → 16 | 1/10 → 10/10 | 2.648 → 3.088 ms |
| V2 catalog, 10,000 records | 19 → 42 | 1/20 → 20/20 | 1.271 → 3.556 ms |

The large v2 case still uses one mocked hydration call with 48 requested records. Cold index setup is reported separately (349 ms in the after run). Real storage reads may span more chunks when sampling categories; repository chunk caching/concurrency is unchanged. Provider startup and real storage latency are not measured by this benchmark. Multilingual oversized prose remains omitted whole, while short policies and lookup titles remain available; no trailing exception is lost to clipping.

## Verification and remaining acceptance

- **134 focused offline tests passed** across priming, session startup/control/context, visitor policy and voice response handling. Additional checks cover the supplemental-field conflict record and late recorder attachment. These overlap with the 134-test run and are not a separate project total.
- New regression cases exercise both transmitted fields, exact coverage reconstruction, UTF-8 accounting, near-limit role/policy preservation, publisher-selected priorities, later-category hydration, whole-index sampling, large membership pointers and absence of extra model/counting calls. Existing revision/cross-site authorization and cancellation checks still pass.
- Scoped ESLint, full TypeScript checks, production build and `git diff --check` passed. No server was started for this work; no browser or physical-phone acceptance is claimed.
- **Next normal authorized live QA:** capture startup milestones and coverage, ask about identity plus early/late catalog categories and published policies, ask an omitted-detail question, and verify a display request still delegates. Check that larger context improves direct-answer coverage without an unacceptable provider startup delay. Live model compliance, time-to-audio and provider cost were not measured here. No additional paid allowance was inferred from yesterday's authorization.

The shared backlog marks this implementation complete locally and carries live acceptance forward. The daily `follow-up-on-voice-knowledge-priming` reminder was paused on September 28 after verification, preventing duplicate implementation work.
