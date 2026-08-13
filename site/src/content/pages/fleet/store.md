---
layout: default
title: Store
parent: Fleet
nav_order: 1
---

# The fleet store

The fleet store is a jj repository of readable YAML that describes the agent surface each machine should carry and publishes the evidence each machine produced.

## What it holds

| Category | Purpose |
| --- | --- |
| `policy` | cadence, canary, and removal controls |
| `packages` | host-level packages through native managers |
| `plugins` | Claude Code and Codex plugins plus enabled state |
| `skills` | plugin-delivered or standalone skills |
| `agents` | user-scope agent definitions |
| `hooks` | trusted plugin or standalone hooks |
| `mcp_servers` | MCP configuration |
| `config_files` | named harness configuration keys |
| `projects` | project checkouts the fleet tracks |

## Four layers

```text
fleet.yaml                 every machine
os/<platform>.yaml         every platform member
groups/<group>.yaml        ordered group membership
hosts/<machine>.yaml       one machine
```

The fold merges maps by key and replaces scalar values as a unit. Item identity is `<category>.<name>`, so two independent edits can converge cleanly and one shared key produces a visible disagreement.

## Evidence paths

```text
journal/<machine>/<date>.yaml
applied/<machine>.yaml
alerts/<machine>/<stamp>-<slug>.yaml
findings/<machine>/<stamp>-<slug>.yaml
upstreams/<id>/<machine>.yaml
```

Each path has one owning machine. Evidence records what was applied, held, reverted, resolved, or observed. A verdict stays with the host that made it; the replicated journal carries the outcome other hosts need.

## Readable by design

The format is human-editable YAML with comments, clear layer names, and values that can be inspected with ordinary tools. `fleet-explain` shows the winning value and the layer that supplied it.

## Definitions

Logical names map to platform-specific artifacts in `definitions.yaml`. The map carries exceptions; the native manager or plugin source supplies the default name.

## Proof point

The four-layer fold, item identity, evidence paths, and `fleet-explain` output stay together here.

Next: [follow a change](/fleet/convergence/) or [declare desired state](/desired-state/).
