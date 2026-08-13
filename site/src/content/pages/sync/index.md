---
layout: default
title: Sync
nav_order: 7
has_children: true
---

# Sync

Delegation works when every machine agrees what an agent is. Declare plugins, skills, MCP servers, hooks, and agent configuration once; converge every enrolled host on the resolved identity; retain evidence of each manager action. An agent can land on any ready machine and find the operating surface the task expects. Roundhouse makes that mechanism concrete, bringing a published skill to each host within one fast interval.

## The alignment loop

Align the declared category with the native action that can prove it. Desired-state categories map one-to-one onto the manager verbs for Claude and Codex: `plugins`, `skills`, `agents`, `hooks`, `mcp_servers`, and `config_files`. Each item identity carries marketplace SHA plus version, so a re-tagged artifact produces a new decision. Codex hook approval runs again for every plugin install or update; the `hooks` category stays held until that trust gate clears.

One owned scheduler entry per host runs a fast pass at about 20 minutes with ±5 minutes of host-name-seeded jitter and a full pass at about 12 hours with ±90 minutes of jitter. The name seed spreads the fleet across the window while preserving a stable cadence for each machine.

Operate a personal fleet's agent toolchain with package-manager discipline: pull-based convergence, canary evidence before a change fans out further, and a signed trust ratchet that raises confidence without standing up a certificate authority. Roundhouse supplies this mechanism.

![Skill-sync convergence loop from one host's publication through the signed store, fast pass, fold, manager verb, hook approval, journal, and the same skill on every machine.](/diagrams/m7-skill-sync.svg)

The loop's text fallback is the receipt below: each host records `applied` or `satisfied`, and a hook-approval hold preserves the prior applied state.

## Worked receipt

```text
item=skills.my-review desired_sha=sha256:7c1a... desired_version=2.4.0
host-a  os=macos  fast=2026-08-13T09:20:14Z  result=applied manager=codex
host-b  os=linux   fast=2026-08-13T09:22:01Z  result=applied manager=claude
host-c  os=wsl     fast=2026-08-13T09:24:33Z  result=satisfied manager=codex
host-d  os=windows fast=2026-08-13T09:25:17Z  result=satisfied manager=claude
```

Read the receipt as an operational state. `applied` means the manager changed the item and journaled the exact identity. `satisfied` means the identity already matched. `held` names the trust or ownership decision that still needs evidence; it keeps the prior applied state.

## Explore the state surface

- [State alignment](/sync/state-alignment/) — category, manager verb, identity, and receipt semantics.
- [Fleet agents](/skills/fleet-agents/) — the skill that owns agent-surface inventory and desired-state sync.
- [Roundhouse convergence](/roundhouse/convergence/) — the signed pull, gate, apply, and journal loop.

Roundhouse is the existence proof. Its [source repository](https://github.com/novotnyllc/roundhouse), [releases](https://github.com/novotnyllc/roundhouse/releases), and [review trail](https://github.com/novotnyllc/roundhouse/pulls) carry the public implementation evidence.
