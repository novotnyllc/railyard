---
layout: default
title: First delivery
parent: Start here
nav_order: 2
---

# First delivery

Prerequisite: [install railyard and roundhouse first →](/start/install/)

Start with a real change and carry it to observable proof. One sentence on the machine you already use can produce a reviewed, merged result plus a post-merge receipt, giving you a complete delivery loop before you add fleet complexity.

## Easy path

```text
> Fix the retry path in the webhook worker and get it merged.
```

This request names the outcome; `railyard:deliver` is the working front door that carries it.

## What happens

1. The request is classified and [model routing](/delivery/model-routing/) freezes a model and effort for the work unit.
2. The implementation workflow plans and changes the source in its own working boundary.
3. [Thermos](/skills/thermos/) runs correctness and code-quality review lenses against the same packet.
4. The branch, pull request, checks, independent review, and merge are settled.
5. The merged commit is checked for reachability from the base branch and the smallest applicable post-merge check runs.

```text
route=implementation model=gpt-5.6-luna effort=max
claim=settled review=thermos-synthesis
merge=4e1d... ancestry=verified
post_merge_check=node --test test/retry.test.mjs exit=0
result=verified
```

The first example stays same-harness by default. Dispatching to Codex is opt-in and requires the Codex CLI already set up separately.

The post-merge check is stack-specific and comes from the repository's existing tooling. A Python service might use `pytest -q` instead of the Node example above.

## Proof point

The [delivery lifecycle](/delivery/lifecycle/) documents the observable terminal pair: `git merge-base --is-ancestor <merge-commit> origin/<base>` plus a real post-merge check.

## Scope

The first delivery is a complete one-machine path. Add fleet placement when another host provides real leverage through [run work on another machine](/what-it-does/run-work-on-another-machine/).

## Troubleshooting

- **A skill is not found:** return to [Install](/start/install/) and confirm the plugin listing before restarting the harness.
- **The repository has no GitHub remote:** add or verify `origin` before asking for a pull request; a local delivery can still run checks and report the missing publish step.
- **The repository has no test suite:** the post-merge check uses the smallest existing verification command, or reports that no focused check is available.
- **The review gate is stuck:** inspect [delivery gates](/delivery/gates/) for unresolved threads, settlement timing, or a missing post-merge proof.

## Terms used here

- [Carrier](/delivery/model-routing/) — the harness or worker surface that executes a routed unit.
- [Transport](/delivery/model-routing/) — the explicit path used to reach the selected execution surface.
- [Adapter](/delivery/model-routing/) — the bridge that turns the route decision into a harness invocation.
- [Work class](/delivery/model-routing/) — the role that determines the route and evidence required.
- [Budget](/what-it-does/control-model-cost/) — the spend constraint recorded with the dispatch.
- [Thermos](/skills/thermos/) — the paired review skill used during delivery.
- [React Doctor](/delivery/gates/) — the project-appropriate browser-visible quality check for React surfaces.
