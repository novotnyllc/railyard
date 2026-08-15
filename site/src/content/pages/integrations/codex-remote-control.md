---
layout: default
title: Codex remote control
parent: Integrations
nav_order: 6
---

# Codex remote control

Use Codex Desktop as a visible native execution surface when a Windows host needs app-level work in a saved project. Match the configured host and native path immediately before each operation, create a fresh task, bind its route, verify the executor bytes, and archive the task after its receipt returns.

## The run

The operator asks for one bounded native Windows operation. Roundhouse checks host, task, and transport readiness; discovers the task-control surface; matches one saved project by configured host and exact native path; and creates a fresh local-environment task with the admitted model and effort. The turn is the exact saved-project match. The run closes when the native canary and requested postcondition pass, temporary payloads are gone, and the creating controller archives that task.

## Configure the lane

```json
{
  "machines": {
    "host-w": {
      "platform": "windows",
      "transport": "codex-remote-control",
      "codex_host": "saved-windows-host",
      "codex_control_project": "web-app",
      "expected_hostname": "configured-windows-hostname",
      "expected_user": "configured-windows-user"
    }
  }
}
```

The [Roundhouse configuration](/roundhouse/configuration/) supplies the host and project names. A target with `wsl_interop_via` uses its WSL sibling for CLI-shaped work; Codex remote control owns native Desktop-app work and Windows-native evidence.

## Fresh tasks preserve attribution

Every operation uses a new visible task. `list_projects` supplies the opaque project ID together with its current host and path evidence; `create_thread` consumes that same response's ID with `environment: { type: "local" }`. One fresh rematch handles a project ID that changed between listing and creation. Follow-ups, waits, payload chunks, and cleanup remain bound to the task returned by that create call.

Model routing supplies a one-use task authority and freezes model, effort, transport, privacy, and budget before task creation. The task returns identity and execution receipts while those source-owned controls stay fixed.

## Native proof

The Windows native canary distinguishes Desktop evidence from WSL evidence. Executor readiness binds plugin version, manifest digest, script hashes, host identity, native platform, and requested-version postconditions. Routine marketplace refresh records each applicable Codex and Claude plugin before and after, then re-resolves the installed Roundhouse executor bytes.

```text
host=host-w platform=windows transport=codex-remote-control
project=web-app match=exact-native-path
task=task-opaque-01 route=claimed
native_canary=passed executor_sha=sha256:12af...
postcondition=passed cleanup=archived
```

Use [Windows fleet mechanisms](/fleet/#windows-fleet-mechanisms) for the profile and privileged lanes that sit beside remote control, and [fleet readiness](/skills/fleet-readiness/) for placement evidence.
