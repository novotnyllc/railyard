---
layout: default
title: FAQ
nav_order: 5
---

# FAQ

Choose the smallest operating boundary that can produce a real receipt, then add capability only when the work earns it. The answers below begin with that practice and use Railyard or Roundhouse mechanisms as evidence.

## Railyard vs Roundhouse: do I need both?

Railyard carries a change through review, merge, and post-merge proof. Roundhouse adds inventory, readiness, convergence, and remote administration when machines become part of that outcome. [Start decision matrix](/start/)

## Claude Code vs Codex: which harnesses are supported?

Railyard runs in Claude Code and Codex. Use CE to select an external implementation engine from the owning chat, with the destination CLI and account already configured. [Work across harnesses](/what-it-does/work-across-harnesses/)

## Does this work on Windows and WSL?

Treat every operating-system boundary as its own proof surface. The documented support includes macOS, Linux, Windows, and WSL, with native Windows evidence kept distinct from WSL. The [installation compatibility notes](/start/install/#compatibility-and-cost) state the CLI and tooling assumptions.

## Is a GitHub remote required? What if there is no test suite?

Match the receipt to the available delivery surface. A GitHub remote enables a published pull request; a local delivery can still run its checks and name the unavailable publish step. When no suite exists, the route chooses the smallest applicable command and records the verification boundary honestly.

## What does it cost?

Railyard is free and open source (MIT). Usage bills through the harness and model provider configured for the run.

## What else gets installed?

Railyard uses [Compound Engineering (EveryInc)](https://github.com/EveryInc/compound-engineering-plugin) for selected workflow stages. Resolve CE when a stage needs it; startup does not bootstrap workflow dependencies. [Ponytail (DietrichGebert)](https://github.com/DietrichGebert/ponytail) and Superpowers are not Railyard prerequisites.

## Does every request need a delivery workflow?

Routine work runs natively, and you can invoke CE workflows when useful. Use `compound-engineering:ce-commit-push-pr` whenever creating a PR or pushing user-requested commits to an existing PR. CE owns one review settlement and CI loop. Deliver can use authorized fleet placement when it helps a stage. Native child agents are the default for local parallel work, and visible Codex tasks require an explicit user request.

## What are the formal review receipt and Thermos?

- The [formal review receipt](/delivery/gates/) records candidate identity, coverage, checks, and findings when full review is selected.
- [Thermos](/skills/thermos/) supplies both lenses for the [optional full review](/delivery/gates/) alongside `codex review` using its configured settings. Its findings feed the existing CE owner.
