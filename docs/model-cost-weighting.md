# Model cost weighting

This page gives relative cost weights for models within one billing
relationship, and shows how they were derived so anyone can recheck them.
They are a rough input to allocation. What matters is the cost of the
accepted result, including retries, repairs, and child agents, not the price
per token. Model and effort guidance lives in
[`railyard:model-routing`](../plugins/railyard/skills/model-routing/SKILL.md).
List prices and controls are in the
[native invocation reference](../plugins/railyard/references/harness-model-invocation.md).

## Method

1. **One meter per billing relationship.** Claude and Codex bill separately,
   so never rank one family's models against the other's by these numbers.
   Express a cross-family preference as policy, not as a weight.
2. **Blend list rates for agentic work.** Agent turns resend a large, mostly
   cached prefix:

   ```
   effective_input_multiplier = cache_hit × cache_read_rate + (1 − cache_hit)
   work_unit = io_ratio × effective_input_multiplier × input + output
   index     = round(100 × work_unit ÷ meter_reference)
   ```

   | Assumption | Value | Basis |
   | --- | --- | --- |
   | `io_ratio` (input:output) | 10:1 | Agents resend a large stable prefix every turn |
   | `cache_hit` | 0.90 | Prefixes are resent every turn |
   | `cache_read_rate` | per model; 0.10 × input unless listed | Anthropic: 0.05 for Opus 5.5, 0.025 for Fable 5.1; OpenAI about a tenth of list |
   | effective input multiplier | 0.19 at 0.10; 0.145 at 0.05; 0.1225 at 0.025 | 0.9 × `cache_read_rate` + 0.1 |

   The cache-read rate is per model: use each model's published rate, not a
   flat tenth.

3. **Plan on post-promotion prices.** A promotion that ends mid-quarter
   shouldn't re-rank models.
4. **Effort is not priced.** Per-token rates are the same at every effort;
   effort changes how many tokens a task uses. Choose effort by what the work
   needs. Weight effort only once measured per-task outcomes exist.
5. **Measured outcomes win.** Once cost per accepted task has been measured
   for a model and effort, use that number instead of this arithmetic.

## Current table (checked 2026-09-28)

### Claude (reference: Fable 5.1 = 100)

| Model | Input $/MTok | Cache read $/MTok | Output $/MTok | Work unit | Index |
| --- | --- | --- | --- | --- | --- |
| Fable 5.1 | 10.00 | 0.25 | 50.00 | 62.25 | **100** |
| Opus 5 | 5.00 | 0.50 | 25.00 | 34.50 | **55** |
| Opus 5.5 | 4.00 | 0.20 | 20.00 | 25.80 | **41** |
| Sonnet 5.5 | 2.00 | 0.20 | 10.00 | 13.80 | **22** |
| Sonnet 5 | 2.00 | 0.20 | 10.00 | 13.80 | **22** |
| Haiku 4.5 | 1.00 | 0.10 | 5.00 | 6.90 | **11** |

Source for cache-read rates: the
[Sonnet 5.5 overview](https://platform.claude.com/docs/en/models/sonnet-5-5/overview).

Anthropic reports that Opus 5.5 at `medium` matches or exceeds Opus 5 at
`high`. At a lower price, that makes Opus 5.5 the better default of the two
for most work. Measured outcomes still decide it.

Sonnet 5.5 costs the same as Sonnet 5. Anthropic reports that on several
benchmarks Sonnet 5.5 at `low` or `medium` beats Sonnet 5's best score at
about a tenth of the cost per task. Against Opus 5.5, per-task savings
depend on the output share: Sonnet 5.5 cache reads cost $0.20/MTok, the same
as Opus 5.5.

### Codex (reference: prior GPT-6 Sol promotional price = 100)

| Model | Input $/MTok | Output $/MTok | Work unit | Index |
| --- | --- | --- | --- | --- |
| Prior Sol promotional reference | 4.00 | 20.00 | 27.60 | 100 |
| GPT-6 Sol | 2.00 | 10.00 | 13.80 | **50** |
| GPT-6 Luna | 0.10 | 0.50 | 0.69 | **3** |

Source: [Introducing GPT-6 Sol and Luna](https://openai.com/index/introducing-gpt-6-sol-and-luna/).

Astra is not indexed here. Daybreak (`gpt-daybreak-blue-latest`) is not
separately priced, and because its alias can be repointed, don't derive a
Daybreak rate from Sol or Luna. Choosing Daybreak for security work needs an
access rationale, not a borrowed price.

## Updating

Recheck published prices when a model launches or a promotion ends. Recompute
the work unit with the assumptions above, and note any assumption you change.
Update this table and the price column in the native invocation reference
together.
