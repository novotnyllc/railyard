---
layout: default
title: Store
parent: Roundhouse
nav_order: 1
---

# One repo, four layers, readable evidence

Keep fleet intent shared and host evidence sovereign. Layer broad defaults with platform, group, and machine decisions, then let each host remain the only writer for its own journal, applied record, alert, finding, and upstream evidence. Operators get one readable answer to “what should this machine carry?” and a trustworthy trail of what it actually did.

The Roundhouse store realizes that model as one jj repository with one bookmark and host-local evidence paths.

## Four layers

Express policy at the broadest useful scope and override it only where the fleet genuinely differs. Every category can be a file or directory at every layer:

```text
fleet.yaml                 every machine
os/<platform>.yaml         every platform member
groups/<group>.yaml        ordered group membership
hosts/<name>.yaml          one machine
```

The fold merges maps by key. Scalar values replace as a unit. An explicit `absent` value removes exactly the addressed item from the effective set; a word inside a different string stays data.

## Worked fold

An anonymized host is carrying version `1.0` of a legacy tool and version `4.2` of a stable tool. The fleet operator needs to retire the legacy tool on that host while moving the stable tool to `4.3` and retaining an ordinary metadata note. The shared fleet layer starts here:

```yaml
packages:
  legacy-tool:
    version: "1.0"
  stable-tool:
    version: "4.2"
metadata:
  note: "The word absent is ordinary text here."
```

The host layer records only the two intentional differences for `host-a`:

```yaml
packages:
  legacy-tool: absent
  stable-tool:
    version: "4.3"
```

The fold gives the host this effective state:

```yaml
packages:
  stable-tool:
    version: "4.3"
metadata:
  note: "The word absent is ordinary text here."
```

The outcome is precise: the knockout removes `packages.legacy-tool`, the map merge retains `metadata.note`, and the scalar version under `stable-tool` is replaced as one value.

## Definitions and categories

Keep logical intent stable across platforms. `definitions.yaml` maps logical names to concrete platform artifacts outside the fold. Its digest namespace is separate, so changing a definition creates a definition review while an item verdict with an unchanged logical value remains valid.

The closed categories are `policy`, `packages`, `plugins`, `skills`, `agents`, `hooks`, `mcp_servers`, `config_files`, and `projects`. An unknown category holds every item under it and alerts by name, giving the operator a precise correction surface.

## Receipt paths

When the operator later asks why a review skill appeared on `host-a`, the desired-state path and host-owned journal line meet at the same digest:

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

These paths are ordinary YAML. `fleet-explain` can show the winning layer, the folded value, and the digest that produced the journal line.
