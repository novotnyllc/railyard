# Yardmaster

The delivery system for agent work. A yardmaster never drives the trains —
they decide what moves, on which track, when, and confirm it arrived.

This plugin (for Codex and Claude Code) owns the span between "go do X" and a
verified, delivered result, on any machine in the fleet:

| Track | Skills |
| --- | --- |
| Setup | `setup` — first-run onboarding, prerequisite installs on consent, host enrollment via roundhouse, and a doctor mode for diagnosis |
| Routing | `model-routing` — one model/effort/budget/transport decision per unit of work, via the `yardmaster/model-routing/v1` contract |
| Delivery | `goal-driven-delivery` — one change through the right workflow to merge and post-merge proof |
| Orchestration & placement | `task-orchestrator` — objectives across tasks, projects, hosts, and dependencies, with the Codex saved-project and Claude SSH worker lanes |
| Quality gates | `thermos`, `thermo-nuclear-review`, `thermo-nuclear-code-quality-review`, `oracle` |
| Runtime hygiene | `cleanup-codex` |

## Built on Compound Engineering

Yardmaster's delivery workflows are built on the external
[Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)
plugin — `goal-driven-delivery` routes through `lfg`, the `ce-*` skills, and
`ce-babysit-pr` (3.20.0+), and never modifies them. It is a required
dependency for delivery work. Install and update it alongside yardmaster:

```sh
# Claude Code
claude plugin marketplace add EveryInc/compound-engineering-plugin
claude plugin install compound-engineering@compound-engineering-plugin
claude plugin update compound-engineering@compound-engineering-plugin

# Codex
codex plugin marketplace add EveryInc/compound-engineering-plugin
codex plugin add compound-engineering --marketplace compound-engineering-plugin
```

Before dispatching to another machine, the orchestrator consults
[`roundhouse`](https://github.com/novotnyllc/roundhouse) — machine and
infrastructure administration (readiness, inventory, parity, packages,
dotfiles, auth, SSH transport, privileged installs). Craft skills live in
[`agent-utilities`](https://github.com/novotnyllc/agent-utilities). See
[AGENTS.md](AGENTS.md) for the full charter and the
belongs-here/belongs-elsewhere rules.

Portions adapted from `steipete/agent-scripts` and `steipete/oracle` (MIT);
attribution preserved in the affected skills.
