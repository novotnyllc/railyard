# Charter and boundaries

Railyard is the delivery system for agent work — the yard where "go do X"
becomes a verified, delivered result, on any machine in the fleet.

## Belongs here

Deciding and driving work —

- *Delivery* — driving one software change through the right workflow to
  merge and post-merge proof (`deliver`).
- *Orchestration and placement* — decomposing objectives across tasks,
  projects, hosts, and dependencies, and choosing where each child runs
  (`orchestrate`, including the Codex saved-project and Claude SSH
  worker lanes).
- *Targeted reviews* — optional deep reviews (`thermos` and the two
  thermo-nuclear reviewers).

## Belongs elsewhere

Keeping machines and infrastructure serviceable — readiness, inventory,
parity, packages, dotfiles, auth, SSH transport and enrollment, privileged
installs, network gear — lives in
the [public fleet docs](https://novotnyllc.github.io/railyard/fleet/); the orchestrator
consults `roundhouse:fleet-readiness` before dispatch and never administers
hosts itself.

Oracle consultations and macOS Codex process recovery live in
[Agent Utilities](https://github.com/novotnyllc/agent-utilities).

## External dependencies

Compound Engineering
([EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin))
provides planning, debugging, external implementation, publishing, and review
workflows. CE owns implementation engine selection, review settlement, and CI
monitoring. Routine work uses the harness's native tools. Installing Railyard
does not authorize installing unrelated plugins or enabling every available
hook.

Roundhouse verifies authorized fleet placement. Craft skills
and stacked-PR tooling are loaded only when relevant. Setup uses each host's
plugin manager and preserves explicit disabled states.
