---
layout: default
title: Fleet auth
parent: Skills
nav_order: 15
---

# Fleet auth

Treat credentials as custody-bound capabilities: verify presence, health, and recovery metadata while their values remain inside the system entrusted with them. Readiness becomes visible while secret custody stays intact.

## What it adds

Fleet auth applies that practice to the selected machine. It verifies metadata, paths, file modes, native stores, encrypted references, and reauthentication commands.

## How it works

Each artifact declares a strategy, portability class, verification command, and optional reauthentication path. The resulting readiness report distinguishes healthy, missing, stale, and held artifacts for operations.

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
