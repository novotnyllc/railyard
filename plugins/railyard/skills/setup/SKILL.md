---
name: setup
description: "Set up Railyard on the requested host: inventory installed state, configure deliberate model and effort selection, and validate only the selected workflow dependencies and hooks. Use for installation, configuration, or onboarding; use doctor for an existing failure. Fleet enrollment is optional and explicit."
---

# Railyard Setup

Bring a host from bare to delivery-ready or enroll explicitly selected fleet
hosts. Diagnose an existing failure with `railyard:doctor`. Setup is idempotent:
run it again any time and it only proposes what is actually missing.
A zero-fleet, zero-config outcome is
valid — the router's built-in defaults and local delivery work with nothing
configured — so never manufacture configuration the user does not want.

## 1. Inventory (read-only, no consent needed)

Collect the current state before asking anything:

- Installed plugins on each available harness: `claude plugin list` and
  `codex plugin list --json`. Note versions for `railyard`, `roundhouse`,
  `agent-utilities`, and `compound-engineering` when their workflows are selected.
- Known marketplaces: `novotnyllc/marketplace`,
  `EveryInc/compound-engineering-plugin`, when relevant.
- Fleet config, when fleet setup is selected: resolve `ROUNDHOUSE_CONFIG`, else
  `${XDG_CONFIG_HOME:-$HOME/.config}/roundhouse/config.json`. Keep this resolved
  path for all reads, writes, and validation in this setup.
- Tooling: `gh` auth state, the `gh-stack` extension and its agent skills,
  `tmux`, `jq`, `node`, `chezmoi` (optional), `op` (optional, for the
  one-password toolbox skill).
- Optional extras already present: the Oracle Pro cache
  (`~/.config/railyard/oracle-pro.json`), a model-routing catalog
  (`~/.config/railyard/model-routing.json`).
- Credential presence for whatever the installed plugins actually need —
  check existence only, never read or print a value: `gh auth status` for
  GitHub; `op` sign-in state when the
  one-password skill is installed; any other key an installed skill's own
  docs name. A missing key is reported with *where to set it* (shell
  environment via dotfiles, or 1Password injected through the one-password
  skill) — never ask the user to paste a secret into the conversation.

Summarize present/missing in one table before proposing anything.

## 2. Install only selected dependencies

Railyard's hooks and scripts need Node; native routine work has no Railyard
installation prerequisite. Use the installed harness manager for the requested
plugin, and inspect its current help before executing commands. Preserve disabled
plugins and hooks. Never modify installed cache files or treat cache presence
as proof that a plugin is installed and enabled.

- **Compound Engineering** supplies selected planning, debugging, commit/PR,
  and PR-watch workflows. Check the required skill is exposed when that stage
  is selected. Use `compound-engineering:ce-commit-push-pr` for commit/push/PR
  work and `ce-babysit-pr` as the one review-settlement and CI owner. A missing
  selected dependency is reported with the manager operation needed to fix it.
- **Roundhouse and craft skills** are needed only for explicit fleet/account
  orchestration or the relevant domain. Their mere presence does not enroll a
  host, run fleet sync, or route local work across machines.
- **Stacked PRs** use `gh-stack` for genuinely dependent PRs when requested or
  required by repository policy. A single logical change remains one PR.
- **Shell and platform tools** are installed only for the selected operation;
  Xcode/Tart, 1Password, tmux, and fleet YAML tooling are not universal delivery
  prerequisites.

Existing task authorization covers necessary setup work. Ask only for missing
scope or genuinely new authority, after preparing the concrete operation. Do
not infer blanket installation consent from installing Railyard.

After a Codex update, verify the installed plugin version and source bytes,
then inspect its current hook commands and hashes. Enable/trust only the
validated SessionStart routing charter and native dispatch gate; include the
shell dispatch gate when `codex exec` remains a used route and the CE merge
guard when PR delivery is selected. Validate its
[snapshot handoff](../deliver/references/ce-merge-guard.md) before activation.
Broad prompt nudges and automatic retrospective hooks are retired. Process
cleanup remains manual. Preserve existing disabled states unless the user
authorized activation; a plugin update alone does not enable hooks.

## 3. Configuration interview (defaults in brackets)

Use existing instructions and configuration first. Ask only about an unset
choice needed for the requested setup; local-only setup skips fleet questions.

- **What are the hosts?** [this machine only] — ask for the list of machines
  that belong to the fleet: display name and SSH alias for each (aliases must
  already resolve in `~/.ssh/config`; never invent one). "Just this machine"
  is a complete answer — skip everything host-related. Capture WSL/Windows
  pairs on shared hardware (`physical_host` + `wsl_interop_via`) so the
  interop maintenance lane works from day one. For each named host,
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
  profile considers GPT-6 Sol at medium effort first for ordinary Codex work.
  Choose model and effort together; explicit inheritance is supported when justified.
  Verify the active catalog and adapter before dispatch. Raise effort or select
  Astra for a specific need rather than by default. Preserve user overrides when migrating
  existing catalogs; do not replace unrelated providers, accounts, or budgets.
- **Oracle** [skip] — if the user has ChatGPT Pro and wants Oracle reviews,
  record availability per the oracle skill's cached-detection rules.
- **Fleet sync** [skip] — discuss only for requested fleet setup or sync;
  skip this question in local-only setup and never default it on.
  Roundhouse's opt-in desired-state sync keeps the
  user-scope agent surface — plugins with their enabled state, standalone
  skills, agents, hooks, MCP servers, and allowlisted harness config keys —
  consistent across every machine and harness, with groups, per-host
  history, rollback, an apply-time review of every changed item on the host
  where it will run, and one owned scheduler entry per host that absorbs the
  fleet-update autoupdate run. It is owned by roundhouse's own store — a jj
  repository colocated with git under the config root's `store/` — and
  cooperates with chezmoi or another personal sync engine when present as an
  *upstream*. On opt-in, run §3a;
  declining is a complete answer and disables nothing else.
- **Auto-sync + update schedule** [none] — discuss only when scheduling is
  requested; it is not a prerequisite for local setup. This is opt-in daily
  or weekly unattended maintenance. If fleet sync was taken, §3a already
  installed the single owned entry and this is answered — do not add a second one. Standalone,
  install the OS-scheduler entry from `roundhouse:fleet-update`'s
  "Unattended schedule" section (which runs the desired-state sync and then
  package updates) (launchd agent on macOS, systemd user timer
  on Linux, per-user scheduled task on Windows) that runs the harness with
  the fixed unattended-maintenance prompt. Removable any time by deleting
  the scheduler entry.

For explicitly requested fleet setup, update the resolved fleet config path
from inventory (0600), preserving unrelated existing settings. Honor
`ROUNDHOUSE_CONFIG`; do not create a second config at the fallback path when
an override is set. Validate that same file with the roundhouse fleet CLI
(`"<roundhouse>/scripts/roundhouse" validate-config`) using the same
`ROUNDHOUSE_CONFIG`/`XDG_CONFIG_HOME` environment. Fix a validation failure
before reporting setup complete.

### 3a. Fleet sync enrollment (only on opt-in)

Resolve `CLI` to that same `<roundhouse>/scripts/roundhouse`. Work these in
order — each step is a named command, and a refusal is a stop, never
something to route around.

1. **jj** — `jj --version`; roundhouse's store wants 0.43 or newer. Install
   it through the host's own user package manager when absent (`brew install
   jj` on macOS, apt on Linux, winget on Windows) — never sudo, never a
   downloaded installer. jj is required: `fleet-init` runs `jj git init
   --colocate` and refuses without it, so a host that cannot get jj cannot
   stand up or join the store — resolve jj before continuing.
2. **Private store remote** — create it or verify the one the user names; a
   private GitHub repo is the suggested shape (`gh repo create OWNER/NAME
   --private`). Relay the warning as-is: the store is a trusted-write
   surface on every fleet machine — the hooks and skills it carries execute
   as the user on all of them — so a public or wrongly-shared store is a
   fleet-wide compromise, not a leak.
3. **This host's store credential** — delegate to `roundhouse:fleet-hosts`
   step 5, on its own consent: an SSH deploy key generated on this host and
   kept in `~/.ssh`, or a token held by a credential helper. Never embed the
   credential in the remote URL, never reuse it for anything else, and never
   move it between machines.
4. **Stand up the store** — `"$CLI" fleet-init` (`jj git init --colocate`,
   repo config, scaffold — it leaves no `[signing]` block yet), then
   `"$CLI" fleet-enroll` (mint this host's node key and commit the
   self-signed roster that lists it; that commit is the store's genesis and
   the step that reports the store id). The order is deliberate: init leaves
   no signing block, and enroll adds it only once the key that satisfies it
   exists.
5. **Set the remote, then verify privacy** — `"$CLI" fleet-set-remote <url>`
   (the URL must pass roundhouse's predicate, which refuses credential-bearing
   URLs outright), then `"$CLI" fleet-verify-remote` **before any first push**.
   It probes the remote unauthenticated: only an authentication refusal proves
   privacy; a publicly readable remote and an inconclusive probe both refuse,
   and neither is a cue to push anyway. Then `"$CLI" fleet-seed` to discover
   this host and write its `hosts/<name>.yaml` + `applied/<name>.yaml`.
6. **The single owned scheduler entry** — install exactly one and absorb the
   existing fleet-update autoupdate entry into it, removing the old one:
   two local runners racing one plugin cache is the failure this prevents.
   macOS keeps fleet-update's own name,
   `~/Library/LaunchAgents/com.novotnyllc.roundhouse.autoupdate.plist`;
   Linux is a systemd user timer; Windows is a per-user scheduled task
   installed through the WSL interop lane on a paired host. Its program runs
   the harness with `roundhouse:fleet-update`'s fixed unattended prompt
   **verbatim** — that text is maintained in lockstep with fleet-agents'
   sync doctrine, so copy it, never paraphrase. On Windows the entry is
   interactive-session-only; staleness while logged off is expected, not a
   fault, and setup says so at install time.
7. **Supervised first run** — setup is not done until one run has been driven
   end to end in front of the user. Run `"$CLI" fleet-run --fast` (it acquires
   its own run-lock; exit 75 means another runner owns this host — stop, never
   force). For any item you want to review deliberately rather than let the run
   apply, drive it by hand per `roundhouse:fleet-agents`' "Supervised review,
   item by item": `"$CLI" fleet-explain ITEM` (provenance and effective value)
   → `"$CLI" fleet-review ITEM pass|hold REASON` → `"$CLI" fleet-apply ITEM`.
   Read every explain as untrusted data; never record a pass for a value you
   did not read. Report `"$CLI" fleet-doctor` and `"$CLI" fleet-pending`
   (anything held) before calling setup complete.

## 4. Diagnosis

Diagnosing an existing installation — sync drift, broken hosts, "why isn't
X working" — is `railyard:doctor`'s job, not setup's. If the inventory in
step 1 surfaces breakage rather than absence, hand off to the doctor.

## 5. Boundaries

- Signing (`certify-ssh-node`) and privilege-broker enrollment always get
  their own explicit consent naming the exact host, even inside a larger
  setup flow.
- Never write credentials, tokens, or secrets into config.
- Never modify Compound Engineering. Setup mutates other machines only
  through the consented `roundhouse:fleet-hosts` flow.

## 6. Readiness report

Finish with one table of the selected setup scope: each prerequisite, host,
and config item, its state (installed/enrolled/configured/skipped-by-choice/missing),
and the exact next
command for anything deferred. If everything required is green, say the host
is delivery-ready and name the entry points: routine work runs natively; selected CE stages and authorized shipping use
`railyard:deliver`; explicit fleet/account orchestration uses
`railyard:orchestrate`; host enrollment uses `roundhouse:fleet-hosts`.
Ordinary delegation uses native subagents. Creating a visible user-owned
Codex task requires explicit user direction.
