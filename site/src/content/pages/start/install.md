---
layout: default
title: Install
parent: Start here
nav_order: 1
---

# Install

Install the plugins through the marketplace you already use, then speak in plain language to the front door.

## Claude Code

```sh
claude plugin marketplace add novotnyllc/marketplace
claude plugin install railyard@novotnyllc
claude plugin install roundhouse@novotnyllc
```

## Codex

```sh
codex plugin marketplace add novotnyllc/marketplace
codex plugin add railyard --marketplace novotnyllc
codex plugin add roundhouse --marketplace novotnyllc
```

Install `railyard` for routed delivery, review, merge, and proof. Install `roundhouse` for inventory, readiness, remote administration, and fleet convergence. Each plugin operates as a complete local surface; together they connect placement to readiness.

Keep the public source and release trail nearby: [Railyard on GitHub](https://github.com/novotnyllc/railyard), [Roundhouse on GitHub](https://github.com/novotnyllc/roundhouse), [marketplace source](https://github.com/novotnyllc/marketplace), [Railyard releases](https://github.com/novotnyllc/railyard/releases), and [Roundhouse releases](https://github.com/novotnyllc/roundhouse/releases).

## First conversation

```text
> Set up railyard on this machine.
```

Then try:

```text
> Fix the flaky retry test in the billing service and get it merged.
```

The request supplies the intent. Routing, review, and evidence handling follow the appropriate workflow.

Next: [make the first delivery](/start/first-delivery/) or [bring up the first machine](/start/first-machine/).
