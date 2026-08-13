---
layout: default
title: First delivery
parent: Start here
nav_order: 2
---

# First delivery

Start with a real change and carry it to observable proof. One sentence on the machine you already use can produce a reviewed, merged result plus a post-merge receipt, giving you a complete delivery loop before you add fleet complexity.

## Easy path

```text
> Fix the retry path in the webhook worker and get it merged.
```

This request names the outcome; `railyard:deliver` is the working front door that carries it.

## What happens

1. The request is classified and model routing freezes a model and effort for the work unit.
2. The implementation workflow plans and changes the source in its own working boundary.
3. Thermos runs correctness and code-quality review lenses against the same packet.
4. The branch, pull request, checks, independent review, and merge are settled.
5. The merged commit is checked for reachability from the base branch and the smallest applicable post-merge check runs.

```text
route=implementation model=gpt-5.6-luna effort=max
claim=settled review=thermos-synthesis
merge=4e1d... ancestry=verified
post_merge_check=node --test test/retry.test.mjs exit=0
result=verified
```

## Proof point

The [delivery lifecycle](/delivery/lifecycle/) documents the observable terminal pair: `git merge-base --is-ancestor <merge-commit> origin/<base>` plus a real post-merge check.

## Scope

The first delivery is a complete one-machine path. Add fleet placement when another host provides real leverage through [run work on another machine](/what-it-does/run-work-on-another-machine/).

Next: [read the full lifecycle](/delivery/lifecycle/).
