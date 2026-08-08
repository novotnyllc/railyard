<!-- cross-repo links use site-absolute paths, resolved at site build -->

# How railyard compares

A reader deciding where railyard fits is usually weighing it against tools they already know and
like. This page is an honest map of that landscape. Each category below does something genuinely
well; railyard's contribution is to combine four of those strengths into one intent-routed flow.

**The thesis, up front:** railyard is the one place where model routing, intent-routed delivery,
review-through-merge-proof, and a durable audit trail are a single path — the same on Claude Code
and Codex, budget-aware by default. A human says *go do X* and gets back a merged, verified change
with a receipt. Most tools own one of those four links well; railyard's differentiator is owning
the whole chain, and proving the last one landed.

## Raw agent CLIs — Claude Code and Codex on their own

Claude Code and Codex are excellent at the core act: read a codebase, reason about it, write the
change. railyard is a plugin *for* both of them — it rides their subagent, hook, and plugin
surfaces, and everything it does happens inside a session you already run.

What railyard adds on top is the connective tissue around that core act: it routes each unit of
work to a fitting model and effort before dispatch, runs independent review gates before commit,
owns the merge, and proves the merge landed. The raw CLI gives you a capable agent; railyard turns
one sentence into a tracked delivery that ends in post-merge proof rather than a report that the
work is done. And because it speaks both harnesses through one routing brain, the behavior is the
same whether you're in Claude Code or Codex — one entry point, learned once.

## Generic multi-agent orchestrators

Frameworks for wiring up multiple agents — graphs, role definitions, message passing — are
powerful and general. They give you the machinery to build almost any topology.

railyard is narrower and more opinionated on purpose: it's built for one job, shipping software
changes, and the orchestration is shaped to that job. [orchestrate](./skills/orchestrate.md)
splits an objective into independently resumable lanes, assigns one canonical writer per shared
file, freezes shared contracts before parallel work, and verifies each destination is ready before
placing anything there. Crucially, most readers never touch it: on one machine,
[deliver](./skills/deliver.md) owns a single lane and orchestration stays out of the way. The
generality is available when the work actually branches, and absent when it doesn't.

## CI and PR bots

CI systems and PR review bots are the reason a lot of bad changes never merge. They run on the
server, after the push, and they're great at being the consistent gate every PR passes through.

railyard's review runs earlier and closer in — before the commit, on the diff, with full local
context — so a branch doesn't accumulate mistakes that CI becomes the first real QA pass for. The
[Thermos](./skills/thermos.md) gate answers "would review have caught this?" with two independent
lenses, and [Oracle](./skills/oracle.md) can add a second frontier model that has read the actual
files. Then railyard closes the loop CI usually leaves open: it doesn't stop at "checks are green,"
it merges and confirms the merge commit is reachable from the base branch with a real post-merge
check. Server-side CI and railyard's local gates complement each other — one is the shared
backstop, the other is the pre-commit conscience — and railyard treats CI as one signal in a
settled PR, never the finish line.

## Model-picker and router tools

Routers that pick a cheaper or stronger model per request solve a real cost problem, and
[model-routing](./skills/model-routing.md) shares their instinct: routine steering shouldn't burn a
premium tier, and hard implementation shouldn't go to a model that's too small for it.

What's specific to railyard is that routing is wired into a delivery workflow rather than sitting
in front of a chat endpoint. The decision is frozen per unit of work and *enforced*: a
`PreToolUse` hook refuses any subagent dispatch that omits an explicit model, so routine work can't
silently inherit a premium session's tier. Routing also carries effort, transport, and budget, and
every downstream gate — implementation, Thermos, Oracle — consumes that same decision. It's less a
model picker in front of a prompt and more a budget policy threaded through an entire delivery.

## Compound Engineering — the substrate railyard builds on

One name on this page isn't a comparison. [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)
from [Every](https://every.to) is the workflow engine railyard drives for the plan, implement,
review, and PR-babysitting stages — a required [dependency](./credits.md) that railyard installs,
updates, and never modifies.

railyard's own contribution sits around it: the routing that runs before CE starts, the Thermos
review gates, the delivery tail that owns the merge and post-merge proof, the audit trail, and the
cross-harness, cross-machine placement. Compound Engineering does the compounding; railyard routes
work into it and owns what happens after it returns. Credited, not competed with.

[ponytail](https://github.com/DietrichGebert/ponytail) from
[DietrichGebert](https://github.com/DietrichGebert) is the second required
[dependency](./credits.md) on the same footing — auto-installed under the one setup consent,
never modified. It keeps the code minimal; railyard carries the same efficiency reflex into its
process and verification loop.

## What only railyard combines

| Capability | Where it usually lives | In railyard |
| --- | --- | --- |
| Write the change | Agent CLIs | The core it rides on |
| Pick the right model per task | Router tools | Routed, frozen, and hook-enforced per dispatch |
| Plan / implement / review workflow | Compound Engineering | Driven as a credited substrate |
| Independent pre-commit review | PR bots (server-side) | Two Thermos lenses + optional Oracle, on the diff |
| Merge and prove it landed | — | Owned tail: merge + post-merge `merge-base` proof |
| Reconstruct how a run went | — | [audit](./skills/audit.md) over a durable run log |
| Same behavior on two harnesses | — | One routing brain across Claude Code and Codex |
| Place work across machines | Orchestrators | Optional [fleet](/roundhouse) amplifier |

Each row exists elsewhere and is done well elsewhere. The line railyard walks is owning all of them
as one path — from a plain-language ask to a merged change with a receipt — and it does that on the
machine you're already using. See [railyard on one machine](./single-machine.md) for that full
single-host surface, or the [delivery lifecycle](./lifecycle.md) for the whole path traced once,
end to end.
