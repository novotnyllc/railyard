---
layout: default
title: Bootstrap a fleet
parent: Start here
nav_order: 4
---

# Bootstrap a fleet

Start with a private store whose first signed fact is the fleet roster. Build the repository before asking it to sign, let the first machine mint its own identity, prove the remote is private, and then publish desired state. That order makes bootstrap the first trust receipt in the operating model.

## The run

The operator asks one trusted machine to create the fleet. Roundhouse prepares an empty colocated `jj` store, mints the node key, makes the self-signed roster commit the genesis, binds a private remote, discovers the host, and runs the first fast convergence. The turn is `fleet-verify-remote`: the first push earns permission only after an unauthenticated probe receives an authentication refusal. The run closes when doctor is clean and the first `fleet-run --fast` publishes host-owned evidence.

## Prepare the configuration

Put the machine, remote, groups, projects, and sync policy in the [Roundhouse configuration](/roundhouse/configuration/), then validate the artifact every fleet command will read:

```sh
roundhouse validate-config
```

Create the remote repository as private. The hub transports signed history; the history itself carries fleet authority.

## Create host 1

Run these verbs in order:

```sh
roundhouse fleet-init
roundhouse fleet-enroll
roundhouse fleet-set-remote <private-store-url>
roundhouse fleet-verify-remote
roundhouse fleet-seed
$EDITOR fleet.yaml
roundhouse fleet-doctor
roundhouse fleet-run --fast
```

`fleet-init` creates the colocated store, repository-local pins, and scaffold while leaving signing and history unset. `fleet-enroll` mints `~/.ssh/roundhouse_node_ed25519`, writes the signing identity, and commits `trust/signers.yaml`; that roster commit is the genesis and produces the `store_id`. `fleet-set-remote` adds or moves `origin`. `fleet-seed` turns discovery into `hosts/<name>.yaml` and `applied/<name>.yaml`, so platform and group facts come from inspected state.

The privacy probe has three meaningful observations: authentication refusal proves the remote is gated, unauthenticated content proves it is public, and an unreachable endpoint remains inconclusive. The first push uses the positive private observation.

## Lift the common intent

After seeding, edit `fleet.yaml` to lift only the values that should apply beyond this host. Keep machine-specific facts in the host layer, then let doctor inspect store, trust, configuration pins, remote posture, roster coherence, and scheduler readiness before the first convergence.

```text
store_id=genesis-opaque
remote=verified-private
seed=host-a platform=macos groups=development
doctor=ready
fleet-run mode=fast result=published
```

## Add the next machine

From an enrolled sponsor, `roundhouse fleet-add host-b` binds roster identity to the configured transport, has the newcomer mint its key, verifies possession, and publishes the roster edit. On a fresh newcomer, preserve the node key outside the bootstrap store, clone the private fleet store into place, then run `fleet-init`, `fleet-enroll`, and `fleet-verify-remote` before convergence.

Continue with [first-machine readiness](/start/first-machine/), [enrollment and TOFU](/roundhouse/security/enrollment-and-tofu/), or [store recovery](/roundhouse/store-recovery/).
