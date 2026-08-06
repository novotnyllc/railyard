<!-- cross-repo links use site-absolute paths, resolved at site build -->

# Doctor

Doctor diagnoses the delivery system and proposes fixes — it never mutates
anything until you
consent, and its diagnostic pass is strictly read-only. Run it any time; a healthy
system
produces a short all-green table, not noise.

## When to use it

- You ask "doctor," "diagnose," "health check," or "why isn't X working."
- You want to know whether plugins and skills are in sync across harnesses or
  across fleet
  hosts.
- Something that used to work stopped working and you're not sure why.
- You want to confirm marketplace freshness, fleet config validity, or host
  reachability before
  starting real work.

Use [setup.md](./setup.md) instead when something is simply *missing* rather than
broken — a
first install, a new host, a dependency that was never there. Doctor's fixes route
missing-prerequisite findings back to setup rather than duplicating its install
flow.

## How it works

### The diagnostic sweep

Doctor runs every check that applies to the current host and explicitly skips (and
says so)
whatever the host provably lacks — no Codex installed means Codex-side checks are
skipped, not
silently failed.

**Sync and versions**

- Harness parity on this host: `claude plugin list` versus `codex plugin list
  --json` — the same
  plugin at different versions across harnesses is itself a finding.
- Marketplace freshness against the current `novotnyllc` and
  `compound-engineering-plugin`
  catalogs — a stale marketplace snapshot is a finding on its own.
- Compound Engineering presence, version (3.20.0+), and whether `ce-babysit-pr` is
  exposed.
- Codex hook trust: every installed plugin's hooks trusted with current hashes. An
  untrusted or
  hash-stale hook is auto-fixable — doctor runs Roundhouse's
`codex-plugin-hooks.mjs approve`
  for that plugin.
- Fleet-wide parity: when a fleet config exists, the cross-host
  skill/plugin/runtime comparison
  is delegated to `roundhouse:fleet-agents` in inventory mode, and its drift
report folds into
  doctor's findings.

**Configuration and state**

- Fleet config present, `validate-config` passing, and no orphaned hosts — config
  entries whose
  SSH alias no longer resolves.
- Retired plugins still installed, and orphaned config/state directories from
  retired names —
  offered for deletion since nothing reads them anymore.
- The unattended auto-update schedule, if installed: scheduler entry present, and
  its log free
  of repeated failures.
- Router state: `railyard:model-routing` `status` succeeds, and a configured
  catalog, if any,
  validates. See [model-routing.md](./model-routing.md).
- Credential presence for installed capabilities — existence only, never values:
  `gh auth
  status`; `ZAI_API_KEY`/`LITELLM_PROXY_API_KEY` when Codex's `zai_litellm`
provider is
  configured, including whether the proxy actually responds on its port; `op`
sign-in when
  one-password is installed. A missing key gets reported with where to set it,
never solicited
  in chat.

**Per host, when a fleet exists**

- Reachability through the login shell (`ssh -o BatchMode=yes`).
- Certificate enrollment state.
- Installed executor verification and version against this controller.
- `roundhouse:fleet-readiness` go/no-go. For a Windows machine declaring
  `wsl_interop_via` (see
  [orchestrate.md](./orchestrate.md#the-placement-lanes) for what that lane is
for), doctor
  verifies the interop lane actually answers — `cd /mnt/c` then a full-path
`cmd.exe /c` call
  runs a native command from the WSL side — confirms the named WSL entry exists,
and confirms
  paired entries agree on `physical_host`. If the interop launch fails while plain
SSH is
  healthy, it checks `/proc/sys/fs/binfmt_misc/WSLInterop` on the WSL side to tell
"interop
  disabled" apart from "target missing." This check exists because WSL-side
execution can never
  substitute as proof that something ran natively on Windows — the two are tracked
as separate
  facts everywhere in this system.

### Findings and fixes

Everything lands in one table: check, state (`ok` / `drift` / `broken` /
`skipped-with-reason`),
and for every non-`ok` row, the minimal fix and who owns it:

| Finding | Fix owner |
| --- | --- |
| Plugin/skill drift | `roundhouse:fleet-agents` routine refresh (or direct `plugin update` locally) |
| sshd faults | `roundhouse:ssh-doctor` |
| Enrollment or host prerequisites | `roundhouse:fleet-hosts` |
| Package baseline (tmux/jq) | `roundhouse:fleet-update` |
| Missing prerequisites or first-run gaps | [setup.md](./setup.md) |

Fixes apply only after consent, grouped the same way setup groups its consent
asks, and doctor
re-runs the affected checks afterward — a fix without a green re-check doesn't
count as a fix.
Doctor never mutates anything during the diagnostic pass itself, never uses
`sudo`, and never
touches enrolled or privileged state outside the skill that actually owns that
ceremony.

## Boundaries

- Diagnosis is always read-only; every mutation is a separate, consented,
  delegated step.
- Doctor doesn't own the fix for anything — it identifies the problem and routes
  the fix to the
  skill that owns that surface (Roundhouse skills for fleet/host issues, setup for
missing
  prerequisites).
- It never touches privileged or enrolled state (SSH certificate signing, host
  enrollment)
  outside that state's own owning skill and ceremony.

## Example session

**Prompt:** "Why can't I get my delivery pipeline to run on my Windows box?"

**What happens:** Doctor runs the sweep. Harness parity and marketplace freshness
on the local
machine come back clean. It reaches the per-host section for the Windows machine,
confirms plain
SSH reachability, then checks the WSL interop lane specifically — the `cmd.exe /c`
launch from
the WSL side fails while SSH itself is healthy. It checks
`/proc/sys/fs/binfmt_misc/WSLInterop`
on the WSL side and finds interop disabled, not the target missing. The findings
table reports
one broken row — "WSL interop lane: disabled" — with the fix owner
`roundhouse:fleet-hosts` and
the exact next step. Nothing gets touched automatically; doctor waits for consent
before handing
off the repair.


