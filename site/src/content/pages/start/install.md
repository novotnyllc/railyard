---
layout: default
title: Install
parent: Start here
nav_order: 1
---

# Install

Install Railyard for routed delivery, review, merge, and proof. Roundhouse is the fleet convergence layer for inventory, readiness, and remote administration. The delivery-only path needs Railyard; the Roundhouse line is optional and only needed for fleet scenarios. See the [Start decision matrix](/start/).

Railyard uses [Compound Engineering (EveryInc)](https://github.com/EveryInc/compound-engineering-plugin) for selected workflow stages. Resolve CE when a selected stage needs it; startup does not bootstrap workflow dependencies. [Ponytail (DietrichGebert)](https://github.com/DietrichGebert/ponytail) and Superpowers are not Railyard prerequisites.

## Claude Code

```sh
claude plugin marketplace add novotnyllc/marketplace
claude plugin install railyard@novotnyllc
# optional — only needed for fleet scenarios
claude plugin install roundhouse@novotnyllc
```

Illustrative confirmations; exact wording varies by harness version:

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

Illustrative confirmations; exact wording varies by harness version:

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

Confirm that Railyard is listed:

```text
railyard@novotnyllc
```

If you selected the fleet path, also confirm `roundhouse@novotnyllc` is listed. On Codex, use `codex plugin list --json` and confirm the plugins you selected are present.

## Compatibility and cost

Railyard supports macOS, Linux, Windows, and WSL. The minimum documented versions are Claude Code 2.1.280+ (for the Opus 5.5 default; older versions resolve `opus` to an earlier Opus) and Codex CLI 0.147.0+ with plugin marketplace support. Node 22.12+ is required for the site tooling, and Git must be available on `PATH` for repository delivery. Selected CE workflow stages use Compound Engineering 3.20.0+.

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

Your request supplies the intent. Routine work runs natively, and useful CE workflows are selected automatically. Use `compound-engineering:ce-commit-push-pr` whenever creating a PR or pushing user-requested commits to an existing PR.
