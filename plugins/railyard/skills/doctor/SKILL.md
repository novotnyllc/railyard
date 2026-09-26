---
name: doctor
description: "Diagnose and repair the Railyard delivery setup: plugin and skill versions across harnesses and fleet hosts, marketplace freshness, hook trust, fleet config, host reachability and enrollment, and desired-state sync. Use when the user asks for doctor, a Railyard health check, or whether plugins, skills, or hosts are in sync. Not for bugs in the user's own code."
---

# Railyard Doctor

Diagnose first, then apply fixes the task already authorizes. Start with the
reported failure and affected host, and widen only when evidence requires it.
Fix through the owning manager or skill and re-check the affected behavior. A
healthy requested surface gets a short answer, not a fleet-wide sweep; an
existing fleet configuration alone does not authorize cross-host work.

## Checks

Run the checks relevant to the reported failure or requested health scope.

**Versions and dependencies**

- Harness parity on this host, when both harnesses are in scope:
  `claude plugin list` vs `codex plugin list --json`. Compare with the user's
  intended state; deliberate pins and staged upgrades are not faults.
- Marketplace freshness: installed versions vs the current catalogs
  (`novotnyllc`, and `compound-engineering-plugin` when selected).
  Distinguish an outdated catalog from an intentional pin.
- Compound Engineering: the selected skills are exposed, including
  `ce-babysit-pr` when watching a PR.
- Codex hook trust: current hashes for intentionally enabled hooks. Disabled
  optional hooks are healthy; never approve every hook as a generic repair.
  Before activating a selected merge guard, test the installed
  startup/dispatch path and the CE snapshot handoff.
- Fleet-wide parity, only when requested: delegate the cross-host comparison
  to `roundhouse:fleet-agents` (inventory mode) and fold in its drift report.

**Configuration and state**

- Fleet config, when in scope: resolve `ROUNDHOUSE_CONFIG`, else
  `${XDG_CONFIG_HOME:-$HOME/.config}/roundhouse/config.json`, and run
  `validate-config` under the same environment. No config is valid for
  local-only use. Check SSH aliases for affected hosts.
- Suspected retired plugins or orphaned config/state: establish ownership and
  current consumers through the managers, references, and running
  capabilities before proposing removal; a legacy name is not evidence of
  disuse. Preserve anything unresolved, and remove only within authorized
  cleanup scope.
- An installed update schedule: the scheduler entry exists and its log is free
  of repeated failures.
- Credential presence for capabilities relevant to the diagnosis, existence
  only: `gh auth status`, `op` sign-in when one-password is installed, and any
  key an installed skill's docs name. Report where to set a missing one
  (dotfiles env or 1Password); never read or print a value or ask for a secret
  in chat.

**Hosts** (affected hosts only)

Use `roundhouse:fleet-readiness` for the go/no-go (including the WSL interop
lane), `roundhouse:fleet-inventory` for executor staleness, and
`roundhouse:ssh-doctor` or `roundhouse:fleet-hosts` for reachability and
certificate enrollment. If a Windows interop launch fails while SSH is
healthy, check `/proc/sys/fs/binfmt_misc/WSLInterop` on the WSL side to
separate "interop disabled" from "target missing".

**Desired-state sync** (only when sync is part of the failure or requested
scope, for hosts with a `hosts/<name>.yaml`; skip if the store was never set up)

Run the installed Roundhouse CLI's `fleet-doctor` and `fleet-pending`, and
evaluate them per `roundhouse:fleet-agents` "Desired-state sync". Report each
relevant `fleet-doctor` row by name with its evidence. `fleet-pending` lists
fleet-wide items; filter to the selected scope and do not treat other hosts'
rows as authority to fix them. Add these agent-computed checks, which the CLI
does not report:

- Last successful run within twice the host's cadence, from its journal. A
  Windows interactive-session-only entry that is stale while logged off is
  expected; report it by name as such.
- Exactly one scheduler entry on the host; two is a finding (racing runners).
- Before `fleet-unlock` on a stale run-lock, confirm no runner is live by
  checking the scheduler entry and running processes.
- Co-ownership with any detected second sync engine, and store size within
  budget.

## Findings and fixes

Report one table: check, state (ok / drift / broken / skipped with reason),
and for each non-ok row the minimal fix and its owner:

- plugin/skill drift → `roundhouse:fleet-agents` refresh (locally, the direct
  `plugin update` commands);
- sshd faults → `roundhouse:ssh-doctor`;
- enrollment or host prerequisites → `roundhouse:fleet-hosts`;
- package baseline (tmux/jq) → `roundhouse:fleet-update`;
- desired-state sync findings → `roundhouse:fleet-agents`; a missing or
  duplicated scheduler entry → `roundhouse:fleet-update` "Unattended schedule";
- missing prerequisites or first-run gaps → `railyard:setup`.

Apply authorized fixes and re-run the affected checks. If more authority is
needed, prepare the exact operation before asking. Leave unrelated state
alone, and change enrolled or privileged state only through its owning skill.
