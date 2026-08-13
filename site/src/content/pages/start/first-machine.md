---
layout: default
title: First machine
parent: Start here
nav_order: 3
---

# First machine

Make a machine earn placement through readable state and current evidence. Give it a baseline, a signed fleet identity, and a readiness result first; every later dispatch can then rely on an explicit operating contract.

## Easy path

```text
> Set up the fleet on this machine, then show me its readiness.
```

This plain-language request activates the mechanism: `roundhouse` inventories the host, validates the configuration, establishes the store when you opt into convergence, and reports the rows that support a placement decision.

## What happens

- The local configuration describes platform, transport, projects, capabilities, and auth artifacts.
- The Roundhouse store records desired agent state in readable layers.
- A host identity signs its store contributions and publishes host-keyed evidence.
- `fleet-readiness` combines project, agent, inventory, and auth evidence into a placement result.

```text
host=host-a os=macos state=ready
task=delivery-opaque-01 state=ready
transport=ssh state=ready
placement=allowed evidence=complete
```

## Proof point

The [fleet-readiness reference](/skills/fleet-readiness/) describes a three-part readiness surface: host, task, and transport evidence. The dispatcher consults that result before placing work.

## Scope

A one-machine fleet is a complete first operating surface. Add a second machine when placement, parity, or shared desired state earns its place.

## Troubleshooting

- **The agent cannot reach the host:** run [SSH Doctor](/skills/ssh-doctor/) and confirm the configured SSH name resolves before retrying enrollment.
- **Enrollment expired or was rejected:** inspect the trust receipt, renew the enrollment through [the trust ratchet](/roundhouse/security/trust-ratchet/), and keep the prior authority until the new evidence passes.
- **The sponsor channel is unreachable:** restore the already-trusted channel and repeat the sponsor-initiated flow; do not substitute an unverified route.
- **Key generation fails:** generate the key on the target host, keep the private key there, and ask [Fleet hosts](/skills/fleet-hosts/) to restart the enrollment ceremony.
