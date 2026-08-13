---
layout: default
title: Run work on another machine
parent: What it does
nav_order: 8
---

# Run work on another machine

A delivery needs Linux tooling while the current workstation is a Mac. Ask the candidate machine to prove project, agent, and transport readiness, then bind the selected destination to the delivery contract. Work starts where the prerequisites are current, and the same delivery gates travel with it.

## Easy path

```text
> Run this delivery on the machine that is ready for it.
```

`railyard:orchestrate` combines the delivery contract with `roundhouse:fleet-readiness` before placement.

## What happens

The destination produces host, task, and transport readiness evidence. The dispatcher binds the selected destination to the task, starts dependency-ready lanes, and keeps the same delivery gates inside the placed lane.

## Proof point

The [fleet-readiness reference](/skills/fleet-readiness/) defines a placement table, and [Orchestrate](/skills/orchestrate/) consults readiness before creating a remote work task.

## Next

[Administer a remote machine](/what-it-does/administer-remotely/) or [read the fleet readiness reference](/skills/fleet-readiness/).
