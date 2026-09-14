---
layout: default
title: Codex remote control
parent: Integrations
nav_order: 6
---

# Codex remote control

Use Codex Desktop's visible task surface when the user explicitly asks for a new destination task and the Windows work needs that supported saved-project capability. Ordinary remote operations use the existing native CLI or SSH surface when it can perform the work. Remote work alone does not authorize creating or archiving a task.

## An explicitly selected task flow

The operator asks for a new visible task for a bounded native Windows operation. Roundhouse checks host, task, and transport readiness, discovers the task-control surface, and matches the saved project by configured host and exact native path. The controller creates the requested local-environment task with the selected model and effort. Completion requires the native canary and requested postcondition to pass; archival is a separate action under the user's instructions.

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

## Explicit task creation preserves attribution

When the user requests a new visible task, `list_projects` supplies the opaque project ID together with its current host and path evidence; `create_thread` consumes that same response's ID with `environment: { type: "local" }`. One fresh rematch handles a project ID that changed between listing and creation. Follow-ups, waits, payload chunks, and any authorized cleanup remain bound to the returned task. Internal bounded subtasks use native children by default.

The explicitly configured route can supply a one-use task authority and bind model, effort, transport, privacy, and budget. That authority does not replace the user's task-creation request. The task returns identity and execution receipts while the source-owned controls stay fixed. Missing task capability is reported without silently creating another task or changing the selected host, account, or provider.

## Native proof

The Windows native canary distinguishes Desktop evidence from WSL evidence. Executor readiness binds plugin version, manifest digest, script hashes, host identity, native platform, and requested-version postconditions. Routine marketplace refresh records each applicable Codex and Claude plugin before and after, then re-resolves the installed Roundhouse executor bytes.

Illustrative result for an explicitly requested task:

```text
host=host-w platform=windows transport=codex-remote-control
project=web-app match=exact-native-path
task=task-opaque-01 route=claimed
native_canary=passed executor_sha=sha256:12af...
postcondition=passed archive=separate-user-directed-action
```

Use [Windows fleet mechanisms](/fleet/#windows-fleet-mechanisms) for the profile and privileged lanes that sit beside remote control, and [fleet readiness](/skills/fleet-readiness/) for placement evidence.
