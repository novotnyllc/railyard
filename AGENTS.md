# AGENTS.md

## Charter

Railyard is the delivery system for agent work — the yard where "go do X"
becomes a verified, delivered result, on any machine in the fleet. Like its
namesake it never hauls the freight itself: inbound work is received and
classified, routed to the right track, assembled into trains, cleared for
departure, and confirmed arrived.

**Belongs here:** deciding and driving work —

- *Routing* — which model, effort, budget, and transport carry a unit of work
  (`model-routing` and its `railyard/model-routing/v1` contract).
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

- Run the read-only `railyard:model-routing` intake on every software
  delivery turn. Explicit workflow and terminal instructions win. Configured
  fleet/account delivery enters `railyard:orchestrate`, even when it
  fast-paths one lane; explicit local/no-fleet or no-config single-host work
  enters `railyard:deliver` directly.
- Task Orchestrator owns decomposition, allocation, placement, concurrency,
  monitoring, synthesis, and evidence; it never executes child work. Each
  software-delivery child uses Goal Driven Delivery and consumes its immutable
  route, budget lease, checkpoint, and terminal policy.
- LFG owns plan through CI and review settlement. Goal Driven Delivery owns
  authorized merge and post-merge proof.
- `railyard/model-routing/v1` is the only operational model/effort, budget,
  and transport policy. Per-harness session defaults, the Codex-only GLM-5.2
  route, and cross-harness handoffs live in
  `plugins/railyard/references/harness-model-invocation.md`. Claude Code
  cannot invoke GLM-5.2.

## Release Coupling

When changing the plugin version, update:

- `plugins/railyard/.codex-plugin/plugin.json`
- `plugins/railyard/.claude-plugin/plugin.json`
- `<marketplace-repo>/.agents/plugins/marketplace.json`
- `<marketplace-repo>/.agents/plugins/plugin-versions.json`
- `<marketplace-repo>/.claude-plugin/marketplace.json`

Never treat an installed plugin cache as the source repository.

Documentation-only changes (`docs/**`, `README.md`, `UPSTREAM.md`) need no
version bump, no marketplace repin, and no fleet redeploy/convergence pass
— commit and push them directly. Only changes under `plugins/` couple to
the release machinery above.

## Skill Editing Rules

- Keep skills usable by both Codex and Claude Code; the harness-surface
  tables in `orchestrate` and `deliver` are the pattern.
- Preserve upstream attribution when copying or refreshing skills; the
  thermos-family names track their upstream source and are not renamed.
- Validate JSON manifests and skill frontmatter before committing.
