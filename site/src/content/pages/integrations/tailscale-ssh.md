---
layout: default
title: Tailscale SSH
parent: Integrations
nav_order: 5
---

# Tailscale SSH integration

Tailscale SSH adds an authenticated transport path for reaching an enrolled machine; the core system operates fully without it.

## Easy path

```text
> Check the selected transport, confirm the machine identity, and start the remote lane.
```

## What it adds

The fleet registry can use a Tailscale address when the machine advertises one. Remote administration still runs its identity, shell, tmux, and evidence checks through the named lane.

## The seam

Tailscale supplies transport. Fleet trust, readiness, and delivery remain owned by their respective systems, so the transport choice stays visible in the route record.

## Proof point

The [Remote Mac reference](/skills/remote-mac/) describes named transport, host identity checks, and the transport field carried by machine configuration.

## Next

[Administer remotely](/what-it-does/administer-remotely/) or [read fleet configuration](/fleet/config/).
