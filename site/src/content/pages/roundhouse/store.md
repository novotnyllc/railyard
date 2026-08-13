---
layout: default
title: Store
parent: Roundhouse
nav_order: 1
---

# One repo, four layers, readable evidence

The Roundhouse store is one jj repository with one bookmark and host-local evidence paths. It gives a fleet a shared desired state while each machine remains the only writer for its own journal, applied record, alert, finding, and upstream evidence.

## Four layers

Every category can be a file or directory at every layer:

```text
fleet.yaml                 every machine
os/<platform>.yaml         every platform member
groups/<group>.yaml        ordered group membership
hosts/<name>.yaml          one machine
```

The fold merges maps by key. Scalar values replace as a unit. An explicit `absent` value removes exactly the addressed item from the effective set; a word inside a different string stays data.

## Worked fold

Fleet layer:

```yaml
packages:
  legacy-tool:
    version: "1.0"
  stable-tool:
    version: "4.2"
metadata:
  note: "The word absent is ordinary text here."
```

Host layer for `host-a`:

```yaml
packages:
  legacy-tool: absent
  stable-tool:
    version: "4.3"
```

Effective state:

```yaml
packages:
  stable-tool:
    version: "4.3"
metadata:
  note: "The word absent is ordinary text here."
```

The knockout removes `packages.legacy-tool`, the map merge retains `metadata.note`, and the scalar version under `stable-tool` is replaced as one value.

## Definitions and categories

`definitions.yaml` maps logical names to concrete platform artifacts outside the fold. Its digest namespace is separate, so changing a definition creates a definition review without invalidating an item verdict whose logical value is unchanged.

The closed categories are `policy`, `packages`, `plugins`, `skills`, `agents`, `hooks`, `mcp_servers`, `config_files`, and `projects`. An unknown category holds every item under it and alerts by name, giving the operator a precise correction surface.

## Receipt paths

```yaml
# hosts/host-a.yaml
skills:
  my-review:
    version: 2.4.0
    marketplace_sha: sha256:7c1a...
```

```yaml
# journal/host-a/2026-08-13.yaml
- item: skills.my-review
  digest: sha256:7c1a...
  result: applied
  manager: codex
  observed_at: 2026-08-13T09:21:04Z
```

The paths are ordinary YAML. `fleet-explain` can show the winning layer, the folded value, and the digest that produced the journal line.

Next: [follow convergence](/roundhouse/convergence/) or [run the operator surface](/roundhouse/operating/).
