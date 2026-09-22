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
- *Targeted reviews and second opinions* — optional pre-commit deep reviews
  (`thermos` and the two thermo-nuclear reviewers) and the Oracle one-shot
  advisor.
- *Runtime hygiene* — diagnosing and cleaning up observed residue on request
  (`cleanup-codex`), with automatic cleanup off by default.
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

Compound Engineering
([EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin))
provides selected planning, debugging, publishing, and review workflows.
Railyard selects the appropriate stage automatically and leaves review
settlement and CI monitoring with CE. Native routine work needs no workflow
plugin bootstrap. Installing Railyard does not authorize installing unrelated
plugins or enabling every available hook.

Roundhouse is needed for explicitly selected fleet/account work; craft skills
and stacked-PR tooling are loaded only when relevant. Setup uses each host's
plugin manager and preserves explicit disabled states.
