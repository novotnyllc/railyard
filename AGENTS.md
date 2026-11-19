# AGENTS.md

Railyard is the delivery system for agent work: delivery,
orchestration, cross-machine placement, review gates, and Oracle. Plugin
source lives under `plugins/railyard/`; everything else is documentation.

## Always

- Pass the [pre-push review policy](plugins/railyard/references/whole-candidate-review.md)
  to CE. The default requires repository checks and one independent review of
  the whole change before the first push. Review later repairs and their
  affected behavior, or review the whole change again when its design or
  risk changes materially or prior coverage is uncertain.

- Use the current chat as coordinator. CE Work handles implementer selection
  and execution across supported harnesses. Use Railyard orchestration for
  explicit fleet or account placement. See [delivery routing](docs/agents/routing.md).
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
  plugins/railyard/skills/orchestrate/scripts/delivery-contracts.test.mjs \
  plugins/railyard/skills/oracle/scripts/ensure-oracle.test.mjs \
  plugins/railyard/skills/cleanup-codex/scripts/inventory.test.mjs \
  plugins/railyard/skills/cleanup-codex/scripts/snapshot-reap.test.mjs \
  plugins/railyard/skills/cleanup-codex/scripts/recycle.test.mjs \
  plugins/railyard/skills/cleanup-codex/scripts/desktop.test.mjs \
  plugins/railyard/skills/cleanup-codex/scripts/hook.test.mjs \
  plugins/railyard/skills/cleanup-codex/scripts/canary.test.mjs \
  plugins/railyard/skills/cleanup-codex/scripts/transaction.test.mjs \
  plugins/railyard/hooks/lean-hooks.test.mjs \
  plugins/railyard/hooks/routing-charter.test.mjs \
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

## Merging

PRs land through the Mergify merge queue (`.mergify.yml`), squashed into one commit on `main` titled and described by the PR; merge commits and rebase merges are turned off. Do not merge by hand. Mergify queues a PR once it is not a draft, its required checks are green, every review thread is resolved, and it is authored by clairernovotny or approved by someone with write access. Add the `do-not-merge` label to hold one back.
