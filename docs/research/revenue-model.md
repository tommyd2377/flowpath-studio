# Revenue model proposals

October 26, 2026. Scenarios only: no price, revenue share, marketplace, payout provider or accounting migration is selected. No payment account, live dashboard, credential or transaction was accessed. Existing fixture pricing is not an approved offer, and no existing entitlement is revalued here.

## Candidate usage prices

The outstanding candidates are **$1 per 10 minutes**, **$5 per hour**, or **$6 per hour**. $1/10 minutes and $6/hour have the same nominal usage rate; pack size, minimum charge, expiry and rounding could still make actual offers different. $5/hour is about 16.7% lower per minute than $6/hour. This is arithmetic, not a recommendation or a claim about current provider cost.

| Hypothetical rate | Revenue for 10 used minutes | Revenue for 60 used minutes |
| --- | ---: | ---: |
| $1 / 10 minutes | $1.00 | $6.00 |
| $5 / hour | $0.8333 equivalent | $5.00 |
| $6 / hour | $1.00 equivalent | $6.00 |

The equivalents above are analytical values, not proposed checkout amounts. A server-selected pack must define its integer cents, integer seconds, currency, fulfillment binding and display. Already purchased seconds retain their original entitlement unless a separate, explicitly approved migration defines otherwise. Neither a new rate nor a mobile launch should silently convert balances.

## MVP scenarios

| Scenario | Who funds usage | What the platform could earn | Required decision |
| --- | --- | --- | --- |
| Personal creator tool | Owner uses prepaid seconds for their own waveform. | Usage margin; optional future authoring fee. | Which authoring features, if any, justify a separate fee; no subscription is implemented. |
| Creator-funded public experience | Creator allocates a finite budget; visitors use that allocation. | Usage margin from the creator's prepaid balance. | Transparent remaining-budget behavior and abuse controls; no double charge to visitors. |
| Intro then visitor-funded | Creator sponsors a cumulative allowance; visitor explicitly continues on their balance. | Margin on separately attributable sponsor and visitor usage. | Allowance, disclosures and explicit continuation; never automatic payer switching. |
| Visitor-funded creator experience | Signed-in visitor explicitly selects their own balance. | Usage margin, with a possible future creator royalty. | Whether royalties are justified, and the eligible net-revenue basis. |
| Future plugin/service | A separate content/tool service adds value inside a waveform. | Future flat fee, usage fee or contractual revenue share. | Permissions, metering, quality/safety, data access and attribution first. Current plain text is a display feature, not a plugin marketplace. |

Preserve the three existing payer modes and cumulative intro semantics. Creator funding is an allocation of prepaid seconds, not a promise that a creator receives money back. Current synthetic hold/settlement behavior does not implement creator balances, payouts or marketplace earnings.

## Illustrative sharing math

Two possible future accounting bases differ materially:

- **Gross split:** divide revenue before provider, payment, hosting, support and refund costs. At an assumed 70% creator / 30% platform split, $6 of usage revenue leaves the platform $1.80 to cover every cost; $5 leaves $1.50. Those are cost ceilings before profit, not observed margins.
- **Net split:** first subtract an explicitly defined set of eligible costs, then divide the remainder. For hypothetical $6 revenue and $2 eligible costs, a 70%/30% split gives $2.80 to the creator and $1.20 to the platform after the $2 cost recovery. The $2 and split are assumptions only; how refunds, disputes, taxes, payment fees, sponsored use and negative periods are treated needs a written decision.

Do not encode a share before defining its denominator and settlement evidence. A practical initial MVP can keep simple usage economics while gathering authorized, privacy-limited cost and retention evidence. That leaves creator payouts as a later decision without implying they already exist.

## Evidence needed before choosing

Measure actual voice and reasoning cost per **provider-confirmed** used minute, failed/overshoot costs, payment processing cost at the chosen pack size, sponsorship abuse exposure, support/refund cost and repeat usage. No current provider-price or margin claim is made here because those values were not researched or verified. Use bounded, separately authorized paid tests if real provider behavior is required.

Decide the customer offer, then model conservative cost and utilization ranges against it. Keep settlement/accounting server authoritative and idempotent. Existing holds cannot be treated as settled revenue; uncertain sessions retain their accounting blocks. Sponsored minutes and self-funded minutes must not create duplicate creator earnings.

Payout liability, marketplace operations, tax treatment, refunds/disputes and mobile-store purchase requirements need qualified review and explicit product decisions before financial implementation. No Stripe Connect integration, creator payout ledger, entitlement conversion, live checkout or money movement is proposed as an automatic next step.
