---
layout: default
title: Fleet projects
parent: Skills
nav_order: 14
---

# Fleet projects

Fleet projects separates repository readiness, checkout ownership, and delivery handoff evidence for every configured project.

## What it adds

The skill checks source identity, checkout path, Git state, branch state, working tree, and handoff eligibility on the selected machine.

## How it works

A project becomes delivery-ready through distinct rows for repository identity, path safety, checkout state, and the selected transport. The report carries the exact finding to the next owner.

```text
> Check the configured project before placing a delivery on host-a.
source_identity=verified  checkout=clean  branch=main
path_safety=passed  transport=ready
handoff=delivery  result=eligible
```

## Scope

Fleet projects owns project checkouts and handoff readiness. It preserves dirty or divergent working state as an explicit finding for the operator.

## Source

Ships in the `roundhouse` plugin.

## Proof point

```text
project=web-app host=host-a
origin=verified checkout=clean handoff=eligible
evidence=projects/host-a.yaml
result=ready
```

Next: [run work on another machine](/what-it-does/run-work-on-another-machine/).
