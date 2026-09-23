# Model cost weighting: method and current table

How the routing catalog's cost weights are derived, so they can be
reproduced, checked, and updated rather than argued about.

Companion to `references/harness-model-invocation.md`, which explains why
published rates settle little. This document does not repeat that argument;
it takes it as the premise and builds a procedure on top of it.

## What the router actually consumes

The method has to target what the code reads, or it is decoration.

`relativeCostIndex` is consulted **only** when a tier declares
`softPriorities: ["cost"]`, and only on the first tier
(`select.mjs:232`, `:451`; `catalog.mjs:240`). Everywhere else, selection is
tier order then list position. Today exactly one role opts in:
`implementation.cross-harness`.

A `rates[]` entry is richer and takes precedence. `freshRate()`
(`select.mjs:198`) selects the newest entry matching **all** of:

| Field | Why it exists |
| --- | --- |
| `meter` | Comparison happens only within a meter (`select.mjs:448`). Meters never convert. |
| `carrierId`, `carrierVersion` | A rate belongs to a carrier build, not a model name. |
| `effort` | Rates are per effort level. |
| `billingSurface` | Subscription and API surfaces bill differently. |
| `resolvedModelDigest` | Binds the rate to the model actually resolved, not the alias. |
| `checkedAt` + `staleAfterSeconds` | A rate expires on its own. Staleness is structural, not a reminder. |
| `promotionExpiresAt` | A promotional rate stops applying without anyone editing the file. |
| `asOf`, `sourceUrl` | Provenance, so a number can be re-derived. |

The catalog currently has **zero** rate entries. Every weight in it is a
hand-set `relativeCostIndex`, which most roles never read.

## The method

### Step 1 — Enumerate routable cells

A cell is one `(harness, model, effort)` the **carrier** permits. Carrier
ceilings are the outer bound; a catalog cannot widen them
(`select.mjs:190` rejects an effort the carrier does not list).

Cells that do not exist are not choices. Record them as absent rather than
as expensive.

### Step 2 — Assign each cell its meter

One meter per billing relationship. Never total or rank across meters.

**The router enforces this within `candidateSort()`.** Cost ranks candidates by
`relativeCostIndex` only when they share a meter; a cross-meter pair is not
cost-comparable, so cost stops being a discriminator for it and the ordering
falls through to the remaining priorities and then tier position. That keeps
cost doing real work where the numbers mean something, without ever inventing a
comparison between "1% of the priciest model on one meter" and "8% of the
priciest on another" — different denominators, different billing relationships.

So `softPriorities: ["cost"]` is worth setting on any tier containing two or
more models **on the same meter**, and is simply inert (not harmful) on a tier
that spans meters. Set it wherever a same-meter contest exists; express
cross-meter preference as tier order.

### Step 3 — Derive a within-meter price index

Published per-token rates, blended for agentic shape:

```
effective_input_multiplier = (cache_hit × cache_read_rate) + (1 − cache_hit)
cost_per_work_unit         = (io_ratio × effective_input_multiplier × input) + output
index                      = round(100 × cost_per_work_unit ÷ meter_reference)
```

State the assumptions with the number, because changing them changes the
answer and reviewers need to see which one moved:

| Assumption | Value used | Basis |
| --- | --- | --- |
| `io_ratio` (input:output tokens) | 10:1 | Agentic turns resend a large stable prefix. |
| `cache_hit` | 0.90 | Harnesses resend prefixes every turn. |
| `cache_read_rate` | 0.10 × list input | Anthropic reads ≈0.1×; OpenAI cached input ≈1/10. |
| ⇒ `effective_input_multiplier` | **0.19** | 0.9(0.1) + 0.1(1.0) |

The meter reference is that meter's most expensive routable model, so the
index is a within-meter percentage and never implies a cross-meter ratio.

### Step 4 — Use planning rates, not promotional ones

Compute the index twice: at the current rate, and at the rate that applies
once promotions lapse. **Route on the planning index.** A promotion that
expires mid-quarter should not silently re-rank the fleet.

Record the promotion in `promotionExpiresAt` so the expiry is mechanical.

**Do not add the promotional amount as an exact rate.** `freshRate()` treats a
rate entry as exact until `promotionExpiresAt`, and `candidateSort()` gives an
exact rate precedence over `relativeCostIndex` — so entering the promotion
re-ranks the fleet *by the promotion*, during exactly the window this section
says to plan on the post-promotion index. Expiry then only makes the entry
ineligible; it does not activate a planning rate, because there is no rate
underneath it to fall back to.

Encode it the way the resolver actually reads:

- Leave the promotional amount out of `rates[]` entirely, and set
  `relativeCostIndex` from the **post-promotion** price. Planning then reflects
  the price you will actually pay, and nothing silently re-ranks at expiry.
- If the live promotional price genuinely should drive routing for its window,
  enter it as the exact rate *and* enter the post-promotion rate as the
  replacement that takes effect at expiry — an expiring entry with no successor
  is a cliff, not a schedule.

### Step 5 — Effort weighting requires measurement, not arithmetic

This is the step most likely to be faked, so it is stated plainly:

**Published rates do not vary by effort.** Effort changes how many tokens a
task consumes, not the price per token. Cost per task is therefore
`price_per_token × tokens(effort)`, and `tokens(effort)` is not derivable
from any price list.

So:

- Rate entries for the same model at different efforts carry the **same
  amount**. That is correct, not an oversight.
- The effort multiplier must come from observed outcomes — specifically from
  the retained `learningOutcomes`, **grouped by route**.

  Not from `learningAggregates`: `updateLearning()` accumulates measured usage
  only into the route-independent `baseDemand` aggregate, while the per
  model/effort `routeEffect` aggregates carry quality signals and no usage
  totals at all. `baseDemand` pools every route for a work class, so it cannot
  yield cost per completed task for a given model or effort no matter how much
  data it holds. Either group the retained outcomes by route yourself, or add
  route-level usage aggregation first — the aggregate table as it stands cannot
  answer this question.
- Until that has data, **do not rank efforts by cost.** Choose effort by
  capability need through the role vocabulary, and let cost decide only
  between models at equal capability.

Anyone assigning effort weights from a price list is inventing them.

### Step 6 — Set the update triggers

| Trigger | Action |
| --- | --- |
| `checkedAt + staleAfterSeconds` elapsed | Re-check the published rate; refresh or drop the entry. |
| `promotionExpiresAt` reached | Planning index becomes the live index; verify the reverted rate. |
| Carrier version changes | Rates are carrier-bound; re-verify before reuse. |
| A model's resolved identity changes | `resolvedModelDigest` mismatch invalidates the rate automatically — **except** where the identity moves underneath a stable selector; see below. |
| Retained route-level outcomes reach usable volume, or route-level usage aggregation is added | Replace Step 3 arithmetic with measured cost per completed task. |

`resolvedModelDigest` only invalidates what it can observe. `freshRate()`
hashes `candidate.model.requestedModel` whenever `observedModel` is unknown,
and the Daybreak availability probe records `{available, checkedAt}` and no
model identity at all. So when `gpt-daybreak-blue-latest` is repointed at a
different underlying model, the selector string is unchanged, the digest is
unchanged, and a Sol-derived Daybreak rate stays "valid" across the very
identity change it was supposed to catch. The repository also treats this
owner selector as distinct from the public alias and never substitutes the
public alias at runtime, so nothing else closes the gap either.

Until the probe records an observed model identity, a Daybreak rate must not be
carried as an exact rate derived from Sol's published price. Leave Daybreak
unranked, or re-verify it manually on a schedule and treat the digest as
evidence of nothing.

Step 3 is a bootstrap. Measured outcomes supersede it; that is the intended
end state, not a fallback.

## Current table

Rates were refreshed from OpenAI's GPT-6 Sol and Luna release on 2026-09-22.
They are API-price heuristics for `codex-sub`, not measured subscription cost
per accepted task. Re-check before relying on them.

### Meter: `claude-sub` — reference model `fable`

| Model | Input | Output | Work unit | Index | Planning index |
| --- | --- | --- | --- | --- | --- |
| `fable` | 10.00 | 50.00 | 69.00 | **100** | 100 |
| `sonnet` | 3.00 | 15.00 | 20.70 | **30** | stale — introductory rate ended 2026-08-31 |
| `haiku` | 1.00 | 5.00 | 6.90 | **10** | 10 |

The derived indices reproduce the catalog's existing Claude-side numbers
exactly, which is the intended check on the method.

### Meter: `codex-sub` — reference work unit: prior Sol promotional pricing

| Model | Input | Output | Work unit | Index | Planning index |
| --- | --- | --- | --- | --- | --- |
| Prior Sol promotional reference | 4.00 | 20.00 | 27.60 | **100** | 100 |
| `gpt-6-sol` | 2.00 | 10.00 | 13.80 | **50** | **50** |
| `gpt-6-luna` | 0.10 | 0.50 | 0.69 | **3** | **3** |

OpenAI's GPT-6 release publishes $2/$10 for Sol and $0.10/$0.50 for Luna per
million input/output tokens, against prior promotional cells of $4/$20 and
$0.20/$1.20. It calls both transitions 50% cheaper. Sol and Luna input are
exact halvings; Luna output, $1.20 to $0.50, is a 58.3% reduction, not an exact
half (which would be $0.60). These are the published cells used above, not a
correction of OpenAI's table. Source: [Introducing GPT-6 Sol and Luna](https://openai.com/index/introducing-gpt-6-sol-and-luna/).

`daybreak-blue-latest` is not separately priced. Do not derive a current
Daybreak rate from either GPT-6 model without an identity-attested rate. Two
consequences worth holding onto:

- Routing a security role to Daybreak needs an access and approval rationale,
  not a borrowed Sol or Luna price.
- An alias can be repointed. Add an exact rate only when the observed identity
  and its resolved-model digest bind the published rate to the actual carrier.

## What this changes

1. **Use `gpt-6-sol: 50` and `gpt-6-luna: 3` as provisional
   `relativeCostIndex` values.** They are normalized to the prior Sol
   promotional work unit (27.60), so they remain within the same API meter and
   do not compare Codex to Claude pricing.

2. **Luna is about 5% of GPT-6 Sol in this workload shape** (0.69 / 13.80),
   but that does not establish an effort or accepted-task ranking.

3. **`sonnet` is stale.** Its index is built on an introductory rate that ended
   on 2026-08-31; re-verify before letting it order a route.

4. **Daybreak remains unpriced** until it has an identity-attested rate.

5. **Most indices are inert.** Only `softPriorities: ["cost"]` tiers read
   them. Populating `rates[]` and opting the right tiers in is what makes
   any of this load-bearing.

## Reproducing this

1. Re-read the published table in `references/harness-model-invocation.md`.
2. Recompute Step 3 with the stated assumptions; change an assumption only
   deliberately, and note which.
3. Recompute Step 4 for anything promotional.
4. Leave effort weighting alone unless retained route-level outcomes have
   usable usage data, or route-level usage aggregation has been added.
5. Diff against the catalog's current indices and justify each difference.
