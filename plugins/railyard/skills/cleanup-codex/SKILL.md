---
name: cleanup-codex
description: Diagnose and recover macOS Codex app-servers under descriptor pressure — read-only inspect, two-pass recycle of a detached server (native daemon restart) or of the ChatGPT/Codex desktop app, and snapshot-bound reaping of leftover processes.
---

# Cleanup Codex

Use this skill when Codex slows down, hits "too many open files", or leaves
processes behind. It runs on macOS. Every command below runs from the Railyard
repository root; `CC` stands for
`node plugins/railyard/skills/cleanup-codex/scripts/cleanup-codex.mjs`.

## Inspect first

```bash
CC inspect            # add --json for the structured result
```

Inspect is read-only. For each app-server it reports ancestry (`gui` when the
ChatGPT/Codex app hosts it, otherwise `detached`), descriptors, descendants, and
control socket, plus the launchd `maxfiles` limit GUI apps inherit. A GUI server
under descriptor pressure gets a recommendation to recycle the desktop app.
Warnings describe pressure only; thresholds are tunable (`--fd-count-warn`,
`--highest-fd-warn`, `--age-hours-warn`, `--descendant-warn`).

## Recycle

Recycle takes two passes. Share the inspect output with the user and get their
go-ahead first. The first pass changes nothing and prints a confirmation token;
rerun the identical command with `--confirm '<token>'` to act. Any change to the
bound identities in between invalidates the token.

**Desktop app (GUI server).** For a server hosted by the ChatGPT or Codex app:

```bash
CC recycle --pid <gui-pid> --desktop
CC recycle --pid <gui-pid> --desktop --confirm '<token>'
```

Both passes run only when the app is idle: no Codex rollout or thread update
for 5 minutes, no app-server child started in that window, and the app not frontmost. Otherwise
the command refuses with `desktop-busy` and lists why; retry once the work in the
app has finished. The check repeats under the lock just before quitting.

When idle, it asks the app to quit, waits up to 30 seconds, reaps leftovers of
the old server's tree that still match their recorded identities, and reopens
the app by bundle id. The app is never force-killed: if it does not quit (say, a
dialog is open), the command stops with `desktop-host-quit-timeout`.

The usual root cause is launchd's default `maxfiles` soft limit of 256, which
the app inherits, so a recycle only resets the count. The lasting fix is a root
LaunchDaemon running `launchctl limit maxfiles 8192 unlimited` at boot, or
Roundhouse machine configuration; recommend it rather than changing it here.

**Detached server.** Managed mode (the default) rechecks that the daemon's PID
record still names the receipt's server, runs `codex app-server daemon restart`,
then verifies a new server owns the control socket and the old tree is gone.
For a server the daemon does not run, `--unmanaged --launcher <path>` stops the
exact recorded tree and starts the launcher.

```bash
CC recycle --pid <detached-pid>
CC recycle --pid <detached-pid> --unmanaged --launcher ~/.local/bin/codex
```

`--nofile-attestor <path>` is optional. Without it, the descriptor limit is
reported as `unverified`. With it, the replacement must attest at least
`--min-soft-limit` (default 8192).

## Snapshot and reap leftovers

For a detached server that will exit on its own, record its tree while it runs
and reap once it is gone:

```bash
CC inspect --snapshot "$TMPDIR/codex-tree.json"
CC reap --snapshot "$TMPDIR/codex-tree.json"
```

## What the tools guarantee

- Signals go only to exact PIDs whose UID, start time, executable, and process
  group still match the record; never to groups or by name.
- Processes without a readable exact identity, such as retitled `npm exec` MCP
  servers, are reported and left alone.
- Other desktop apps' servers are untouched; detached recycle and reap refuse
  GUI servers.
- A refusal is an answer: report it rather than working around it.

An opt-in SessionEnd hook (`cleanup --hook`) can clean one finished session's
processes automatically. The plugin does not register it; add it only when the
user asks for automatic cleanup.

## Exit codes

`0` healthy or recycled · `1` warning · `2` refused, or a first pass awaiting
confirmation · `3` an attempted action could not be verified; the result names
the recovery reason.
