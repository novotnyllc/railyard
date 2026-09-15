---
name: doctor
description: "Diagnose and fix the delivery system: plugin and skill version sync across harnesses and fleet hosts, marketplace freshness, fleet config validity, host reachability and enrollment state, executor integrity, and Compound Engineering compatibility. Use when the user says doctor, diagnose, health check, \"why isn't X working\", or asks whether plugins/skills/hosts are in sync or up to date."
---

# Railyard Doctor

Diagnose first, then apply fixes already authorized by the task. Start with the
reported failure and affected host; expand only when evidence requires it. Use
the owning manager or skill for each fix and verify the affected behavior. A
healthy requested surface produces a short result, not a fleet-wide sweep.

## Diagnostic sweep

Run checks relevant to the reported failure or requested health scope. An
existing fleet configuration alone does not authorize cross-host work.

**Sync and versions**

- Harness parity on this host: `claude plugin list` vs
  `codex plugin list --json` — the same plugin at different versions across
  harnesses is a finding.
- Marketplace freshness: installed versions vs the current catalogs
  (`novotnyllc`, `compound-engineering-plugin`, when selected); a stale
  marketplace snapshot is itself a finding.
- Compound Engineering: required selected skills exposed, including
  `ce-babysit-pr` when watching a PR. No unrelated behavior plugin is required.
- Codex hook trust: verify current hashes for intentionally enabled hooks.
  Disabled optional hooks are healthy. Preserve user choices; never approve
  every hook as a generic repair. Test the installed startup/dispatch path
  and CE snapshot handoff for a selected merge guard before activation.
- Fleet-wide parity: only when requested, delegate the cross-host
  skill/plugin/runtime comparison to `roundhouse:fleet-agents` (inventory
  mode) and fold its drift report into the findings.

**Configuration and state**

- Fleet config: present, `validate-config` passes, no orphaned hosts
  (config entries whose SSH alias no longer resolves).
- Retired plugins still installed (machine-utilities); orphaned config/state
  dirs from retired names (`~/.config/machine-utilities/`,
  `~/.config/agent-utilities/`, `~/.local/state/agent-utilities/`) — offer
  deletion, nothing reads them.
- The unattended auto-update schedule, when installed: scheduler entry
  present and its log free of repeated failures.
- Router state: `railyard:model-routing` `status` succeeds; a configured
  catalog, if any, validates.
- Credential presence for installed capabilities — existence only, never
  values: `gh auth status`; `ZAI_API_KEY`/`LITELLM_PROXY_API_KEY` when the
  Codex `zai_litellm` provider is configured (plus the proxy actually
  responding on its port); `op` sign-in when one-password is installed; any
  key an installed skill's docs name. Missing → report where to set it
  (dotfiles env or 1Password via the one-password skill); never solicit a
  secret in chat.

**Hosts** (per configured host, when a fleet exists)

- Reachability through the login shell (`ssh -o BatchMode=yes`).
- Certificate enrollment state (`enroll-ssh-posix status`/`verify`).
- Installed executor verification and version vs this controller.
- `roundhouse:fleet-readiness` go/no-go; for Windows machines declaring
  `wsl_interop_via`, verify the interop lane answers (`cd /mnt/c` then
  full-path `cmd.exe /c` runs a native command from the WSL side), the
  named WSL entry exists, and paired entries agree on `physical_host`.
  If the interop launch fails while SSH is healthy, check
  `/proc/sys/fs/binfmt_misc/WSLInterop` on the WSL side to split
  "interop disabled" from "target missing".

**Desired-state sync** (per host enrolled in the fleet store — one with a
`hosts/<name>.yaml` entry; skip entirely and say so when the store was never
stood up)

Resolve `CLI` to the installed roundhouse plugin's `scripts/roundhouse`.
Run `"$CLI" fleet-doctor` and evaluate the checks under
`roundhouse:fleet-agents`' Desired-state sync section (its `### Health`
rollup plus `fleet-doctor`'s own rows). That is the roundhouse-side contract:
consume it, never keep a second copy of it here. Report every check by name
with its evidence — **CLI-reported** rows name the `fleet-doctor` row they
came from, **agent-computed** rows name what they were derived from.

- Store reachable and replicating (`fleet-run` performs the fetch;
  `fleet-doctor` reports).
- Commit signatures verifying against the host-local allowed-signers file
  (`fleet-doctor`'s `head-signature` and `ratchet-replay` rows; every gated
  command refuses on a failed verification).
- Last successful run within 2× that host's cadence — agent-computed from
  each host's journal. An interactive-session-only Windows entry's
  staleness is *expected* and is reported as such, by name — never a silent
  pass, never a broken row.
- No enabled-but-untrusted hook (`fleet-doctor`'s `hooks` row, which reports
  `enabled_but_untrusted`).
- No conflict commit older than 24 hours (`fleet-doctor`'s `conflicts` row;
  date the reported commit ids from store history).
- No held flagged item forgotten (`"$CLI" fleet-pending`, which reports
  fleet-wide pending items, not just this host's).
- Scheduler entry singular and alive (agent-computed from the host). Two
  entries is a finding on its own — that is the racing-runners failure the
  single owned entry exists to prevent.
- Run-lock not stale: a lock older than twice the configured cadence is a
  stale-lock refusal, not a live runner. The fix is `"$CLI" fleet-unlock`,
  and only after confirming no runner is actually live on that host — check
  the scheduler entry and any running process first.
- Untracked-file and raw-git-push tripwires and `store-symlinks` clean
  (`fleet-doctor`'s `host-local-leak`, `raw-git-push`, and `store-symlinks`
  rows).
- Co-ownership sanity for any detected second sync engine, and store size
  within budget (agent-computed).

## Findings and fixes

Report one table: check, state (ok / drift / broken / skipped-with-reason),
and for every non-ok row the minimal fix and its owner:

- plugin/skill drift → `roundhouse:fleet-agents` routine refresh (local:
  the direct `plugin update` commands);
- sshd faults → `roundhouse:ssh-doctor`;
- enrollment or host prerequisites → `roundhouse:fleet-hosts`;
- package baseline (tmux/jq) → `roundhouse:fleet-update`;
- desired-state sync findings (held items, conflicts, stale locks, drift) →
  `roundhouse:fleet-agents`' desired-state sync; a missing or duplicated
  scheduler entry → `railyard:setup` §3a;
- missing prerequisites or first-run gaps → `railyard:setup`.

Apply authorized fixes and re-run affected checks afterward. If additional
authority is necessary, prepare the exact operation before asking. Never
mutate unrelated state, and handle enrolled/privileged state through its
owning skill within the user's authorized scope.
