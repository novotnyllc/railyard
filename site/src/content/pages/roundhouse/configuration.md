---
layout: default
title: Configuration
parent: Roundhouse
nav_order: 1
---

# One configuration, every fleet decision

Keep the operator-owned map small enough to read and complete enough to drive every skill. `config.json` names machines, projects, convergence policy, capability placement, agent surfaces, and update behavior once; inventory, readiness, placement, and sealed plans consume the same artifact.

## The run

The operator adds an anonymized host and one project, validates the file, and asks readiness to use it. Roundhouse resolves platform, transport, groups, project checkout, handoff binding, canary policy, and required capabilities from that one map. The turn is validation before any collection or mutation. The run closes when the host, task, and transport rows cite the same configuration digest.

## Location and validation

The normal path is `${XDG_CONFIG_HOME:-$HOME/.config}/roundhouse/config.json`. Set `ROUNDHOUSE_CONFIG` to an explicit file when a separate fleet or test fixture needs its own map; every command resolves the same override.

```sh
ROUNDHOUSE_CONFIG=/path/to/fleet.json roundhouse validate-config
```

Validation checks schema version, platform and transport combinations, machine references, paths, capability sources, policy values, auth strategies, and privilege-broker shape before the file becomes operating input.

## Working shape

```json
{
  "version": 1,
  "machines": {
    "host-a": {
      "platform": "macos",
      "transport": "ssh",
      "ssh_alias": "configured-host-a",
      "groups": ["development"],
      "package_managers": ["homebrew"],
      "dev_root": "~/dev"
    },
    "host-w": {
      "platform": "windows",
      "transport": "codex-remote-control",
      "codex_host": "saved-windows-host",
      "codex_control_project": "web-app",
      "groups": ["development"],
      "package_managers": ["winget"],
      "dev_root": "~/dev",
      "privilege_broker": {
        "automation_transport": {
          "mode": "windows-sftp",
          "host": "windows.example.invalid",
          "port": 22,
          "request_user": "RoundhouseRequest",
          "request_sid": "S-1-5-21-1000-1001-1002-2001",
          "pinned_host_key_fingerprint": "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          "management_networks": ["192.0.2.0/24"]
        }
      }
    }
  },
  "projects": {
    "web-app": {
      "source": "owner/web-app",
      "path": "web-app",
      "groups": ["development"],
      "codex": true
    },
    "handoffs": {
      "source": "owner/private-handoffs",
      "path": "coordination/handoffs",
      "groups": ["development"],
      "codex": true
    }
  },
  "handoff_project": "handoffs",
  "sync": {
    "enabled": true,
    "store_path": "~/.config/roundhouse/store",
    "remote": {"url": "git@configured-git-host:owner/private-fleet-store.git"},
    "cadence_hours": 24,
    "canary_group": "development",
    "canary_wait_hours": 24
  },
  "capabilities": {
    "review-system": {
      "groups": ["development"],
      "agents": ["codex", "claude"],
      "provider": "plugin",
      "source": "review-system"
    }
  },
  "skill_roots": [
    {
      "id": "shared-agents",
      "path": "~/.agents/skills",
      "manager": "mixed",
      "agents": ["codex", "claude"],
      "groups": ["development"]
    }
  ],
  "agent_artifacts": [
    {
      "id": "codex-instructions",
      "path": "~/.codex/AGENTS.md",
      "kind": "instruction",
      "agents": ["codex"],
      "groups": ["development"]
    }
  ],
  "policy": {
    "updates": {"cleanup": false, "autoremove": false},
    "projects": {"update": "ff-only"}
  }
}
```

## Read the sections by responsibility

- `machines.<name>` binds a roster name to platform, transport, groups, managers, development root, and any bounded privilege lane.
- `projects.<name>` binds source identity to a relative checkout and eligible groups. `handoff_project` selects the project that carries durable coordination artifacts.
- `sync` owns store location, remote, cadence, canary group, and `canary_wait_hours`; 24 hours is the shipped canary default and fallback.
- `capabilities.<name>` maps a logical capability to eligible groups, harnesses, provider, source, and any required auth artifacts.
- `skill_roots[]` and `agent_artifacts[]` declare portable skill/config surfaces with their owning harnesses and groups.
- `policy` records update cleanup and project movement rules. Host-local `worker` data is generated for bounded execution rather than authored as shared fleet intent.

```text
config_digest=sha256:12af...
host=host-w platform=windows transport=codex-remote-control
project=web-app handoff=handoffs capability=review-system
canary_group=development wait=24h
validation=passed
```

Use the [bootstrap walkthrough](/start/fleet-bootstrap/) to turn this map into the first signed store, then follow [fleet readiness](/skills/fleet-readiness/) to see how its fields become placement evidence.
