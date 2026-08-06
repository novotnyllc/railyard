<!-- cross-repo links use site-absolute paths, resolved at site build -->
<!-- og-image: a terminal frame showing the prompt→merged flow — "Ship the retry fix for the webhook worker." on one line, then routed → planned → implemented → reviewed → PR → CI → merged → post-merge proof collapsing down the frame, ending on a green merge commit hash -->

# Say "go do X." Get back a merged, verified change — not a claim that it's done.

![Rail yard at golden hour — tracks converging into one main line](assets/hero.jpg)

railyard is a plugin for Claude Code and Codex that routes each piece of work to the right
model, the right machine, and the right workflow — then runs it through review, merge, and
proof that it landed.

## The problem it solves

Your agent says the fix is done. But is the branch actually merged? Which model burned tokens
on a one-line change? Which machine ran it, and is anything still running there? "Tests pass"
and "done" are not the same claim, and most setups can't tell you which one you're holding.

## What it looks like

One prompt, no skill name, no manual model choice. This is the condensed real shape of a
delivery, not a mockup:

```text
$ claude
> Ship the retry fix for the webhook worker.

railyard/model-routing/v1  →  Opus, high (implementation)
compound-engineering:lfg   →  plan → implement → simplify

Thermos gate (2 lenses, parallel)
  thermo-nuclear-review              0 findings outstanding
  thermo-nuclear-code-quality-review 0 findings outstanding

PR #482 opened → CI green → independent Sol High review: approved

$ gh pr merge 482 --squash
✓ merge commit 9f2a1c4 reachable from main
✓ post-merge check: retry_worker_test.rb — passed

Done: merged + proven. Not "CI is green."
```

That's the real shape of a delivery: routed, planned, implemented, reviewed, opened, settled,
merged, proven.

> **Pull-quote:** "railyard turns 'go build X' into a merged, verified change — routed to the
> right model, the right machine, the right workflow. Not a claim. A receipt."

## How it works

1. **Routes the work.** Before anything else runs, `model-routing` resolves an explicit model
   and effort for the unit of work about to be dispatched — routine steering, mechanical work,
   and implementation each get their own tier. A `PreToolUse` hook refuses any subagent dispatch
   that omits the model field, so routine work can't quietly inherit a premium session's tier.
2. **Picks the workflow.** `deliver` reads what you actually asked for against a fixed route
   table and stops at the right artifact — a plan-only request stops at the plan, a debug
   request stops at the findings, it doesn't fall through to code. A plain "implement/fix/ship
   X" is the implicit entry point; you never have to name a skill.
3. **Checks the machine.** For work that spans hosts, `orchestrate` verifies each destination's
   readiness through its sibling [roundhouse](/roundhouse) — repo state, tool versions,
   credentials — before placing anything there. An unreachable or unverified host gets no work.
   Native-Windows destinations are reached through a WSL-as-launcher lane.
4. **Proves it landed.** Before every commit, two review lenses run in parallel against the
   diff — correctness/security/breakage, and maintainability/structure — and every real finding
   gets fixed first. After merge, railyard confirms the merge commit is reachable from main and
   runs the smallest applicable post-merge check, and reports both as evidence, not a status
   message.

Freight doesn't move itself: the yard receives the work, sorts it to the right track, assembles
the train, clears the departure, and confirms arrival. That's the whole metaphor — it earns
exactly one line here.

### What's actually in the plugin

You don't invoke any of these by name for ordinary work — `deliver` and `orchestrate` are the
front doors, and everything below is what they call on your behalf.

| Track | Skills |
| --- | --- |
| Setup & health | `setup`, `doctor` |
| Routing | `model-routing` |
| Delivery | `deliver` |
| Orchestration & placement | `orchestrate` |
| Quality gates | `thermos`, plus its two review lenses, and `oracle` |
| Runtime hygiene | `cleanup-codex` |

## Install

```sh
claude plugin marketplace add novotnyllc/marketplace
claude plugin install railyard@novotnyllc
# then just say: "set up railyard"
# (setup installs Compound Engineering automatically — railyard's documented dependency)
```

Codex:

```sh
codex plugin marketplace add novotnyllc/marketplace
codex plugin add railyard --marketplace novotnyllc
```

Then talk to it. No skill names to remember:

```text
> Fix the flaky retry test in the billing service and get it merged.
```

## Why it's different

- **Done means merged and proven, not green CI.** Post-merge proof is
  `git merge-base --is-ancestor <merge-commit> origin/<base>` plus a real check, reported as
  evidence. An independent review pass is required before merge, not just the model that wrote
  the code checking its own work.
- **Explicit model and effort on every dispatch, enforced.** A `PreToolUse` hook refuses any
  subagent dispatch that skips the model field — no silent premium-tier burn, no convention
  anyone can forget to follow.
- **Fleet-aware placement, including Windows.** Work goes only to hosts confirmed ready, and a
  native-Windows destination is reached through a WSL-as-launcher lane — the process that runs
  is native Windows, never WSL standing in for proof of it.

Same behavior on both harnesses: one entry point, one routing brain, no skill names to learn
twice.

## Scope, honestly

railyard is a personal-scale operator tool — you run it inside your own Claude Code or Codex
session, not a hosted service. It's built on the external
[Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin) plugin as its
workflow engine, which railyard installs and updates but never modifies; watching a PR to merge
specifically needs that plugin at version 3.20.0 or newer, and setup fixes that for you rather
than working around it. Multi-machine delivery depends on roundhouse being enrolled and healthy;
without it, railyard just stays local rather than guessing at readiness it can't verify. It's
opt-in and operator-owned end to end: nothing runs unattended unless you explicitly schedule it
yourself, and no plugin here phones anything home. No user counts on this page — this is a tool
built for one operator's own fleet, not a platform with numbers to cite.

## Next

**[Install railyard](#install)** — two commands, then one sentence to say.

Or read more first: [the delivery lifecycle](/roundhouse/lifecycle) walks the whole
routed-to-merged path with diagrams, and the [deliver skill reference](./skills/deliver.md)
covers every route, gate, and what "done" means in full.

---

railyard ships adapted work from Peter Steinberger and Cursor, and runs on
Compound Engineering — see [credits and upstream sources](credits.md).
