---
layout: default
title: Remote Mac
parent: Skills
nav_order: 18
---

# Remote Mac

Make remote work resumable from the first command. Verify the destination, run long work in a named session, and return enough identity, directory, command, and log evidence for another operator to reconnect with confidence.

## What it adds

Remote Mac provides that bounded operating lane. It checks the destination first, uses the configured login shell, starts long work inside a named tmux session, and returns the session and log handles for follow-up.

## How it works

Read-only checks establish the target identity and transport. The operator can inspect the session, collect its result, and hand the evidence to delivery or fleet operations.

```text
> Check host-a, start the long build in a named tmux session, and return the log handle.
target=host-a  identity=verified  shell=login-shell
cwd=/work/project  session=build-opaque-01
command=./scripts/build  log=/tmp/railyard-build-opaque.log
handoff=inspectable
```

## Scope

Remote Mac owns one bounded remote Mac operation. Fleet placement, SSH diagnosis, and Windows-specific transport contracts stay with their owning surfaces.

## Source

Ships in the `roundhouse` plugin.

## Proof point

```text
session=build-opaque-01 state=running
identity=verified cwd=/work/project
last_line="tests: 48 passed"
result=reconnectable
```

Next: [administer remotely](/what-it-does/administer-remotely/).
