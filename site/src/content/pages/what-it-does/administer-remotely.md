---
layout: default
title: Administer remotely
parent: What it does
nav_order: 9
---

# Administer remotely

A release build is running on a Mac across town when the local terminal disappears. The practiced move is to begin inside a named, resumable lane: verify identity, bound the command, and leave evidence at each handoff. The build keeps moving, and the next operator can reconnect to the same work with confidence.

## Easy path

```text
> Check the remote Mac, then run this long build in a resumable session.
```

Use `roundhouse:remote-mac` for the operation. `roundhouse:ssh-doctor` provides the transport-health diagnosis when the connection needs attention.

## What happens

Read-only identity and reachability checks establish the target. Long work runs in a named tmux session with a recorded working directory, command, and log path. Through that same lane, the operator can reconnect, inspect progress, and collect the result.

## Proof point

The [Remote Mac skill](/skills/remote-mac/) documents the named-session handoff, and [SSH Doctor](/skills/ssh-doctor/) documents the diagnostic order from local transport through the target shell.

## Next

[Reach a machine](/skills/remote-mac/) or [run work on another machine](/what-it-does/run-work-on-another-machine/).
