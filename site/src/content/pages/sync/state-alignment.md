---
layout: default
title: State alignment
parent: Sync
nav_order: 1
---

# What converges, per harness

Delegation stays dependable when Claude and Codex interpret the same declared agent surface on every machine. Align each desired item with its native manager verb, stable SHA+version identity, and journal outcome; a host can then explain exactly what changed and why it is ready.

## Manager-verb table

| Category | Claude manager verb | Codex manager verb | `satisfied` means |
| --- | --- | --- | --- |
| `plugins` | `claude plugin install|update` | `codex plugin add|update` | Installed payload resolves to the desired marketplace SHA and version |
| `skills` | `claude skill install|update` | `codex skill install|update` | The skill bytes and declared version match the folded item identity |
| `agents` | user-scope agent install/update | user-scope agent install/update | The agent definition digest matches the desired value |
| `hooks` | hook install plus trust check | hook install plus approval check | The hook bytes match and the harness approval is current |
| `mcp_servers` | configured server entry | configured server entry | The allowlisted endpoint and settings digest match |
| `config_files` | allowlisted key update | allowlisted key update | The selected key/value digest matches without touching unrelated keys |

Let the category own the verb and the full identity own satisfaction. A source refresh does not masquerade as an applied item, and a version match with a changed marketplace SHA does not satisfy the identity.

## One item, end to end

Follow one item from declaration to durable evidence. The `skills.my-review` item begins in `fleet.yaml`, gets folded with the platform, group, and host layers, and then resolves its logical definition. The receiving host selects the manager verb for its harness, installs or updates the exact payload, re-runs hook approval when the item is a plugin dependency, and journals the result. On the next pass, the same identity produces a no-op `satisfied` record.

```yaml
items:
  skills:
    my-review:
      version: 2.4.0
      marketplace_sha: sha256:7c1a...
      manager: native
      hook_approval: required
```

```yaml
item: skills.my-review
desired_sha: sha256:7c1a...
desired_version: 2.4.0
manager: codex
result: applied
observed_at: 2026-08-13T09:21:04Z
---
item: skills.my-review
desired_sha: sha256:7c1a...
desired_version: 2.4.0
manager: codex
result: satisfied
observed_at: 2026-08-13T09:41:16Z
```

The receipt separates item identity from the current manager, preserving a trustworthy decision across harnesses. A future re-tag changes the SHA and creates a new review, even when the version string remains `2.4.0`.
