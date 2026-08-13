---
layout: default
title: Deliver
parent: Skills
nav_order: 1
---

# Deliver

Run each software change as one bounded delivery: name the outcome, preserve the evidence chain, and stay with it through merge and a real post-merge check. The payoff is software that arrives with proof of what changed and where it landed.

## What it adds

Deliver carries that operating practice. It selects the route from the requested artifact, invokes model routing before work starts, and hands implementation to the workflow engine. It owns the requested terminal boundary and the delivery tail that settles review, branch currency, merge, and proof.

## How it works

Route selection distinguishes plan, diagnosis, local implementation, and full delivery outcomes. For implementation, isolated work boundaries, focused checks, Thermos review, and the configured GitHub flow create the evidence chain.

```text
> Fix the retry path in the webhook worker and get it merged with post-merge proof.
route=implementation  model=gpt-5.6-luna  effort=max
scope=one-worktree  review=thermos-pair
tail=settlement -> merge -> ancestry -> focused-check
stop=report signed commit, merge, and proof separately
```

## Scope

One host-local implementation or pull-request lane belongs here. Multi-lane or cross-host placement belongs to [Orchestrate](/skills/orchestrate/).

## Source

Ships in the `railyard` plugin.

## Proof point

```text
merge=4e1d... base=main ancestry=verified
check=node --test test/retry.test.mjs exit=0
receipt=post-merge-proof status=verified
```

Next: [read the lifecycle](/delivery/lifecycle/).
