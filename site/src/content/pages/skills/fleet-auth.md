---
layout: default
title: Fleet auth
parent: Skills
nav_order: 15
---

# Fleet auth

Fleet auth reports the presence and health of configured credential artifacts while keeping their contents inside their custody surface.

## What it adds

The skill verifies metadata, paths, file modes, native stores, encrypted references, and reauthentication commands for the selected machine.

## How it works

Each artifact declares a strategy, portability class, verification command, and optional reauthentication path. The report distinguishes healthy, missing, stale, and held artifacts for readiness and operations.

```text
> Check the configured auth artifacts for host-a and show presence without revealing values.
artifact=github-cli strategy=reference state=present mode=0600
artifact=codex-session strategy=native-store state=healthy
artifact=package-feed strategy=reference state=held reason=reauthentication
secrets=withheld
```

## Scope

Fleet auth owns artifact metadata and verification. Secret values remain with the configured custody system.

## Source

Ships in the `roundhouse` plugin.

## Proof point

```text
host=host-a artifact=github-cli
presence=present mode=0600 verification=passed
value=withheld custody=operator
result=ready
```

Next: [read the 1Password integration](/integrations/1password/).
