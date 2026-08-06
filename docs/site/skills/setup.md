<!-- cross-repo links use site-absolute paths, resolved at site build -->

# Setup

Setup takes a host from bare to delivery-ready: it inventories what's installed, installs
missing prerequisites with your consent, asks what your fleet hosts are and enrolls them,
validates the configuration, and reports back a readiness table. Run it again any time — it's
idempotent and only proposes what's actually missing.

## When to use it

- First time installing railyard on a machine, or bringing a new machine up to the same state as
  your others.
- You want to grow or shrink the fleet — add or remove hosts from delivery routing.
- A required dependency turns out to be missing (Compound Engineering absent or too old,
  `gh-stack` not installed, `tmux`/`jq` missing).
- You ask to set up, install, configure, onboard, or fix the delivery system.

Use [doctor.md](./doctor.md) instead once something is already installed and behaving oddly —
drift, broken hosts, "why isn't X working." Setup handles absence; doctor handles breakage.

## How it works

### Step 1 — inventory, read-only

Before asking you anything, setup collects the current state: installed plugin versions on each
available harness (`claude plugin list`, `codex plugin list --json`), noting versions for
`railyard`, `roundhouse`, `agent-utilities`, and `compound-engineering` (which needs 3.20.0+ for
`ce-babysit-pr`); known marketplaces (`novotnyllc/marketplace`,
`EveryInc/compound-engineering-plugin`); fleet config location and contents; tooling presence
(`gh` auth state, `gh-stack` and its agent skills, `tmux`, `jq`, `node`, optionally `chezmoi`
and `op`); already-present optional extras (the Oracle Pro cache, a model-routing catalog); and
credential *presence* — never values — for whatever the installed plugins actually need: `gh
auth status`, `ZAI_API_KEY`/`LITELLM_PROXY_API_KEY` when Codex's `zai_litellm` GLM provider is
configured, `op` sign-in state when the one-password skill is installed. A missing key gets
reported with where to set it — shell environment via dotfiles, or 1Password through the
one-password skill — never a request to paste a secret into the conversation.

Everything present or missing gets summarized in one table before setup proposes anything.

### Step 2 — prerequisites, installed on consent

Setup asks once per group, not once per command, with the recommended option listed first. It
never installs silently and never uses `sudo` — only your package managers.

- **Plugins and marketplaces** (required for delivery): adds the `novotnyllc` and
  `EveryInc/compound-engineering-plugin` marketplaces, then installs `railyard`, `roundhouse`,
  `agent-utilities`, and `compound-engineering`. Codex gets the mirrored commands. Anything
  present but stale gets `update` instead of `install` — if Compound Engineering is below
  3.20.0, updating it isn't optional. After any Codex install or update, setup re-trusts that
  plugin's hooks with Roundhouse's approval helper so hooks just work without a manual trust
  step.
- **Stacked-PR tooling** (required for dependent-stack delivery): `gh-stack` via `gh extension
  install` plus its agent skills for both Codex and Claude Code.
- **Shell tooling** (required for fleet transport and 1Password): `tmux` and `jq` via your
  package manager.
- **macOS app testing** (optional, offered when you build macOS/iOS apps):
  `tart-xcode-runner@novotnyllc` plus the `tart` CLI, so Xcode builds and XCUITests run in
  disposable VMs instead of seizing your screen. Skipping this disables nothing else —
  [deliver](./deliver.md) offers it again the first time macOS app work would actually benefit.
- **Compound Engineering's own setup**: if CE was just installed, setup offers
  `compound-engineering:ce-setup` for its own repository-level onboarding.

### Step 3 — configuration interview

Setup only asks what the inventory found unset, restating each answer before writing it down.
Defaults are shown in brackets:

- **What are the hosts?** [this machine only] — "just this machine" is a complete answer that
  skips every host-related question. For each named host, the entire add flow — config entry,
  reachability, SSH-certificate enrollment, target prerequisites, readiness — is delegated to
  `roundhouse:fleet-hosts`, with each signing or privileged step getting its own explicit
  consent naming the exact host. Setup also captures WSL/Windows pairs on shared hardware
  (`physical_host` plus `wsl_interop_via`) so the interop lane works from day one — see
  [orchestrate.md](./orchestrate.md#the-placement-lanes) for what that lane does.
- **Development root** [`~/dev`] — where project checkouts live.
- **Cross-host handoff project** [none] — the shared Git repo for checkpoint-based handoff, if
  any.
- **Codex remote-control host** [none] — only relevant for a native-Windows destination driven
  by Codex Desktop.
- **Model-routing catalog** [none — built-in defaults] — the no-config profile (Sol
  orchestration/review, Luna implementation) is the recommended default; a catalog only gets
  written if you have explicit routing policy to encode.
- **Oracle** [skip] — recorded only if you have ChatGPT Pro and want Oracle reviews available;
  see [oracle.md](./oracle.md).
- **Fleet sync** [not yet available] — mentioned as existing in Roundhouse's design, not wired
  up here.
- **Auto-sync and update schedule** [none] — opt-in unattended maintenance (daily or weekly)
  that installs an OS-scheduler entry running Roundhouse's desired-state sync and package
  updates; removable any time by deleting the scheduler entry.

The fleet config is written to `${XDG_CONFIG_HOME:-$HOME/.config}/roundhouse/config.json` at
mode `0600`, then validated with the Roundhouse fleet CLI. A validation failure gets fixed in
the interview loop, not waved off.

### Step 4 — handing off diagnosis

If the inventory in step 1 turns up breakage rather than absence — something installed but not
working — setup hands off to [doctor.md](./doctor.md) rather than trying to fix it itself.

## Boundaries

- Signing (`certify-ssh-node`) and privilege-broker enrollment always get their own explicit
  consent naming the exact host, even inside a larger setup run.
- Never writes credentials, tokens, or secrets into config.
- Never modifies Compound Engineering. Setup only mutates other machines through the consented
  `roundhouse:fleet-hosts` flow — never directly.
- A zero-fleet, zero-config outcome is a valid, complete result: the router's built-in defaults
  and local delivery work with nothing configured, so setup never manufactures configuration you
  didn't ask for.

## Example session

**Prompt:** "Set up railyard on this machine."

**What happens:** Setup runs the read-only inventory first — finds `railyard` and `roundhouse`
already installed but `compound-engineering` missing entirely, `gh-stack` not installed, and no
fleet config. It presents a one-table summary, then asks once about installing the missing
plugin group (recommended option first): adding the CE marketplace and installing
`compound-engineering`, plus `gh-stack` and its agent skills. On consent, it runs those
installs, re-trusts any new Codex hooks, and then runs the configuration interview — you answer
"just this machine" for hosts, which skips the entire host-enrollment section. It writes and
validates the (mostly empty) fleet config, and finishes with a readiness table showing
everything green, naming `railyard:deliver` as the entry point for "implement/fix/ship X"
requests.

