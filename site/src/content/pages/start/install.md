---
layout: default
title: Install
parent: Start here
nav_order: 1
---

# Install

Give agents one dependable front door for delivery and one for fleet operations. Install the plugins through the marketplace you already use, then state the outcome in plain language. The payoff is an operating surface that can route, review, prove, place, and converge work from the harness already in your hands.

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

Use `railyard` for routed delivery, review, merge, and proof. Use `roundhouse` for inventory, readiness, remote administration, and fleet convergence. Each plugin operates as a complete local surface; together they connect placement to readiness.

The public source and release trail supply the load-bearing evidence: [Railyard on GitHub](https://github.com/novotnyllc/railyard), [Roundhouse on GitHub](https://github.com/novotnyllc/roundhouse), [marketplace source](https://github.com/novotnyllc/marketplace), [Railyard releases](https://github.com/novotnyllc/railyard/releases), and [Roundhouse releases](https://github.com/novotnyllc/roundhouse/releases).

For the eventual domain move, keep the [custom-domain cutover](/docs/cutover/) handoff beside the install receipt.

## First conversation

```text
> Set up railyard on this machine.
```

Then try:

```text
> Fix the flaky retry test in the billing service and get it merged.
```

Your request supplies the intent; the appropriate workflow carries routing, review, and evidence handling.

Next: [make the first delivery](/start/first-delivery/) or [bring up the first machine](/start/first-machine/).
