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

## The run

The operator asks for a long build on one remote Mac without losing the handle when the local session ends. Roundhouse verifies the target identity and reachability, starts the command in a named tmux session, and returns the working directory plus log path. The turn is the resumable handoff: the session name becomes the durable control point for observation and recovery. The run closes when the operator reconnects through the same verified channel and collects the command result from that evidence path.

## What happens

Read-only identity and reachability checks establish the target. Long work runs in a named tmux session with a recorded working directory, command, and log path. The operator can reconnect, inspect progress, and collect the result through the same channel.

## Proof point

The [Remote Mac skill](/skills/remote-mac/) documents the named-session handoff, and [SSH Doctor](/skills/ssh-doctor/) documents the diagnostic order from local transport through the target shell.

## Next

[Reach a machine](/skills/remote-mac/) or [run work on another machine](/what-it-does/run-work-on-another-machine/).
