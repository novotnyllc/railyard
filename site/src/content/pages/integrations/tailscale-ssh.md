---
layout: default
title: Tailscale SSH
parent: Integrations
nav_order: 5
---

# Tailscale SSH integration

Choose transport as an explicit part of the delivery route, then verify machine identity and readiness independently. This keeps remote work fast, fleet trust authoritative, and the route record clear enough to explain later.

The optional Tailscale SSH integration supplies an authenticated transport path for reaching an enrolled machine; the core system remains fully operational on its own.

## Easy path

An operator is about to open a remote channel and wants proof that the selected address reaches the enrolled machine through the intended transport:

```text
> Check the selected transport, confirm the machine identity, and start the remote channel.
```

## What it adds

Use the advertised address while preserving the full readiness check. The fleet registry can use a Tailscale address when the machine advertises one. Remote administration still runs its identity, shell, tmux, and evidence checks through the named channel.

## The seam

Keep the seam narrow: Tailscale supplies transport. Fleet trust, readiness, and delivery remain owned by their respective systems, so the transport choice stays visible in the route record.

## Proof point

The [Remote Mac reference](/skills/remote-mac/) describes named transport, host identity checks, and the transport field carried by machine configuration.

## Next

[Administer remotely](/what-it-does/administer-remotely/) or [read the Roundhouse store](/roundhouse/store/).
