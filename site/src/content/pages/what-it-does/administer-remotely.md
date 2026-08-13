---
layout: default
title: Administer remotely
parent: What it does
nav_order: 9
---

# Administer remotely

Operate a remote Mac through a named, resumable lane with identity checks, bounded commands, and evidence at each handoff.

## Easy path

```text
> Check the remote Mac, then run this long build in a resumable session.
```

Use `roundhouse:remote-mac` for the operation and `roundhouse:ssh-doctor` when transport health needs diagnosis.

## What happens

Read-only identity and reachability checks establish the target. Long work runs in a named tmux session with a recorded working directory, command, and log path. The operator can reconnect, inspect progress, and collect the result through the same lane.

## Proof point

The remote-mac source documents the named-session handoff and the ssh-doctor source documents the diagnostic order from local transport through the target shell. Sources: `roundhouse/docs/skills/remote-mac.md` and `roundhouse/docs/skills/ssh-doctor.md`.

## Next

[Reach a machine](/skills/remote-mac/) or [run work on another machine](/what-it-does/run-work-on-another-machine/).
