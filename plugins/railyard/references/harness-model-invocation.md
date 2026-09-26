# Native model and effort invocation

This is Railyard's reference for choosing models and effort in Claude Code and
Codex. [`railyard:model-routing`](../skills/model-routing/SKILL.md) says which
model fits which work. This page covers the controls that apply the choice.
Snapshot as of 2026-09. When the live tool schema or harness docs disagree
with this page, they are correct.

## Models

| Harness | Model | Exact ID / selector | Alias | Efforts | Price in / out (per MTok) |
| --- | --- | --- | --- | --- | --- |
| Claude Code | Fable 5.1 | `claude-fable-5-1` | `fable` | `low`–`max` | $10 / $50 |
| Claude Code | Opus 5.5 | `claude-opus-5-5` | `opus` (also the default model) | `low`–`max`, default `medium` | $4 / $20 |
| Claude Code | Opus 5 | `claude-opus-5` | — (pin by ID) | `low`–`max` | $5 / $25 |
| Claude Code | Sonnet 5 | `claude-sonnet-5` | `sonnet` | `low`–`max` | $2 / $10 |
| Claude Code | Haiku 4.5 | `claude-haiku-4-5` | `haiku` | none | $1 / $5 |
| Codex | GPT-6 Sol | `gpt-6-sol` | — | check live schema | $2 / $10 |
| Codex | GPT-6 Luna | `gpt-6-luna` | — | check live schema | $0.10 / $0.50 |
| Codex | GPT-6 Astra | `gpt-6-astra` | — | check live schema | not tracked here |
| Codex | Daybreak | `gpt-daybreak-blue-latest` | — | check live schema | not separately priced |

On Claude, the full effort range is `low`, `medium`, `high`, `xhigh`, `max`.
Anthropic reports that Opus 5.5 at `medium` matches or exceeds Opus 5 at
`high`, so don't carry Opus 5 effort habits over to Opus 5.5. Opus 5.5
requires Claude Code 2.1.280 or later; older versions resolve `opus` to an
earlier Opus, so update Claude Code rather than pinning an old ID.

For Codex, OpenAI's published API efforts are `none` through `max` for Sol and
Luna, and `low` through `max` for Astra. Some native surfaces have also listed
an `ultra` level for Sol, Astra, or Daybreak. Railyard has not verified
`ultra`, so use it only when the live `spawn_agent` schema lists it for that
model. Daybreak appears only on some accounts and hosts. Effort names are
model-specific: Codex's `ultra` is not a Claude effort, and Claude's levels
don't map one-to-one onto Codex's.

Prices are list API rates. They are a planning input, not the cost of an
accepted result. The Railyard repository's
`docs/model-cost-weighting.md` has the relative weights.
Sources: [Claude Code model configuration](https://code.claude.com/docs/en/model-config),
[subagents](https://code.claude.com/docs/en/sub-agents), and
[Introducing GPT-6 Sol and Luna](https://openai.com/index/introducing-gpt-6-sol-and-luna/).

## Claude Code controls

- **Session.** `--model <alias|ID>` and `--effort <level>`, `/model`, or the
  `model` setting. An alias follows the current release; an exact ID pins one.
- **Alias remapping.** `ANTHROPIC_DEFAULT_OPUS_MODEL` (and the matching
  variables for other aliases) changes what an alias resolves to. Provider
  gateways and user pins can also remap aliases, so `opus` does not by itself
  prove that Opus 5.5 ran.
- **Subagent default.** `CLAUDE_CODE_SUBAGENT_MODEL` sets the model for
  subagents that don't specify one.
- **Agent tool.** `model` accepts only `sonnet`, `opus`, `haiku`, or `fable`.
  Exact IDs and `[1m]` suffixes are not accepted there. The tool has no effort
  parameter.
- **Subagent definitions.** A definition's frontmatter can set an exact
  `model` (or `inherit`) and an `effort`. Select it with `subagent_type` and
  leave out `model`. With no `effort` in the definition, the subagent uses the
  session's effort.
- **Forks.** `subagent_type: "fork"` inherits the parent's model and effort and
  ignores a `model` override.
- **Fallback.** When `model` is omitted, Claude Code uses the definition's
  model, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the parent's model.

When an authorized Claude CLI invocation must refuse rather than switch
models after a flagged request, set `switchModelsOnFlag: false` in that
invocation's settings and supply no fallback chain. Do not edit global user
settings or bypass managed policy to do it.

## Codex `spawn_agent` controls

The native tool exposes `model`, `reasoning_effort`, and `fork_turns`.

- `fork_turns` omitted or `"all"` gives a full-history fork. The child
  inherits the parent's model and effort and cannot take either override.
- To set `model` or `reasoning_effort`, pass `fork_turns: "none"` or a
  history-count string. The child sees little or none of the conversation, so
  the brief must carry the objective, file scope, constraints, and acceptance
  checks.
- The tool has no role parameter. A role name in a prompt does not select a
  model.
- A native follow-up message cannot change effort. To change allocation for
  continuing work, spawn a successor with the new pair and a sufficient brief,
  and make sure the old child is finished or stopped before the successor
  writes to the same files.
- Some existing Codex tasks expose `model` and `thinking` on
  `send_message_to_thread`. Check the live schema before using them.

A Codex example for a hard investigation:

```json
{
  "task_name": "investigate_importer",
  "message": "Investigate the importer concurrency failure in src/importer/ and return a causal explanation with a focused reproduction. Do not edit files. <failure output and constraints here>",
  "model": "gpt-6-astra",
  "reasoning_effort": "high",
  "fork_turns": "none"
}
```

For deliberate inheritance, send `fork_turns: "all"` with no `model` or
`reasoning_effort`. Never pair overrides with `"all"`, even values that match
the parent's.

A provider catalog, a working CLI route, or an App Server model list does not
prove that `spawn_agent` accepts a selector. Native spawn also has no
per-child plugin control. Narrowing history changes what the child sees, not
which skills or tools it has.

## Verification and reporting

Dispatch arguments record what you asked for. A worker repeating its model
name in text proves nothing. Where the runtime exposes the actual model and
effort, report them. Otherwise report the request, or the deliberate
inheritance, and say the actual values are unverified. One sentence covers
it: "Requested Opus 5.5 at high; observed model unverified."

If a requested model, effort, or history mode is rejected, report the
rejection. Don't silently retry with a different model or drop the override.
