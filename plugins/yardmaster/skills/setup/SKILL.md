---
name: setup
description: "Set up, extend, or diagnose the yardmaster delivery system: inventories what is installed, installs prerequisites (Compound Engineering, roundhouse, agent-utilities, gh-stack, tmux/jq) with consent, asks what the fleet hosts are and enrolls each through roundhouse:fleet-hosts, validates configuration, and reports readiness. For diagnosing an existing installation use yardmaster:doctor. Use when the user asks to set up, install, configure, onboard, or fix yardmaster or the delivery system, or when a required dependency turns out to be missing."
---

# Yardmaster Setup

Bring a host from bare to delivery-ready, grow the fleet, or diagnose why
something stopped working. Setup is idempotent: run it again any time and it
only proposes what is actually missing. A zero-fleet, zero-config outcome is
valid — the router's built-in defaults and local delivery work with nothing
configured — so never manufacture configuration the user does not want.

## 1. Inventory (read-only, no consent needed)

Collect the current state before asking anything:

- Installed plugins on each available harness: `claude plugin list` and
  `codex plugin list --json`. Note versions for `yardmaster`, `roundhouse`,
  `agent-utilities`, and `compound-engineering` (needs 3.20.0+ for
  `ce-babysit-pr`).
- Known marketplaces: `novotnyllc/marketplace` and
  `EveryInc/compound-engineering-plugin`.
- Fleet config: `ROUNDHOUSE_CONFIG`, else
  `${XDG_CONFIG_HOME:-$HOME/.config}/roundhouse/config.json`.
- Tooling: `gh` auth state, the `gh-stack` extension and its agent skills,
  `tmux`, `jq`, `node`, `chezmoi` (optional), `op` (optional, for the
  one-password toolbox skill).
- Optional extras already present: the Oracle Pro cache
  (`~/.config/yardmaster/oracle-pro.json`), a model-routing catalog
  (`~/.config/yardmaster/model-routing.json`).
- Credential presence for whatever the installed plugins actually need —
  check existence only, never read or print a value: `gh auth status` for
  GitHub; `ZAI_API_KEY` and `LITELLM_PROXY_API_KEY` when the Codex
  `zai_litellm` GLM provider is configured; `op` sign-in state when the
  one-password skill is installed; any other key an installed skill's own
  docs name. A missing key is reported with *where to set it* (shell
  environment via dotfiles, or 1Password injected through the one-password
  skill) — never ask the user to paste a secret into the conversation.

Summarize present/missing in one table before proposing anything.

## 2. Prerequisites (install on consent, grouped)

Ask once per group, not per command; on Claude Code use the question tool with
the recommended option first. Never install silently, never use sudo — user
package managers only.

- **Plugins and marketplaces** (required for delivery):

  ```bash
  claude plugin marketplace add novotnyllc/marketplace
  claude plugin install yardmaster@novotnyllc roundhouse@novotnyllc agent-utilities@novotnyllc
  claude plugin marketplace add EveryInc/compound-engineering-plugin
  claude plugin install compound-engineering@compound-engineering-plugin
  ```

  Codex mirrors: `codex plugin marketplace add …` then
  `codex plugin add <name> --marketplace <marketplace>`. Use `update` instead
  of `install` for anything present but stale. If Compound Engineering is
  below 3.20.0, updating it is required, not optional.
- **Stacked-PR tooling** (required for dependent-stack delivery):
  `gh extension install github/gh-stack --force` plus
  `gh skill install github/gh-stack --all --agent codex --scope user --force`
  and the `--agent claude-code` twin.
- **Shell tooling** (required for fleet transport and 1Password): `tmux` and
  `jq` via the user's package manager (`brew install tmux jq` on macOS).
- **macOS app testing** (optional; offer when the user builds macOS/iOS
  apps): `tart-xcode-runner@novotnyllc` runs Xcode builds and XCUITests in
  disposable Tart VMs so UI tests never seize the host display — plus the
  `tart` CLI (`brew install cirruslabs/cli/tart`) it depends on. Skipping
  disables nothing else; `deliver` will suggest it again the first time
  macOS app work would benefit.
- **CE's own setup**: if Compound Engineering was just installed, offer
  `compound-engineering:ce-setup` for its repository-level onboarding.

## 3. Configuration interview (defaults in brackets)

Only ask what the inventory shows unset; restate each answer before writing.

- **What are the hosts?** [this machine only] — ask for the list of machines
  that belong to the fleet: display name and SSH alias for each (aliases must
  already resolve in `~/.ssh/config`; never invent one). "Just this machine"
  is a complete answer — skip everything host-related. For each named host,
  delegate the entire add flow — config entry, reachability, SSH-certificate
  enrollment ceremony, target prerequisites, readiness — to
  `roundhouse:fleet-hosts`. Enrollment is in scope for setup, and its signing
  and privileged steps each get their own explicit consent naming the exact
  host; adding or removing machines later goes through the same skill.
- **Development root** [`~/dev`] — where project checkouts live.
- **Cross-host handoff project** [none] — the shared Git repo for
  checkpoint-based handoff, if any.
- **Codex remote-control host** [none] — only for a native-Windows
  destination driven by Codex Desktop; skipping disables nothing else.
- **Model-routing catalog** [none — built-in defaults] — the no-config
  profile (Sol orchestration/review, Luna implementation) is the recommended
  default; only write a catalog if the user has explicit routing policy.
- **Oracle** [skip] — if the user has ChatGPT Pro and wants Oracle reviews,
  record availability per the oracle skill's cached-detection rules.
- **Synced surface** [bootstrap from this host] — chezmoi is the single
  store: add `~/.claude/settings.json`, the roundhouse fleet config, and any
  yardmaster model-routing catalog to the chezmoi source, and generate a
  `desired.json.tmpl` there from this host's installed plugins, user-scope
  MCP servers, and standalone skills. Sync groups and per-machine
  differences are chezmoi template data (each machine declares its groups);
  `roundhouse:fleet-agents` "Desired-state sync" is the actuator that keeps
  every host's managers converged, bidirectionally by change time.
- **Auto-sync + update schedule** [none] — opt-in daily or weekly unattended
  maintenance:
  installs the OS-scheduler entry from `roundhouse:fleet-update`'s
  "Unattended schedule" section (which runs the desired-state sync and then
  package updates) (launchd agent on macOS, systemd user timer
  on Linux, per-user scheduled task on Windows) that runs the harness with
  the fixed unattended-maintenance prompt. Removable any time by deleting
  the scheduler entry.

Write the fleet config to
`${XDG_CONFIG_HOME:-$HOME/.config}/roundhouse/config.json` (0600), then
validate it with the roundhouse fleet CLI
(`"<roundhouse>/scripts/roundhouse" validate-config`). A validation
failure is fixed in the interview loop, never hand-waved.

## 4. Diagnosis

Diagnosing an existing installation — sync drift, broken hosts, "why isn't
X working" — is `yardmaster:doctor`'s job, not setup's. If the inventory in
step 1 surfaces breakage rather than absence, hand off to the doctor.

## 5. Boundaries

- Signing (`certify-ssh-node`) and privilege-broker enrollment always get
  their own explicit consent naming the exact host, even inside a larger
  setup flow.
- Never write credentials, tokens, or secrets into config.
- Never modify Compound Engineering. Setup mutates other machines only
  through the consented `roundhouse:fleet-hosts` flow.

## 6. Readiness report

Finish with one table: each prerequisite, host, and config item, its state
(installed/enrolled/configured/skipped-by-choice/missing), and the exact next
command for anything deferred. If everything required is green, say the host
is delivery-ready and name the entry points: plain "implement/fix/ship X"
routes through `yardmaster:deliver`; fleet or multi-task
objectives through `yardmaster:orchestrate`; growing or shrinking the
fleet through `roundhouse:fleet-hosts`.
