---
layout: default
title: First machine
parent: Start here
nav_order: 3
---

# First machine

Give a machine a readable baseline, a signed fleet identity, and a readiness result before placing work on it.

## Easy path

```text
> Set up the fleet on this machine, then show me its readiness.
```

`roundhouse` inventories the host, validates the configuration, establishes the store when you opt into convergence, and reports the rows that support a placement decision.

## What happens

- The local configuration describes platform, transport, projects, capabilities, and auth artifacts.
- The fleet store records desired agent state in readable layers.
- A host identity signs its store contributions and publishes host-keyed evidence.
- `fleet-readiness` combines project, agent, inventory, and auth evidence into a placement result.

## Proof point

The [fleet-readiness reference](/skills/fleet-readiness/) describes a three-part readiness surface: host, task, and transport evidence. The dispatcher consults that result before placing work.

## Scope

The first machine can remain a one-machine fleet. Add a second machine when placement, parity, or shared desired state earns its place.

Next: [declare desired state](/what-it-does/declare-desired-state/).
