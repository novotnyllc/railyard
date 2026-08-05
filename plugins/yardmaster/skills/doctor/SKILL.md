---
name: doctor
description: "Diagnose and fix the delivery system: plugin and skill version sync across harnesses and fleet hosts, marketplace freshness, fleet config validity, host reachability and enrollment state, executor integrity, and Compound Engineering compatibility. Use when the user says doctor, diagnose, health check, \"why isn't X working\", or asks whether plugins/skills/hosts are in sync or up to date."
---

# Yardmaster Doctor

Diagnose first, fix second. The diagnostic pass is strictly read-only; every
fix is proposed with the exact command and applied only on consent, routed to
the skill that owns it. Run any time — a healthy system produces a short
all-green table, not noise.

## Diagnostic sweep

Run every check that applies; skip only what the host provably lacks (no
Codex installed → skip Codex-side checks, and say so).

**Sync and versions**

- Harness parity on this host: `claude plugin list` vs
  `codex plugin list --json` — the same plugin at different versions across
  harnesses is a finding.
- Marketplace freshness: installed versions vs the current catalogs
  (`novotnyllc`, `compound-engineering-plugin`); a stale marketplace snapshot
  is itself a finding.
- Compound Engineering: present, 3.20.0+, `ce-babysit-pr` exposed.
- Fleet-wide parity: when a fleet config exists, delegate the cross-host
  skill/plugin/runtime comparison to `roundhouse:fleet-agents` (inventory
  mode) and fold its drift report into the findings.

**Configuration and state**

- Fleet config: present, `validate-config` passes, no orphaned hosts
  (config entries whose SSH alias no longer resolves).
- Legacy leftovers: a `machine-utilities/` config or state dir still being
  used via fallback (offer the copy to `roundhouse/`); router config/state
  still under the pre-split `~/.config/agent-utilities/` or
  `~/.local/state/agent-utilities/` paths (offer the copy to `yardmaster/` —
  the router does not read the old paths); retired plugins still installed.
- Router state: `yardmaster:model-routing` `status` succeeds; a configured
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
- `roundhouse:fleet-readiness` go/no-go.

## Findings and fixes

Report one table: check, state (ok / drift / broken / skipped-with-reason),
and for every non-ok row the minimal fix and its owner:

- plugin/skill drift → `roundhouse:fleet-agents` routine refresh (local:
  the direct `plugin update` commands);
- sshd faults → `roundhouse:ssh-doctor`;
- enrollment or host prerequisites → `roundhouse:fleet-hosts`;
- package baseline (tmux/jq) → `roundhouse:fleet-update`;
- missing prerequisites or first-run gaps → `yardmaster:setup`.

Apply fixes only after consent, grouped like setup's consent groups, and
re-run the affected checks afterward — a fix without a green re-check is not
a fix. Never mutate during diagnosis, never use sudo, and never touch
enrolled/privileged state outside the owning skill's own ceremony.
