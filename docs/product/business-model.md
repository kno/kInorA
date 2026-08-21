# Business model

> 🇪🇸 [Versión en español](./business-model_ES.md)

The tiers, limits and rules in this document are taken from the code, not from a commercial plan. The specific values come from `apps/api/src/billing/pricing-config.ts` and `plan-limits.ts`; the rules, from the `11a-v1-billing-plans-tiers` specification.

---

## 1. Four tiers

| Tier | Who it serves | Status |
|---|---|---|
| `free` | Basic individual use | Live |
| `pro` | Full individual use | Live |
| `trainer` | Trainer with clients | Implemented |
| `gym` | Gym with white labelling | Implemented |

The effective tier is resolved by precedence: first any active administrative override, then the tenant's billing status, and only then the base tier. The Stripe columns are metadata and **take no part** in that resolution: it is the webhook that translates a subscription into status and tier. That separation avoids having two sources of truth about what a user can do.

---

## 2. What gets metered

Four features are billed, and only four:

| Feature | Free | Pro | Trainer | Gym |
|---|---:|---:|---:|---:|
| Plan generation | 1 | 500 | 1,000 | 500 |
| Plan regeneration | 1 | 1,000 | 2,000 | 1,000 |
| Memory write | 0 | 50,000 | 100,000 | 50,000 |
| Memory retrieval | 0 | 200,000 | 400,000 | 200,000 |

Limits run per calendar month, in UTC. A zero doesn't mean "unlimited" but **blocked at that tier**: vector memory is a paid capability, and on the free tier retrieval is skipped entirely before any embedding is generated.

The Trainer tier doubles Pro's caps and additionally scales with seat count. The Gym tier matches Pro. The reason Trainer is never below Pro is written into the specification: so that a trainer tenant doesn't quietly end up treated as free.

Conversational chat doesn't consume quota. It's gated by tier: it's a Pro capability, full stop. That was decided instead of building a per-turn meter, knowingly accepting that the marginal cost of conversation goes unmeasured. It's a revisable decision and it appears in the next steps.

---

## 3. The trial

Every new tenant — personal or managed by a trainer — starts with **30 days of Pro**, no card required.

The interesting part is what happens on expiry. The specification sets it out explicitly: expiry **preserves** the tenant's data, its members' assignments, the plans, the memories and the history, and all it does is block premium generation above the free limits and premium use of vector memory.

Nothing is deleted when the trial lapses. It's a product decision with a direct commercial consequence: someone coming back three months later finds their history intact, and winning back someone whose data is already inside is far cheaper than acquiring someone new.

---

## 4. Payment

Stripe, on a monthly or annual cycle with the euro as the default currency. Display amounts live in configuration and feed the pricing page and the annual-saving badge, but they **charge nothing by themselves**: what bills is the Stripe price identifier.

Coupons are Stripe promotion codes validated **server-side before** the checkout session is opened, so an invalid or expired code is rejected without creating an orphaned session. They serve campaigns and referral programmes.

There is also an administrative route for granting a tier manually for a limited window, intended for commercial agreements and extended trials. It's auditable: granting leaves a record, revoking is a state transition and never a deletion, and there can only be one active grant per tenant, so re-granting requires revoking first rather than silently overwriting.

The webhook is idempotent and tolerant of out-of-order delivery, and on any error it returns 5xx **without ever granting** the paid tier. Fail toward the side that doesn't give product away.

---

## 5. Quota is hybrid, and that's a product decision

There could have been a single pool per organisation. A hybrid model was chosen instead, with a tenant pool and a per-member cap, because a trainer needs both to control total spend and to divide it fairly among their clients.

The cost is having two counters instead of one. The payoff is that the account holder can administer the split, and that what they see while doing it is **only aggregates and counts**: quota administration doesn't reveal members' prompts, memories or private content. Managing someone's spend doesn't entitle you to read what they write.

---

## 6. Unit economics: what isn't known yet

This calls for candour, because it's the question an examining board will ask.

The dominant variable cost is the model call. With the current architecture the provider is hot-swappable between OpenRouter, OpenAI, Anthropic, Google and OpenCode-Go, which turns the choice into a genuine economic lever rather than a migration.

But **cost per user isn't measured**. There is no cost instrumentation per tenant or per generation, and the Pro caps — five hundred generations a month — are sized as a safety ceiling, not derived from observed consumption. At the price of a small model those five hundred generations are perfectly sustainable; with a large model, not necessarily.

Langfuse already traces every call with its model, its tokens and its latency, so the instrumentation needed is one step away. It's the first thing to do before setting a real price.

---

## 7. Conversion levers

The natural conversion point is trial expiry with the data intact: the user already has their plan, their history and their memory inside.

The free limit of one generation and one regeneration a month is deliberately tight. It lets you genuinely try the product — a full plan is generated and can be redone once — and it doesn't let you live on the free tier indefinitely if you train seriously, because changing goal or equipment requires regenerating.

Memory is the least obvious lever and perhaps the most powerful: it's the capability that improves with use. The longer someone has been using the product, the more context the system holds and the more expensive starting from scratch somewhere else becomes.
