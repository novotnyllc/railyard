---
name: cleanup-codex
description: Diagnose and recover macOS Codex app-servers under descriptor pressure — read-only inspect, two-pass recycle of a detached server (native daemon restart) or of the ChatGPT/Codex desktop app, and snapshot-bound reaping of leftover processes.
---

# Cleanup Codex

Use this skill when Codex slows down, hits "too many open files", or leaves
processes behind. It runs on macOS. Define `CC` once, with `SKILL_DIR` set to
this skill's directory:

```bash
CC() { node "$SKILL_DIR/scripts/cleanup-codex.mjs" "$@"; }
```

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

Confirming quits the app, which closes the user's desktop session (every open
window and thread) until it reopens; say so when asking for the go-ahead.

Both passes run only when the app is idle: none of the desktop app's own threads
(found through the selected server's Codex home) updated in 5 minutes or left a
turn or tool call open, no app-server child started in that window, and the app
not frontmost. Anything that cannot be read or tied to that server counts as
busy. Otherwise the command refuses with `desktop-busy` and lists why; retry
once the work in the app has finished. The check repeats under the lock just
before quitting. It also refuses when run from inside the app
(`desktop-recycle-inside-app`); run it from a terminal outside the app.

When idle, it asks the app to quit and waits up to 30 seconds for the app, then
up to 30 more for its server. The app is never force-killed: if it does not quit
(say, a dialog is open), the command stops with `desktop-host-quit-timeout`.
Once the app is gone it always reopens that exact bundle and waits up to 90
seconds for a new server, then reaps leftovers of the old tree that still match
their recorded identities. Any later failure is reported beside the relaunch
with exit `3`.

GUI apps inherit launchd's `maxfiles` soft limit (256 by default), but current
Codex app-servers raise their own limit, so a descriptor above launchd's soft
limit proves the server is not capped there. Only a server still below that
limit gets the desktop-recycle and launchd advice (a root LaunchDaemon running
`launchctl limit maxfiles 8192 unlimited` at boot); recommend it rather than
changing it here.

**Detached server.** Managed mode (the default) rechecks that the daemon's PID
record still names the receipt's server, runs `codex app-server daemon restart`,
then verifies a new server owns the control socket and the old tree is gone.
For a server the daemon does not run, `--unmanaged --launcher <path>` stops the
exact recorded tree and starts the launcher (default `RAILYARD_CODEX_BIN`, then
`codex` on `PATH`).

```bash
CC recycle --pid <detached-pid>
CC recycle --pid <detached-pid> --unmanaged --launcher ~/.local/bin/codex
```

`--nofile-attestor <path>` (or `RAILYARD_NOFILE_ATTESTOR`) is optional. Without
it, the descriptor limit is reported as `unverified`, and an unmanaged launcher
must canonically be the old server's executable. With it, the replacement must
attest at least `--min-soft-limit` (default 8192). The attestor is a regular
executable owned by you or root, not group/world-writable, and prints one JSON
object with exactly these keys:

- `ATTESTOR --pid PID --json` →
  `{"schema":"codex-nofile-attestation-v1","pid":…,"uid":…,"processStartTime":…,"softNofile":…}`,
  where `processStartTime` is the process's start time as an ISO string.
- `ATTESTOR --launcher PATH --json` →
  `{"schema":"codex-launcher-nofile-attestation-v1","path":…,"dev":…,"ino":…,"replacementExecutable":…,"softNofile":…}`,
  naming the launcher file and the canonical executable it starts.

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
user asks for automatic cleanup. `RAILYARD_CLEANUP_CODEX_HOOK_DISABLED=1` turns
it into a no-op.

## Exit codes

`0` healthy or recycled · `1` warning · `2` refused, or a first pass awaiting
confirmation · `3` an attempted action could not be verified; the result names
the recovery reason.
