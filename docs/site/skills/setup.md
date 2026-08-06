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
- **Fleet sync** [skip] — mentioned exactly once, as a single paragraph, and never turned on by
  default. Roundhouse's opt-in desired-state sync keeps your user-scope agent surface — plugins
  with their enabled state, standalone skills, agents, hooks, MCP servers, and allowlisted
  harness config keys — consistent across every machine and harness, with groups, per-host
  history, rollback, an apply-time review of every changed item on the host where it will run,
  and one owned scheduler entry per host. It lives in Roundhouse's own store (a `jj` repository
  colocated with git under the config root's `store/`), never in chezmoi or another personal
  sync engine — those are detected as *upstreams*, not depended on as infrastructure. Say no and
  nothing else changes; say yes and setup runs the enrollment below.
- **Auto-sync and update schedule** [none] — opt-in unattended maintenance (daily or weekly)
  that installs an OS-scheduler entry running Roundhouse's desired-state sync and package
  updates; removable any time by deleting the scheduler entry. If you took fleet sync, that
  enrollment already installed the single owned entry and setup won't add a second.

### Step 3a — fleet sync enrollment, only if you opt in

Ordered, and each step is a named command — a refusal stops the flow rather than getting routed
around:

1. **`jj`** — checked with `jj --version` (the store wants 0.43+) and installed through your own
   user package manager if missing (`brew install jj` on macOS, apt on Linux, winget on
   Windows) — never `sudo`, never a downloaded installer. A host that can't get `jj` isn't
   blocked: `sync-init` falls back to git-only against the same repo by itself.
2. **A private store remote** — created or verified; a private GitHub repo is the suggested
   shape. The warning comes with it, plainly: the store is a trusted-write surface on every
   fleet machine — the hooks and skills it carries execute as you on all of them — so a public
   or wrongly-shared store is a fleet-wide compromise, not a leak.
3. **This host's store credential** — delegated to `roundhouse:fleet-hosts` on its own consent:
   an SSH deploy key generated on this host, or a token in a credential helper. Never embedded
   in the remote URL, never reused for anything else.
4. **The config `sync` block** — written per [Roundhouse's config
   reference](/roundhouse/config#sync) (`enabled`, `remote.url`, and `cadence_hours` are all
   required once the block exists; the URL predicate refuses credential-bearing URLs), then
   re-validated.
5. **Scaffold and privacy check** — `sync-init` (which refuses unless `sync.enabled` is true),
   then `sync-verify-remote` *before any first push*: it probes the remote unauthenticated, and
   only an authentication refusal proves privacy — a publicly readable remote and an
   inconclusive probe both refuse. Then `sync-absorb-registry` moves `config.json`'s `machines`
   block into the store registry.
6. **One owned scheduler entry** — installed once, absorbing and removing any existing
   fleet-update autoupdate entry, because two local runners racing one plugin cache is the
   failure this prevents. macOS keeps fleet-update's existing
   `com.novotnyllc.roundhouse.autoupdate.plist` launchd agent; Linux gets a systemd user timer;
   Windows gets a per-user scheduled task installed through the WSL interop lane. Its program is
   fleet-update's fixed unattended prompt, copied verbatim. On Windows it's
   interactive-session-only, so staleness while logged off is expected, not a fault.
7. **A supervised first run** — setup isn't finished until one sync run has been driven end to
   end in front of you: fetch and open the run, read and record a verdict on every changed diff,
   apply, converge, journal, close. Anything held is reported before setup calls itself done.

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

