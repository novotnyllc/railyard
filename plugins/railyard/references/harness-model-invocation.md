# Harness defaults and cross-harness model invocation

This reference names the per-harness session defaults, the task shapes each
model fits, and how each harness reaches models it does not run natively. It is
invocation and suitability guidance; the resolver in
[`model-routing.md`](model-routing.md) still owns admission, budget, and
receipts for delegated routes, and nothing here grants a route it has not
admitted.

## Two distinct layers

| Layer | What it means | Harness-specific? |
| --- | --- | --- |
| Session model | The model the interactive harness runs as for the current turn | Yes |
| Delegated carrier route | The model the router resolves for bounded work handed to a carrier | No |

The router's no-config profile is harness-independent: bounded implementation
resolves to Luna at `max`, orchestration or independent review to Sol. A Claude
session that delegates implementation still receives the Luna route.

## Session defaults

A model name without an effort is an incomplete route. Same work rows on both
sides, same escalation ladder, so the columns are directly comparable:

| Work | Codex / ChatGPT | Claude Code |
| --- | --- | --- |
| Routine orchestration, steering, status | Sol `medium` | Opus `medium` |
| Bounded mechanical implementation | Luna `max` | Sonnet `medium` |
| General implementation and agentic coding | Terra `max` | Opus `high` |
| Difficult review, cross-cutting planning | Sol `high` | Fable `high` |
| Highest-stakes reasoning, critical risk | Sol `max` | Fable `max` |
| Long-running implementation under separate orchestration | Terra `max` driven by Sol | Opus `high` driven by Fable |

`medium` is the workhorse for steering, not `high`: most steering turns are
not reasoning-bound, and paying `high` on all of them spends budget the hard
turns need. That is a session-turn statement — the router's frozen delegated
default for an orchestration/review handoff stays Sol `high`, and its frozen
delegated implementation route stays Luna at `max` (Terra only as the attested
substitute); this table is what an interactive session picks, not that
contract.

The two sides escalate by tier, not by matching effort labels. On the Codex
side implementation runs at `max` because the models are priced for it: Luna
at `max` is nearly free and removes retries on mechanical work, and Terra at
`max` is the implementation partner under a Sol orchestration context. On the
Claude side effort stays proportional to rate: Sonnet `medium` already
saturates mechanical work, and Opus `high` is the agentic-coding sweet spot —
`xhigh` is reserved for a genuinely hard unit, since as a standing default it
overthinks and burns budget. Fable `high` maps to Sol `high`: both are the
"this is actually hard" step. Fable-over-Opus for difficult review is this
user's ordering, not a benchmark claim.

### Session model vs. work tier

A skill cannot change the running session's model. When the session runs a
materially higher tier than the work's routed tier — a Fable session asked
to run mechanical fleet maintenance is the canonical case — do not execute
inline: dispatch the work to a fresh child carrying the routed model
(Claude Code: the Agent tool's model parameter or a `claude -p --model`
worker; Codex: task/thread model controls) and keep the session as
controller. Never open a new user-visible thread or chat the user is not
expecting — subagents and the orchestrator's normal visible-task dispatch
are the unsurprising forms; suggest a fresh chat only when asked or when
the work genuinely needs a clean interactive session.

## Dispatch banner

Every child dispatched under this routing self-identifies at the top of its
transcript, so a reader scanning a background session or a Codex subagent can
sanity-check the route at a glance. **The dispatcher composes the line and the
worker echoes it**: a worker cannot reliably introspect its own model or
effort, but the dispatching session just chose both. It is informational
output only — the worker never waits for acknowledgement.

One canonical format, one line, model and effort first because they are the
sanity-check payload:

```text
▸ <model>/<effort> · <role/work-class> · <harness> <session-tier> via <skill> · <label>
```

Every dispatch prompt ends (or begins) with the exact instruction:

> Begin your first message with exactly this line, then proceed without
> waiting: `▸ …`

**Effort is never dropped from the banner** — the banner always shows
`<model>/<effort>`, on every harness. The banner is dispatcher-composed *text*
documenting the *intended* effort: the explicit-model-and-effort rule requires
the dispatcher to choose an effort for every dispatch, so it states that effort
regardless of whether the dispatch tool has a per-dispatch effort parameter.
Where the tool has an effort parameter (Codex), the banner's effort matches the
parameter; where it does not (Claude Code's `Agent`), the effort is a stated
intent, still shown.

| Dispatch | Banner fields | Example |
| --- | --- | --- |
| Claude Code `Agent` | `model` + intended `effort` — stated in the banner text; the tool takes model but has no effort parameter | `▸ opus/high · implementation · Claude Code Fable via railyard:deliver · retry-backoff fix` |
| Codex `spawn_agent` | `model` + `reasoning_effort` (a real parameter) | `▸ gpt-5.6-terra/max · implementation · Codex Sol medium via railyard:orchestrate · importer rewrite` |
| Codex `thread/start` / `create_thread` | `model` + `config.model_reasoning_effort`, plus `modelProvider` when non-default | `▸ glm-5.2/high · bulk edit · Codex Sol medium via railyard:orchestrate (zai_litellm) · lint sweep` |
| `codex exec` / `claude -p` worker | `model` + `effort` — from the flags on Codex; a stated intent for `claude -p`, which has no effort flag | `▸ claude-opus-5/high · review · Codex Sol high via railyard:thermos · PR 412` |

### Mid-thread changes

When a continuation changes the running model **or** effort, the continuation
message carries the same echo instruction with a change line. Both sides show
`<model>/<effort>`, so a change of effort alone (same model) is still announced:

```text
▸ route change: <old-model>/<old-effort> → <new-model>/<new-effort> · <reason>
```

| Harness | Mid-thread change |
| --- | --- |
| Codex thread continuation with a model or effort override | Supported — instruct the change line on the first message after the override. |
| `codex exec` re-invocation | N/A: a fresh process emits a fresh banner, not a change line. |
| Claude Code `Agent` + `SendMessage` | N/A: a live subagent's model is fixed at dispatch; a different model is a new dispatch with a fresh banner. |
| Claude Code `SendMessage` to a peer session | N/A: a peer session owns its own route; a message cannot change its model or effort. |

Where a harness cannot change model or effort mid-thread it is N/A — do not
invent machinery to simulate it.

## Session messaging

Both harnesses can put text into another live session, and neither changes that
session's route by doing so.

| Harness | Reach | Mechanism |
| --- | --- | --- |
| Codex | its own tasks and threads | `send_message_to_thread` / `followup_task` |
| Claude Code | live subagents; peer sessions on this machine; reply-only to sessions on other machines and on the web | `SendMessage` to a name from `ListAgents` (v2.1.224+, macOS/Linux) |

A message carries plain text only, never a model or effort control, so there is
no `▸ route change:` line for one. Work that needs a different model is a fresh
dispatch with its own banner. Coordination doctrine — when messaging beats a
checkpoint, addressing by `--name`, and the delivery limits — lives in
`../skills/orchestrate/SKILL.md`.

## Nested subagents

A subagent handed a subtask that genuinely splits should dispatch its own
children rather than serializing the work itself. Both harnesses allow it:

| Harness | Recursion | Depth |
| --- | --- | --- |
| Codex | `spawn_agent` from inside a spawned agent | pass the inherited nested-subagent ceiling down as the bound |
| Claude Code | the `Agent` tool is available to a subagent by default | three layers below the main conversation; `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` changes it, `1` turns nesting off |

At the Claude Code limit the `Agent` tool is withheld, so the deepest subagent
does its delegated work itself and returns one summary — nothing to detect or
handle. A worker that must not delegate at all omits `Agent` from its `tools`
or lists it in `disallowedTools`.

**Every rule applies at every depth.** A nested dispatch is a dispatch: it
names an explicit model and effort, it carries the same objective, scope,
constraints, and required evidence, and the *nested* dispatcher composes its
own child's banner — the dispatcher-composes rule recurses, because a worker
three levels down still cannot introspect its own route.

What is mechanically enforced at depth, as opposed to briefed:

| At depth | Claude Code | Codex |
| --- | --- | --- |
| Explicit-model gate | **Enforced.** Plugin `PreToolUse` hooks fire for a subagent's tool calls exactly as for the main thread — verified here: a model-less `Agent` call from inside a subagent, and from inside that subagent's own nested child, were both refused by the gate. | Doctrine, with the `spawn_agent` hook registered; whether Codex delivers `PreToolUse` inside a spawned agent's turn is unverified. |
| Run-log `dispatch` line | Written wherever the gate runs — same hook, same process, one call apart. | Same. |
| `subagent_stop` line | Fires per subagent. | No equivalent event; completion comes from doctrine `outcome` lines. |
| Banner echo | Doctrine only, at every depth. | Doctrine only, at every depth. |

Everything in a doctrine-only row is a briefing obligation: the parent's
dispatch text is the only thing that makes it happen.

**Sanity rule.** Each level must buy real fan-out or real specialization —
several children that can run at once, or a child with a materially different
model, tool set, or scope. A level that takes one assignment and passes it
along unchanged is delegation theater: it adds a context boundary, a summary
hop, and a budget line for nothing. Collapse it and do the work.

This is unrelated to agent teams' *no nested teams* limitation (see
`../skills/orchestrate/SKILL.md`). Teammates cannot spawn teammates; an
ordinary subagent spawning subagents is a supported, default-on capability.
Do not read the team restriction as a ban on recursion.

The banner is per-dispatch self-ID inside one transcript. Its sibling,
`run-audit.md`, is the aggregate reconstruction across a whole run — the
append-only run log, the completion recap, and `railyard:audit`. Banners are
corroboration for an audit; the log is what survives compaction.

## Published rates and what they imply

Checked 2026-08-05 against provider and OpenRouter listings; list prices in USD
per million tokens. Rates go stale — re-check before relying on them.

| Model | Input | Output | Context |
| --- | --- | --- | --- |
| `gpt-5.6-luna` | 0.20 | 1.20 | 1M |
| `claude-haiku-4-5` | 1.00 | 5.00 | 200K |
| `glm-5.2` (Z.ai direct API) | 1.40 | 4.40 | 1M |
| `gpt-5.6-terra` | 2.00 | 12.00 | 1M |
| `claude-sonnet-5` | 3.00 | 15.00 | 1M |
| `gpt-5.6-sol` | 5.00 | 30.00 | 1M |
| `claude-opus-5` | 5.00 | 25.00 | 1M |
| `claude-fable-5` | 10.00 | 50.00 | 1M |

Terra and Luna are listed at 50% off, and Sonnet 5 is introductory through
2026-08-31; a promotional rate is not the rate to plan against.

The one claim this table settles: after OpenAI's 2026-07-30 change, "route to
GLM-5.2 to save money" is not true as a sticker-price argument. It settles
little else:

- **Rate is not cost per completed task.** Thinking tokens, retries, and extra
  turns are what get billed; a higher-rate model that finishes in one pass can
  cost less than a cheaper one that needs three.
- **Operating points differ.** Luna at `max` and GLM at `xhigh` are different
  amounts of work per request; dividing sticker rates compares unlike units.
- **Meters differ.** This host's GLM route bills in Z.ai Coding Plan credits,
  which do not convert to USD. Never compare or add across meter types.
- **Cache rates dominate agentic spend.** These harnesses resend large stable
  prefixes every turn, so most input is cache reads billed far below list —
  Anthropic reads ~0.1x (writes 1.25x/2x), OpenAI cached input at one tenth,
  Z.ai's credit formula has its own cached-input multiplier and its plan sizing
  assumes ~90% cache hits. A ranking built on uncached list rates can invert
  once caching is included.

Treat the table as one bounded input, never the decision, and prefer measured
local outcomes (the resolver's learning subsystem) over arithmetic on list
prices. Published benchmark placements are deliberately not a selection
criterion.

## GLM-5.2 is Codex-only

**Claude Code cannot invoke GLM-5.2.** Z.ai's Anthropic-compatible endpoint
only authenticates when the config profile has no claude.ai login — an active
login outranks any environment token and is sent to Z.ai, which rejects it.
Removing the login also removes the account-bound connectors, so a GLM-backed
Claude session structurally cannot carry the same MCP servers, permissions,
and capabilities as the invoker; `--bare` strips even more. Since a degraded
session is unacceptable, the route does not exist. Do not rebuild it with
`ANTHROPIC_BASE_URL`, `CLAUDE_CONFIG_DIR`, `apiKeyHelper`, or `--bare` — all
of these were tried and each either fails auth or fails capability parity.

Route GLM work through Codex instead, where the provider mechanism preserves
the full harness:

```toml
[model_providers.zai_litellm]
name = "Z.ai Coding Plan via LiteLLM"
base_url = "http://127.0.0.1:4141/v1"
env_key = "LITELLM_PROXY_API_KEY"
wire_api = "responses"
```

```bash
codex exec -m glm-5.2 -c model_provider=zai_litellm '<prompt>'
```

The local LiteLLM proxy must be running; a stopped proxy or missing key
surfaces as a normal command failure, and that failure is the availability
check — do not build a detection layer in front of it.

GLM's case is not price: it is **subscription headroom** (the Z.ai Coding Plan
is already paid monthly, so work inside remaining quota costs nothing at the
margin) and **provider diversity** when the primary is rate-limited or
degraded. Good fits are high-volume or repetitive work and long-running
investigation inside quota; brief it completely, since the process starts
cold.

## Cross-harness handoffs

| Direction | Mechanism |
| --- | --- |
| Claude Code → Codex models (including GLM) | the `codex` plugin's rescue forwarder — a skill on Codex, the `codex-rescue` agent on Claude Code — or a direct `codex` CLI invocation (`codex exec -m <model> ...`) |
| Codex → Claude models | `claude -p --model <claude-model-id>`; a read-only Claude subscription review uses only the supported Compound Engineering `-p` adapter |
| Either → ChatGPT Pro one-shot review | `railyard:oracle`, which has its own invocation rules and requires a ChatGPT Pro subscription (see that skill for cached availability detection) |

These are the only supported handoff shapes. The rescue subagent is a
forwarder, not an orchestrator: one invocation, return its output unchanged;
leave model and effort unset unless the request names them.

## Boundaries this reference does not move

- The Claude subscription review preflight still blocks when
  `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, or any
  other third-party provider selector is in the launch environment. That is
  the check doing its job, not an obstacle.
- GLM runs as its own Codex process, never as a model value handed to another
  harness's selector, `spawn_agent`, or native-subagent override.
