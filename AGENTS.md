# AGENTS.md

## Charter

Yardmaster is the delivery system for agent work — the yard boss that stands
between "go do X" and a verified, delivered result, on any machine in the
fleet. Like its rail namesake it never hauls freight itself: it classifies
inbound work, routes each cut of cars to the right track, couples the consist,
clears departures, and confirms arrival.

**Belongs here:** deciding and driving work —

- *Routing* — which model, effort, budget, and transport carry a unit of work
  (`model-routing` and its `yardmaster/model-routing/v1` contract).
- *Delivery* — driving one software change through the right workflow to
  merge and post-merge proof (`deliver`).
- *Orchestration and placement* — decomposing objectives across tasks,
  projects, hosts, and dependencies, and choosing where each child runs
  (`orchestrate`, including the Codex saved-project and Claude SSH
  worker lanes).
- *Quality gates and second opinions* — the pre-commit deep reviews
  (`thermos` and the two thermo-nuclear reviewers) and the Oracle one-shot
  advisor.
- *Runtime hygiene* — cleaning up after completed runs (`cleanup-codex`).

**Belongs elsewhere:** keeping machines and infrastructure serviceable —
readiness, inventory, parity, packages, dotfiles, auth, SSH transport and
enrollment, privileged installs, network gear — lives in
[`roundhouse`](https://github.com/novotnyllc/roundhouse); the orchestrator
consults `roundhouse:fleet-readiness` before dispatch and never administers
hosts itself. How to do a specific *kind* of work (craft skills) lives in
[`agent-utilities`](https://github.com/novotnyllc/agent-utilities). Compound
Engineering ([EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin))
is a required external dependency for delivery work — Goal Driven Delivery
routes through its workflows and never modifies them; the README carries the
install and update commands.

## Naming and theming

Docs may carry light rail flavor, but skill names and descriptions stay
functional — implicit discovery beats theme. A skill's description must let a
cold reader pick it correctly.

## Delivery Routing

When one of the workflow skills is active, its two-emoji task-title contract
overrides this repository's general thread-title convention unless the user
supplies an exact title or a higher-priority harness rule applies.

- Run the read-only `yardmaster:model-routing` intake on every software
  delivery turn. Explicit workflow and terminal instructions win. Configured
  fleet/account delivery enters `yardmaster:orchestrate`, even when it
  fast-paths one lane; explicit local/no-fleet or no-config single-host work
  enters `yardmaster:deliver` directly.
- Task Orchestrator owns decomposition, allocation, placement, concurrency,
  monitoring, synthesis, and evidence; it never executes child work. Each
  software-delivery child uses Goal Driven Delivery and consumes its immutable
  route, budget lease, checkpoint, and terminal policy.
- LFG owns plan through CI and review settlement. Goal Driven Delivery owns
  authorized merge and post-merge proof.
- `yardmaster/model-routing/v1` is the only operational model/effort, budget,
  and transport policy. Per-harness session defaults, the Codex-only GLM-5.2
  route, and cross-harness handoffs live in
  `plugins/yardmaster/references/harness-model-invocation.md`. Claude Code
  cannot invoke GLM-5.2.

## Release Coupling

When changing the plugin version, update:

- `plugins/yardmaster/.codex-plugin/plugin.json`
- `plugins/yardmaster/.claude-plugin/plugin.json`
- `<marketplace-repo>/.agents/plugins/marketplace.json`
- `<marketplace-repo>/.agents/plugins/plugin-versions.json`
- `<marketplace-repo>/.claude-plugin/marketplace.json`

Never treat an installed plugin cache as the source repository.

## Skill Editing Rules

- Keep skills usable by both Codex and Claude Code; the harness-surface
  tables in `orchestrate` and `deliver` are the pattern.
- Preserve upstream attribution when copying or refreshing skills; the
  thermos-family names track their upstream source and are not renamed.
- Validate JSON manifests and skill frontmatter before committing.
