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

- The Claude subscription Fable review preflight still blocks when
  `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, or any
  other third-party provider selector is in the launch environment. That is
  the check doing its job, not an obstacle.
- GLM runs as its own Codex process, never as a model value handed to another
  harness's selector, `spawn_agent`, or native-subagent override.
