---
layout: default
title: Start here
nav_order: 2
has_children: true
---

# Start here

Begin with one outcome you can prove. Install the smallest useful surface, make one delivery on the machine you already trust, and add fleet capabilities when you request placement or convergence. This sequence builds confidence from working evidence and keeps the operating model easy to understand.

If a command or gate stops, use the [troubleshooting guide](/troubleshooting/) before changing the delivery path.

## First delivery example

For a request to fix an issue and get it merged, begin with native execution and select useful CE workflows. CE owns review settlement and the CI loop through the requested merge. Show the actual checks and post-merge evidence so the operator can assess the result. Add Roundhouse for explicitly requested fleet work.

- [Install](/start/install/) — add Railyard to Claude Code, Codex, or both; Roundhouse is optional for fleet work.
- [First delivery](/start/first-delivery/) — go from one sentence to a verified merge on one machine.
- [First machine](/start/first-machine/) — establish a readable fleet baseline and a readiness proof.
- [Bootstrap a fleet](/start/fleet-bootstrap/) — create the private store, signed genesis, verified remote, and first convergence.

## What happens around your request

Routine work runs natively. Select CE workflows automatically when they help, and resolve CE only when a selected stage needs it. Startup loads routing guidance without bootstrapping workflow dependencies.

Use `compound-engineering:ce-commit-push-pr` whenever creating a PR or pushing user-requested commits to an existing PR. CE owns one review settlement and CI loop. [Thermos](/skills/thermos/) and [audits or retrospectives](/delivery/audit/) are optional tools for work that benefits from them.

Use native child agents for useful parallel work. Create visible Codex tasks only when the user explicitly requests them. Fleet or account orchestration also requires explicit scope.

Choose both model and reasoning effort deliberately. GPT-6 Sol at `medium` is the ordinary engineering candidate; use Astra when the assignment needs stronger judgment. Supported inheritance can preserve a suitable parent allocation. Disclose an unavailable allocation instead of silently substituting one. The [model routing guide](/what-it-does/control-model-cost/) explains the choice.

## Choose the path

| You want | Start with |
| --- | --- |
| Reviewed code delivery | [First delivery](/start/first-delivery/) |
| Fleet inventory and readiness | [First machine](/start/first-machine/) |
| A new private fleet | [Bootstrap a fleet](/start/fleet-bootstrap/) |
| Both | Install both plugins, then follow the two paths independently |

The delivery system and fleet system each produce value on their own. With both installed, their integration adds readiness-aware placement.

Railyard and Roundhouse provide the implementation evidence behind this way of working. Their [delivery source](https://github.com/novotnyllc/railyard) and [fleet source](https://github.com/novotnyllc/roundhouse) keep releases and review history visible beside the guide.
