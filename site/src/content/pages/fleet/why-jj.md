---
layout: default
title: Why jj
parent: Fleet
nav_order: 6
---

# Why jj

The fleet store uses a jj-colocated Git repository because jj turns conflict, snapshot, change identity, undo, immutability, and remote transport into readable operating primitives.

## Conflict as readable state

A conflict keeps both parents and a usable repository state. The convergence run can compare resolved item values, hold contested keys, and continue with values that agree.

## Auto-snapshot and signing

The next jj operation snapshots the working copy and signs it with the machine's key. Human and agent edits therefore enter the same reviewed path.

## Stable change identity

jj change identity survives amend, rebase, squash, and re-sign while the commit id changes. Journal evidence can name the change across these rewrites.

## Operation log

`jj op restore <op>` gives one machine a precise undo point. The run records its starting operation id in `store.run/`; fleet-wide rollback remains a signed store change through the normal gates.

## Tags and immutability

Remote ancestry and tagged checkpoints supply immutable history. Verification can replay from the last checkpoint while retaining the genesis chain as the trust root.

## Colocated Git transport

The store uses ordinary Git remotes for the hub and optional peer acceleration. The poll floor begins with a lightweight remote-head check; jj namespaces remote-tracking bookmarks per remote.

## Hermetic commands

Repository configuration pins the pager, editor, signing, and environment behavior so scheduled runs have a repeatable command surface.

## Proof point

The source page ties each jj property to a fleet behavior: item-level convergence, signed snapshots, precise undo, checkpoint replay, and ordinary Git transport. Source: `roundhouse/docs/why-jj.md`.

Next: [follow convergence](/fleet/convergence/) or [read trust](/fleet/trust/).
