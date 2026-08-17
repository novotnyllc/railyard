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

One meter per billing relationship. Never total or rank across meters — the
router already refuses to, and the refusal is correct.

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

### Step 5 — Effort weighting requires measurement, not arithmetic

This is the step most likely to be faked, so it is stated plainly:

**Published rates do not vary by effort.** Effort changes how many tokens a
task consumes, not the price per token. Cost per task is therefore
`price_per_token × tokens(effort)`, and `tokens(effort)` is not derivable
from any price list.

So:

- Rate entries for the same model at different efforts carry the **same
  amount**. That is correct, not an oversight.
- The effort multiplier must come from observed outcomes — the resolver's
  learning subsystem (`learningOutcomes`, `learningAggregates`).
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
| A model's resolved identity changes | `resolvedModelDigest` mismatch invalidates the rate automatically. |
| `learningAggregates` reaches usable volume | Replace Step 3 arithmetic with measured cost per completed task. |

Step 3 is a bootstrap. Measured outcomes supersede it; that is the intended
end state, not a fallback.

## Current table

Rates as published 2026-08-05, re-read 2026-08-16. Re-check before relying
on them.

### Meter: `claude-sub` — reference model `fable`

| Model | Input | Output | Work unit | Index | Planning index |
| --- | --- | --- | --- | --- | --- |
| `fable` | 10.00 | 50.00 | 69.00 | **100** | 100 |
| `sonnet` | 3.00 | 15.00 | 20.70 | **30** | unknown — introductory to 2026-08-31 |
| `haiku` | 1.00 | 5.00 | 6.90 | **10** | 10 |

The derived indices reproduce the catalog's existing Claude-side numbers
exactly, which is the intended check on the method.

### Meter: `codex-sub` — reference model `sol`

| Model | Input | Output | Work unit | Index | Planning index |
| --- | --- | --- | --- | --- | --- |
| `sol` | 5.00 | 30.00 | 39.50 | **100** | 100 |
| `terra` | 2.00 | 12.00 | 15.80 | **40** | **80** (listed at 50% off) |
| `luna` | 0.20 | 1.20 | 1.58 | **4** | **8** (listed at 50% off) |
| `daybreak_blue` | — | — | — | **unranked** | no published rate |

### Meter: `zai-credits`

`glm` bills in Z.ai Coding Plan credits, which do not convert to USD. It is
the only model on this meter, so a cost index is meaningless here; it exists
to keep `glm` from being compared against a USD-metered model.

## What this changes

1. **The current Codex indices are wrong in kind.** `sol 80 / terra 60 /
   luna 20` is neither a current-rate nor a planning-rate normalization, and
   80 vs 100 across meters implies a fable↔sol comparison that does not
   exist. Derived within-meter: `sol 100 / terra 80 / luna 8` at planning
   rates.

2. **Luna is far cheaper than the catalog implies** — about 8% of Sol at
   planning rates, not 25%. That materially changes any cost-priority tier.

3. **`sonnet` needs re-checking before 2026-08-31.** Its index is built on an
   introductory rate whose reverted value is not published.

4. **`daybreak_blue` cannot be cost-ranked**, which is harmless: it occupies
   tier 0 alone for the seven `security.*` roles, so cost never decides. Do
   not invent a rate to make the table look complete.

5. **Most indices are inert.** Only `softPriorities: ["cost"]` tiers read
   them. Populating `rates[]` and opting the right tiers in is what makes
   any of this load-bearing.

## Reproducing this

1. Re-read the published table in `references/harness-model-invocation.md`.
2. Recompute Step 3 with the stated assumptions; change an assumption only
   deliberately, and note which.
3. Recompute Step 4 for anything promotional.
4. Leave effort weighting alone unless `learningAggregates` has data.
5. Diff against the catalog's current indices and justify each difference.
