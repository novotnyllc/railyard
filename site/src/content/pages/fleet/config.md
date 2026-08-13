---
layout: default
title: Config
parent: Fleet
nav_order: 5
---

# Configuration

One validated JSON file describes machines, projects, capabilities, agent artifacts, auth artifacts, and platform package managers; the store carries fleet-wide desired-state policy.

## Resolution

```text
ROUNDHOUSE_CONFIG
XDG_CONFIG_HOME/roundhouse/config.json
$HOME/.config/roundhouse/config.json
```

`ROUNDHOUSE_IDENTITY` resolves the separate machine identity file through the same precedence pattern.

## Main blocks

| Block | What it describes |
| --- | --- |
| `machines` | platform, transport, groups, package managers, project root, and privilege broker |
| `projects` | source identifier, relative checkout path, groups, and handoff flags |
| `capabilities` | agent availability, provider, source, groups, and required artifacts |
| `agent_artifacts` | definitions, instructions, and allowlisted harness settings |
| `auth_artifacts` | credential presence, strategy, portability, mode, and verification commands |
| `skill_roots` | additional skill locations and their managers |
| `policy` | forward-looking policy data read by the owning surface |

## Machine transport

Supported platforms are `macos`, `linux`, `wsl`, and `windows`. Supported transports are `local`, `ssh`, and `codex-remote-control`, with cross-field checks tying the transport to the platform.

## Artifact safety

Paths are relative where a project checkout is described. Auth entries carry references and verification commands; secret values remain in the configured custody system. Privilege-broker blocks use exact key sets and bounded network fields.

## Fleet policy location

The store's `fleet.yaml` carries cadence, jitter, canary, removal, nudge, and retention settings. The local JSON file describes the machine and its capabilities; the signed store describes shared desired state.

## Validation

```sh
roundhouse validate-config
```

The validator checks version, required blocks, cross-field rules, exact-key sections, bounded strings, and identity data when present.

## Proof point

The source configuration reference documents resolution order, machine cross-field checks, artifact shapes, URL predicates, and consuming skills. Source: `roundhouse/docs/config.md`.

Next: [read the operating commands](/fleet/operating/) or [understand the store](/fleet/store/).
