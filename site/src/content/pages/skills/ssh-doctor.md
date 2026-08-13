---
layout: default
title: SSH Doctor
parent: Skills
nav_order: 10
---

# SSH Doctor

Diagnose remote transport from the inside out: prove local configuration and identity, follow the connection through the login shell, and assign the first failing layer to its repair owner. This gives operators a precise intervention grounded in the failing layer.

## What it adds

SSH Doctor applies that layered practice. It checks local configuration, target reachability, the login shell, service state, keys, certificates, and the selected transport path in a fixed order.

## How it works

Commands run through the target user's login shell with bounded timeouts. The report separates transport, authentication, shell, and service findings so the owning repair stays precise.

```text
> Diagnose host-a from loopback through the login shell, then show the owning repair surface.
loopback=passed  config=passed  reachability=passed
identity=verified  login_shell=passed
service=held reason=listener-not-ready owner=remote-admin
```

## Scope

SSH Doctor diagnoses transport health. Remote mutation belongs to the explicitly selected remote administration lane.

## Source

Ships in the `roundhouse` plugin.

## Proof point

```text
target=host-a layer=service
command_timeout=bounded identity=verified
finding=listener-not-ready owner=remote-admin
result=diagnosed
```

Next: [administer remotely](/what-it-does/administer-remotely/).
