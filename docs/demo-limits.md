# Platform-funded demo controls

The local MVP candidate retains the 180-second Studio welcome demo. Its random HttpOnly cookie now supplies a stable hashed allowance key across page refreshes and tabs. A successful reservation consumes one full 180-second block per UTC day; early closure and setup failure do not replenish that platform allowance. Page UUIDs remain separate cancellation capabilities, so a refreshed tab cannot close another tab's call. Existing no-header clients retain cleanup authority. Unknown pre-cancellations consume the same bounded allowance before a tombstone is written.

`lib/demo-budget.ts` adds finite per-entry configuration, subordinate to the existing global seconds/concurrency limits:

| Entry | Daily seconds | Concurrency | Visitor seconds per UTC day |
| --- | --- | --- | --- |
| Studio | `FLOWPATH_DEMO_STUDIO_DAILY_SECONDS`, defaults to the parent global ceiling | `FLOWPATH_DEMO_STUDIO_CONCURRENCY`, defaults to parent | `FLOWPATH_DEMO_STUDIO_VISITOR_SECONDS`, defaults to 180 |
| Unused News reference only | `FLOWPATH_DEMO_NEWS_DAILY_SECONDS`, defaults to 0; no route consumes it | `FLOWPATH_DEMO_NEWS_CONCURRENCY` | `FLOWPATH_DEMO_NEWS_VISITOR_SECONDS`, defaults to 180 |

Daily seconds must be finite nonnegative safe integers and cannot exceed the parent limit. Concurrency cannot exceed parent capacity. Visitor seconds are bounded to 0–180; reducing below a whole 180-second reservation pauses new attempts. No deployed environment/configuration was changed.

Studio reserves its extra platform/visitor counters in the same transaction as `voiceAdmission/global`. Settlement releases only confirmed capacity, retaining the reserved daily block. Corrupt counters/capacity fail closed rather than resetting to zero. Founder testing retains its existing separate exception but still consumes finite global blocks and shared capacity.

Anonymous identity is a browser capability, not proof of a human. Clearing cookies, different devices and first-cookie issuance races remain limitations; the global platform ceiling is the final spending bound. Paid introductory usage uses its existing distinct participant ledger, never these demo counters.

## Independent News boundary

News remains a separate application and an ordinary external example link, serving only as a reference for future plugins designed one at a time. Studio does not start a News call, import its source, install it as a plugin or enforce its spending. The abstract News entry is unused/reference-only: no route/resource consumes or activates it, and it is not delivered News protection. Independent News implementation, activation and enforcement are outside the current Studio scope and are not Studio launch blockers. The sibling checkout was not inspected or edited.

No queue, trigger, scheduler or automatic provider retry was added. Existing independent closure tasks remain closure-only; this change does not amplify provider creation or establish a guaranteed provider hard cutoff.
