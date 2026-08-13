---
layout: default
title: Administer remotely
parent: Practices
nav_order: 9
---

# Administer remotely

Operate a remote Mac through a named, resumable channel with identity checks, bounded commands, and evidence at each handoff.

## Easy path

```text
> Check the remote Mac, then run this long build in a resumable session.
```

Use `roundhouse:remote-mac` for the operation. `roundhouse:ssh-doctor` provides the transport-health diagnosis when the connection needs attention.

## What happens

Read-only identity and reachability checks establish the target. Long work runs in a named tmux session with a recorded working directory, command, and log path. The operator can reconnect, inspect progress, and collect the result through the same channel.

## Proof point

The [Remote Mac skill](/skills/remote-mac/) documents the named-session handoff, and [SSH Doctor](/skills/ssh-doctor/) documents the diagnostic order from local transport through the target shell.

## Next

[Reach a machine](/skills/remote-mac/) or [run work on another machine](/what-it-does/run-work-on-another-machine/).
