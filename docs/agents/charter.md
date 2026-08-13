# Charter and boundaries

Railyard is the delivery system for agent work — the yard where "go do X"
becomes a verified, delivered result, on any machine in the fleet.

## Belongs here

Deciding and driving work —

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
- *Audit and retrospective* — reconstructing how a run went from the
  mechanical run log (`audit`).

## Belongs elsewhere

Keeping machines and infrastructure serviceable — readiness, inventory,
parity, packages, dotfiles, auth, SSH transport and enrollment, privileged
installs, network gear — lives in
the [public fleet docs](https://novotnyllc.github.io/railyard/fleet/); the orchestrator
consults `roundhouse:fleet-readiness` before dispatch and never administers
hosts itself.

## External dependencies

Two required external plugins, both auto-installed by railyard and never
modified:

- Compound Engineering
  ([EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin))
  — the delivery workflow engine; Goal Driven Delivery routes through its
  workflows.
- ponytail
  ([DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)) — the
  efficiency discipline railyard carries into both the code and the process and
  verification loop.

Installing railyard authorizes and installs both as one group. The README
carries the install and update commands.
