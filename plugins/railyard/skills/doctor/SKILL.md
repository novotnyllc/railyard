---
name: doctor
description: "Diagnose and repair the Railyard delivery setup: plugin and skill versions across harnesses and fleet hosts, marketplace freshness, hook trust, fleet config, host reachability and enrollment, desired-state sync, and leftover test processes. Use when the user asks for doctor, a Railyard health check, or whether plugins, skills, or hosts are in sync. Not for bugs in the user's own code."
---

# Railyard Doctor

Diagnose first, then apply fixes the task already authorizes. Start with the
reported failure and affected host, and widen only when evidence requires it.
Fix through the owning manager or skill and re-check the affected behavior. A
healthy requested surface gets a short answer, not a fleet-wide sweep; an
existing fleet configuration alone does not authorize cross-host work.

## Checks

Run the checks relevant to the reported failure or requested health scope.
Report every row with one state:

- **pass**: checked and healthy.
- **warn**: drift or leftovers that work today; give a one-line fix.
- **fail**: broken or missing; give a one-line fix.
- **unknown (cause)**: a probe errors, is blocked, or returns nothing where
  output is expected. Name the observed cause (missing CLI, unreadable config,
  command error); write `unknown (sandboxed)` only when `CODEX_SANDBOX` is set
  and the probe was blocked. Report only that row as unknown; rows whose
  read-only probes succeeded keep their real result. Never guess pass or fail.
- **skipped**: out of scope, with the reason.

Run probes with stdin from `/dev/null`. Print names and versions only. Read
config through the specific keys named here, never by printing whole files:
`settings.json` and `config.toml` can hold secrets.

**Plugins and marketplaces** (this host, both harnesses)

- Marketplace registration. Claude declares marketplaces with
  `jq -r '.extraKnownMarketplaces // {} | keys[]'
  "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"`; compare with
  `claude plugin marketplace list --json` (`.[].name`). Codex declares them as
  table headers, read as bare names with `grep -oE '^\[marketplaces\.[^]]+\]'
  "${CODEX_HOME:-$HOME/.codex}/config.toml" | sed -E 's/^\[marketplaces\.//; s/\]$//'`; compare with
  `codex plugin marketplace list --json` (`.marketplaces[].name`). A declared
  name missing from its harness's list fails; fix with
  `claude plugin marketplace add <source>` or
  `codex plugin marketplace add <source>`. A marketplace declared for only one
  harness is not a fault.
- Plugin versions, for `railyard`, `roundhouse`, `agent-utilities`, and
  Compound Engineering when selected:
  - Installed: `claude plugin list --json` (`.[] | {id, version}`, with
    `id` as `name@marketplace`) and `codex plugin list --json`
    (`.installed[] | {name, marketplaceName, version}`).
  - Catalog: each marketplace clone. Claude:
    `<installLocation>/.claude-plugin/marketplace.json`, from the Claude
    marketplace list. Codex: `<root>/.agents/plugins/plugin-versions.json`,
    from `.marketplaces[].root`. Where an entry's `version` is null or the
    file is absent, read the plugin manifest at its source path in the clone.
  - A Claude/Codex mismatch, or an install behind the newest catalog, warns.
    A catalog behind the other harness's is itself the finding. Claude fix:
    `claude plugin marketplace update <marketplace>`, then
    `claude plugin update <name>@<marketplace>`. Codex fix:
    `codex plugin marketplace upgrade <marketplace>`, then
    `codex plugin add <name>@<marketplace>`. Deliberate pins and staged
    upgrades are not faults.
- Compound Engineering: the selected skills are exposed, including
  `ce-babysit-pr` when watching a PR.
- Codex hook trust: current hashes for intentionally enabled hooks. Disabled
  optional hooks are healthy; never approve every hook as a generic repair.
  Before activating a selected merge guard, test the installed
  startup/dispatch path and the CE snapshot handoff.

**Fleet parity** (only when requested)

Delegate the cross-host comparison to `roundhouse:fleet-agents` (inventory
mode) and fold in its drift report rather than repeating it. If
`roundhouse --help` lists a plugin probe (such as `probe --plugins`), use that
as the fleet-wide form of the version check instead.

**Process leftovers**

- cleanup-codex canary listeners, left behind by an interrupted canary test:
  `pgrep -fl '[c]leanup-codex-canary\.' </dev/null`. Skip the row while a
  canary test is running (`pgrep -f '[c]anary\.test\.mjs'`), and count a
  listener as leaked only when it is older than 10 minutes
  (`ps -o etime= -p <pid>`, which prints `[[dd-]hh:]mm:ss` on macOS and
  Linux; older when it has an hours or days field or 10 or more minutes). Exit 1 passes, leaked listeners warn, and any
  other exit is unknown. Fix by stopping each leaked PID and removing its
  `cleanup-codex-canary.*` temporary directory.

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

Report one table: check, state (as defined under Checks), and for each
non-pass row the minimal fix and its owner:

- a declared marketplace missing from its harness → `railyard:setup`;
- plugin/skill drift or a stale catalog → `roundhouse:fleet-agents` refresh
  (locally, the marketplace and plugin commands above);
- leaked canary listeners → `railyard:cleanup-codex`;
- sshd faults → `roundhouse:ssh-doctor`;
- enrollment or host prerequisites → `roundhouse:fleet-hosts`;
- package baseline (tmux/jq) → `roundhouse:fleet-update`;
- desired-state sync findings → `roundhouse:fleet-agents`; a missing or
  duplicated scheduler entry → `roundhouse:fleet-update` "Unattended schedule";
- missing prerequisites or first-run gaps → `railyard:setup`.

Apply authorized fixes and re-run the affected checks. If more authority is
needed, prepare the exact operation before asking. Leave unrelated state
alone, and change enrolled or privileged state only through its owning skill.
