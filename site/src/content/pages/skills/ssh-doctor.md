---
layout: default
title: SSH Doctor
parent: Skills
nav_order: 10
---

# SSH Doctor

SSH Doctor turns remote transport failures into a layered diagnosis that begins with identity and loopback evidence.

## What it adds

The skill checks local configuration, target reachability, the login shell, service state, keys, certificates, and the selected transport path in a fixed order.

## How it works

Commands run through the target user's login shell with bounded timeouts. The report separates transport, authentication, shell, and service findings so the owning repair stays precise.

## Scope

SSH Doctor diagnoses transport health. Remote mutation belongs to the explicitly selected remote administration lane.

## Source

Ships in the `roundhouse` plugin.

## Proof point

The source skill defines loopback-first diagnosis, login-shell execution, identity confirmation, and bounded process handling.

Next: [administer remotely](/what-it-does/administer-remotely/).
