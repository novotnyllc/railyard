---
layout: default
title: Keep machines current
parent: Practices
nav_order: 3
---

# Keep machines current

A four-host macOS/Linux reference fleet has accumulated one stale skill, two package updates, and a project checkout that needs attention. Inventory the fleet, route each item to its owner, and apply approved updates through native managers. The agent surface stays aligned, with digests and per-machine evidence an operator can act on.

## Easy path

```text
> Inventory the fleet, show drift, and apply the approved update path.
```

`roundhouse:fleet-inventory` reports the current surface; `roundhouse:fleet-update` plans and applies owned updates through the native manager for each platform.

## The run

The operator asks which parts of the enrolled fleet have drifted and who owns each correction. Roundhouse inventories every host, compares desired and observed item identities, and routes approved changes through the native manager that already owns them. The turn is item-level ownership: a stale skill, package, project, or harness remains a distinct decision instead of becoming one opaque “update.” The run closes when each machine reports `in_sync`, `ready`, `applied`, `satisfied`, or an actionable held result. [Read the historical five-host bring-up](/why-railyard/).

## What happens

The run validates configuration, collects per-machine evidence, compares desired and observed values, and routes each change through its owner. Plugins, skills, packages, hooks, agents, MCP settings, and projects remain distinct items with their own evidence.

## Proof point

The [fleet inventory reference](/skills/fleet-inventory/) records per-machine evidence and an `in_sync` result. The public guide uses anonymized labels for the four enrolled reference hosts.

## Next

[Distribute a skill](/what-it-does/distribute-a-skill/) or [read the Roundhouse store](/roundhouse/store/).
