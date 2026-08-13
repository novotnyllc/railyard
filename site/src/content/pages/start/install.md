---
layout: default
title: Install
parent: Start here
nav_order: 1
---

# Install

Install Railyard for routed delivery, review, merge, and proof. Roundhouse is the fleet convergence layer for inventory, readiness, and remote administration. The delivery-only path needs Railyard; the Roundhouse line is optional and only needed for fleet scenarios. See the [Start decision matrix](/start/).

Railyard depends on [Compound Engineering (EveryInc)](https://github.com/EveryInc/compound-engineering-plugin) for the workflow engine and [ponytail (DietrichGebert)](https://github.com/DietrichGebert/ponytail) for the efficiency discipline used in implementation and verification. The marketplace groups these transitive installs into the same consent step; dependency behavior is unchanged.

## Claude Code

```sh
claude plugin marketplace add novotnyllc/marketplace
claude plugin install railyard@novotnyllc
# optional — only needed for fleet scenarios
claude plugin install roundhouse@novotnyllc
```

Expected confirmation after each command:

```text
marketplace added: novotnyllc
```

```text
plugin installed: railyard@novotnyllc
```

```text
plugin installed: roundhouse@novotnyllc
```

## Codex

```sh
codex plugin marketplace add novotnyllc/marketplace
codex plugin add railyard --marketplace novotnyllc
# optional — only needed for fleet scenarios
codex plugin add roundhouse --marketplace novotnyllc
```

Expected confirmation after each command:

```text
marketplace added: novotnyllc
```

```text
plugin added: railyard@novotnyllc
```

```text
plugin added: roundhouse@novotnyllc
```

## Verify the install

Run the plugin listing before the first conversation:

```sh
claude plugin list
```

A correct listing includes:

```text
railyard@novotnyllc
roundhouse@novotnyllc
```

On Codex, use `codex plugin list --json` and confirm that `railyard` is present. Add `roundhouse` when the fleet path is part of the work.

## Compatibility and cost

Railyard supports macOS, Linux, Windows, and WSL. The minimum documented versions are Claude Code 2.1.220+ and Codex CLI 0.147.0+ with plugin marketplace support. Node 22.12+ is required for the site tooling, and Git must be available on `PATH` for repository delivery. Compound Engineering 3.20.0+ is the pinned workflow dependency.

Railyard itself is free and open source (MIT); you pay only your own Claude/Codex usage, billed exactly as any other session in that harness.

## Troubleshooting

- **Marketplace add fails:** check network access and the marketplace slug, then retry `claude plugin marketplace add novotnyllc/marketplace` or its Codex equivalent.
- **The plugin is already installed:** keep the existing entry if it is the expected marketplace version; otherwise update it through the same harness before retrying.
- **The CLI is too old:** update Claude Code or Codex until its plugin marketplace command is available, then run the verify step again.
- **A skill is not found after install:** confirm the plugin appears in the listing, restart the harness, and continue with the [troubleshooting guide](/troubleshooting/).

The public source and release trail supply the load-bearing evidence: [Railyard on GitHub](https://github.com/novotnyllc/railyard), [Roundhouse on GitHub](https://github.com/novotnyllc/roundhouse), [marketplace source](https://github.com/novotnyllc/marketplace), [Railyard releases](https://github.com/novotnyllc/railyard/releases), and [Roundhouse releases](https://github.com/novotnyllc/roundhouse/releases).

## First conversation

```text
> Set up railyard on this machine.
```

Then try:

```text
> Fix the flaky retry test in the billing service and get it merged.
```

Your request supplies the intent; the appropriate workflow carries routing, review, and evidence handling.
