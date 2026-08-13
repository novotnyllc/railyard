---
layout: default
title: Keep machines current
parent: What it does
nav_order: 3
---

# Keep machines current

Keep the agent surface aligned across a five-machine macOS/Linux mix with inventory, item digests, and evidence you can act on.

## Easy path

```text
> Inventory the fleet, show drift, and apply the approved update path.
```

`roundhouse:fleet-inventory` reports the current surface; `roundhouse:fleet-update` plans and applies owned updates through the native manager for each platform.

## What happens

The run validates configuration, collects per-machine evidence, compares desired and observed values, and routes each change through its owner. Plugins, skills, packages, hooks, agents, MCP settings, and projects remain distinct items with their own evidence.

## Proof point

The [fleet inventory reference](/skills/fleet-inventory/) records per-machine evidence and an `in_sync` result. This public proof is summarized as the live five-machine macOS/Linux mix.

## Next

[Distribute a skill](/what-it-does/distribute-a-skill/) or [read the Roundhouse store](/roundhouse/store/).
