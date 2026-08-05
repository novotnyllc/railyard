<img src="docs/assets/railyard.png" alt="Railyard" width="140" align="right"/>

# Railyard

**Say "go do X." Get back a merged, verified change — not a claim that it's
done.**

Railyard is a delivery system for AI agent work, for both Codex and Claude
Code. You talk in plain language; it picks the workflow, the model, the
budget, and the machine, then drives the change through implementation, deep
review, merge, and post-merge proof.

- 🚦 **One entry point.** "Implement…", "fix…", "ship…" — no skill names to
  remember, same behavior on either harness.
- 🧠 **One routing brain.** Every unit of work gets a recorded model, effort,
  and budget decision from a single router — no per-session improvisation.
- 🔍 **Quality by default.** Adversarial review gates, CI settlement, and
  post-merge verification are part of the route. "Green CI" isn't done —
  the merge commit reachable from main with a passing post-merge check is.
- 🖥️ **Fleet-scale.** Orchestrates across machines, and only dispatches to
  hosts its sibling [roundhouse](https://github.com/novotnyllc/roundhouse)
  has verified are ready.

```sh
claude plugin marketplace add novotnyllc/marketplace
claude plugin install railyard@novotnyllc
# then just say: "set up railyard"
```

(Codex: `codex plugin marketplace add novotnyllc/marketplace` and
`codex plugin add railyard --marketplace novotnyllc`.)

**Read the [user guide](docs/guide.md)** — what it can do, how it works, and
what a delivery actually looks like, with diagrams.

## What's inside

Freight doesn't move itself — the yard receives it, sorts it, assembles the
train, clears the departure, and confirms arrival:

| Track | Skills |
| --- | --- |
| Setup & health | `setup` — onboarding, prerequisites on consent, host enrollment; `doctor` — diagnose and fix drift |
| Routing | `model-routing` — one model/effort/budget/transport decision per unit of work (`railyard/model-routing/v1`) |
| Delivery | `deliver` — one change through the right workflow to merge and post-merge proof |
| Orchestration & placement | `orchestrate` — objectives across tasks, projects, hosts; Codex saved-project and Claude SSH worker lanes |
| Quality gates | `thermos`, `thermo-nuclear-review`, `thermo-nuclear-code-quality-review`, `oracle` |
| Runtime hygiene | `cleanup-codex` |

## Built on Compound Engineering

Delivery routes through the external
[Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)
plugin (`lfg`, the `ce-*` skills, `ce-babysit-pr` 3.20.0+) and never modifies
it. `railyard:setup` installs and updates it for you; by hand:

```sh
claude plugin marketplace add EveryInc/compound-engineering-plugin
claude plugin install compound-engineering@compound-engineering-plugin
```

## The family

Machine and infrastructure administration lives in
[`roundhouse`](https://github.com/novotnyllc/roundhouse); craft skills in
[`agent-utilities`](https://github.com/novotnyllc/agent-utilities). Charter
and boundaries: [AGENTS.md](AGENTS.md).

Portions adapted from `steipete/agent-scripts` and `steipete/oracle` (MIT);
attribution preserved in the affected skills.
