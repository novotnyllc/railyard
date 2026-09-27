---
layout: default
title: Cleanup Codex
parent: Skills
nav_order: 9
---

# Cleanup Codex

Diagnose and recover macOS Codex app-servers under descriptor pressure. Inspect first, then recycle a detached server or the desktop app in two confirmed passes, or snapshot a server and reap its exact leftovers once it exits. It runs on macOS only.

## What it adds

Inspect is read-only: for each app-server it reports ancestry (desktop-hosted or detached), descriptors, descendants, control socket, and the launchd `maxfiles` limit GUI apps inherit. A desktop-hosted server under descriptor pressure gets a recommendation to recycle the app rather than the server alone.

## How it works

Recycle always takes two passes: the first changes nothing and prints a confirmation token; rerunning the identical command with that token acts. Any change to the bound identities between passes invalidates the token.

For a **detached server**, managed mode (the default) rechecks the daemon's PID record, runs `codex app-server daemon restart`, then verifies a new server owns the control socket and the old tree is gone. Unmanaged mode stops the exact recorded tree and starts a given launcher instead. An optional descriptor-limit attestor can require the replacement to prove a minimum soft limit; without it, the limit is reported as unverified.

For the **desktop app** (`--desktop`), both passes run only when Codex has been idle for 5 minutes, no app-server child has started in that window, and the app isn't frontmost — otherwise the command refuses and lists why. When idle, it asks the app to quit gracefully, waits for it, reaps exact leftovers of the old server's tree, relaunches the app, and verifies the result. It never force-kills the app; if it won't quit, the command stops rather than guessing.

For a detached server that will exit on its own, a snapshot taken while it runs lets a later reap remove exactly that recorded tree, even after it's gone.

```text
> Inspect Codex app-servers, then recycle the one under descriptor pressure.
ancestry=detached fds=<count> maxfiles=256 recommendation=recycle
pass_1=confirmation-token
pass_2=daemon-restart verified=new-socket-owner old-tree=gone
```

GUI apps inherit launchd's `maxfiles` soft limit (256 by default), and a login shell gets 8192 from the user's dotfiles. Current Codex app-servers raise their own limit, so a server with a descriptor above launchd's soft limit is not capped there. Only a server still below it gets the desktop-recycle recommendation and the launchd advice: a root LaunchDaemon running `launchctl limit maxfiles 8192 unlimited` at boot.

## Scope

Signals go only to exact PIDs whose UID, start time, executable, and process group still match the recorded identity — never to a group or by name. Other desktop apps' servers are left untouched, and a refusal is reported rather than worked around.

## Source

Ships in the `railyard` plugin.

## Proof point

A recycle or reap must verify the exact recorded tree is gone and that a legitimate replacement — a new daemon-owned socket or a relaunched app — is in place before it reports success.
