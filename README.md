# Yardmaster

The delivery system for agent work. A yardmaster never drives the trains —
they decide what moves, on which track, when, and confirm it arrived.

This plugin (for Codex and Claude Code) owns the span between "go do X" and a
verified, delivered result, on any machine in the fleet:

| Track | Skills |
| --- | --- |
| Routing | `model-routing` — one model/effort/budget/transport decision per unit of work, via the `yardmaster/model-routing/v1` contract |
| Delivery | `goal-driven-delivery` — one change through the right workflow to merge and post-merge proof |
| Orchestration & placement | `task-orchestrator` — objectives across tasks, projects, hosts, and dependencies, with the Codex saved-project and Claude SSH worker lanes |
| Quality gates | `thermos`, `thermo-nuclear-review`, `thermo-nuclear-code-quality-review`, `oracle` |
| Runtime hygiene | `cleanup-codex` |

Before dispatching to another machine, the orchestrator consults
[`roundhouse`](https://github.com/novotnyllc/roundhouse) — machine and
infrastructure administration (readiness, inventory, parity, packages,
dotfiles, auth, SSH transport, privileged installs). Craft skills live in
[`agent-utilities`](https://github.com/novotnyllc/agent-utilities). See
[AGENTS.md](AGENTS.md) for the full charter and the
belongs-here/belongs-elsewhere rules.

Portions adapted from `steipete/agent-scripts` and `steipete/oracle` (MIT);
attribution preserved in the affected skills.
