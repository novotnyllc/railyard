---
layout: default
title: FAQ
nav_order: 5
---

# FAQ

Choose the smallest operating boundary that can produce a real receipt, then add capability only when the work earns it. The answers below begin with that practice and use Railyard or Roundhouse mechanisms as evidence.

## Railyard vs Roundhouse: do I need both?

Start with the outcome you need to prove. Railyard carries routing, review, merge, and post-merge proof; Roundhouse adds inventory, readiness, convergence, and remote administration when machines become part of that outcome. See the [Start decision matrix](/start/).

## Claude Code vs Codex: which harnesses are supported?

Keep one owning delivery even when execution surfaces change. Claude Code and Codex are both supported; same-harness execution is the default. Cross-harness dispatch is opt-in, requires the destination Codex CLI to be set up separately, and records model, effort, carrier, and transport. The [cross-harness practice](/what-it-does/work-across-harnesses/) shows that receipt.

## Does this work on Windows and WSL?

Treat every operating-system boundary as its own proof surface. The documented support includes macOS, Linux, Windows, and WSL, with native Windows evidence kept distinct from WSL. The [installation compatibility notes](/start/install/#compatibility-and-cost) state the CLI and tooling assumptions.

## Is a GitHub remote required? What if there is no test suite?

Match the receipt to the available delivery surface. A GitHub remote enables a published pull request; a local delivery can still run its checks and name the unavailable publish step. When no suite exists, the route chooses the smallest applicable command and records the verification boundary honestly.

## What does it cost?

Railyard itself is free and open source (MIT); you pay only your own Claude/Codex usage, billed exactly as any other session in that harness. The [model routing guide](/what-it-does/control-model-cost/) explains how the route records the budget decision.

## What else gets installed?

Railyard uses [Compound Engineering (EveryInc)](https://github.com/EveryInc/compound-engineering-plugin) for selected workflow stages. Resolve CE when a stage needs it; startup does not bootstrap workflow dependencies. [Ponytail (DietrichGebert)](https://github.com/DietrichGebert/ponytail) and Superpowers are not Railyard prerequisites.

## Does every request need a delivery workflow?

Routine work runs natively, and useful CE workflows are selected automatically. Use `compound-engineering:ce-commit-push-pr` whenever creating a PR or pushing user-requested commits to an existing PR. CE owns one review settlement and CI loop. Fleet or account orchestration requires explicit scope; native child agents are the default for parallel work, and visible Codex tasks require an explicit user request.

## What is a receipt, a run log, or Thermos?

- A [receipt](/delivery/lifecycle/) is the evidence chain from intent through merge and post-merge proof.
- A [run log](/delivery/audit/) records decisions when an audit is useful; audit and retrospective are optional.
- [Thermos](/skills/thermos/) supplies optional bounded review lenses alongside CE's review settlement.
