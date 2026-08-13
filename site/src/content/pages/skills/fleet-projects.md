---
layout: default
title: Fleet projects
parent: Skills
nav_order: 14
---

# Fleet projects

Earn delivery placement one repository at a time. Verify source identity, protect the working tree, and expose handoff eligibility as explicit evidence so work starts on a checkout prepared to carry it.

## What it adds

Fleet projects applies that practice to every configured project. It checks source identity, checkout path, Git state, branch state, working tree, and handoff eligibility on the selected machine.

## How it works

Distinct rows for repository identity, path safety, checkout state, and the selected transport establish delivery readiness. The report carries each exact finding to the next owner.

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
