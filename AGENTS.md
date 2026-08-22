# AGENTS.md

Railyard is the delivery system for agent work: model routing, delivery,
orchestration, cross-machine placement, review gates, and Oracle. Plugin
source lives under `plugins/railyard/`; everything else is documentation.

## Always

- Run the read-only `railyard:model-routing` intake on every software
  delivery turn. `railyard/model-routing/v1` is the only operational
  model/effort, budget, and transport policy —
  [delivery routing](docs/agents/routing.md).
- Any change under `plugins/` bumps both plugin manifests and repins the
  marketplace; docs-only changes do neither —
  [release coupling](docs/agents/release-coupling.md).
- Never treat an installed plugin cache as the source repository.
- Do not hard-code maintainer-local secrets, host names, vault names, or
  machine inventory. Use environment variables or user-owned config paths.

## Verify

Node 24, no package manager and no install step:

```sh
node --test \
  plugins/railyard/scripts/model-routing.test.mjs \
  plugins/railyard/skills/orchestrate/scripts/delivery-contracts.test.mjs \
  plugins/railyard/skills/oracle/scripts/oracle-route.test.mjs \
  plugins/railyard/skills/oracle/scripts/ensure-oracle.test.mjs \
  plugins/railyard/skills/cleanup-codex/scripts/inventory.test.mjs \
  plugins/railyard/skills/cleanup-codex/scripts/snapshot-reap.test.mjs \
  plugins/railyard/skills/cleanup-codex/scripts/recycle.test.mjs \
  plugins/railyard/skills/cleanup-codex/scripts/hook.test.mjs \
  plugins/railyard/skills/cleanup-codex/scripts/canary.test.mjs \
  plugins/railyard/hooks/routing-nudge.test.mjs \
  plugins/railyard/hooks/dispatch-gate.test.mjs   plugins/railyard/hooks/route-state.test.mjs   plugins/railyard/hooks/route-lifecycle.test.mjs \
  plugins/railyard/hooks/routing-charter.test.mjs \
  plugins/railyard/hooks/railyard-retro.test.mjs \
  plugins/railyard/hooks/merge-settlement-gate.test.mjs
```

These are exactly the suites `.github/workflows/validate.yml` runs on Linux
and macOS, alongside a `JSON.parse` of both plugin manifests.

## Deeper

- [Charter and boundaries](docs/agents/charter.md) — what belongs here,
  what belongs in `roundhouse` or `agent-utilities`
- [Delivery routing](docs/agents/routing.md) — intake, ownership between
  orchestrate/deliver/LFG, task titles
- [Release coupling](docs/agents/release-coupling.md) — version bump, repin,
  docs-only exemption
- [Skill authoring](docs/agents/skill-authoring.md) — both-harness rule,
  naming, attribution, validation
