---
layout: default
title: Run work on another machine
parent: Practices
nav_order: 8
---

# Run work on another machine

A delivery needs Linux tooling while the current workstation is a Mac. Explicitly select remote placement, verify the required project, agent, and transport readiness, and preserve the requested acceptance boundary on that host. A local request stays local even when a fleet catalog exists.

## Easy path

```text
> Create a new task for this delivery on the Linux machine, and get the change merged there.
```

`railyard:orchestrate` uses `roundhouse:fleet-readiness` before placement. This example explicitly authorizes a new visible task. Native subagents remain the default for bounded work inside an existing task; remote placement does not independently authorize visible-task creation.

## The run

The operator asks for a Linux-bound delivery. Roundhouse verifies that the chosen host can receive it, and Railyard carries the objective, constraints, and acceptance checks into the supported destination surface. The selected CE workflow owns PR review settlement and CI there. Because this example authorizes merge, completion includes merge confirmation and post-merge proof.

## What happens

The destination must expose the required task or worker capability; a checkout on disk or a working SSH command alone does not establish a remote agent. If the required placement surface is unavailable, report the limitation without silently changing host, account, provider, or model.

## Proof point

The [fleet-readiness reference](/skills/fleet-readiness/) defines a placement table, and [Orchestrate](/skills/orchestrate/) consults readiness before creating a remote work task.

## Next

[Administer a remote machine](/what-it-does/administer-remotely/) or [read the fleet readiness reference](/skills/fleet-readiness/).
