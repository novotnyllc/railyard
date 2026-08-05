---
name: cleanup-codex
description: Clean completed-session process residue, inspect macOS Codex app-server resources, reap exact snapshot-bound residue, or explicitly recycle one fully attested detached server.
---

# Cleanup Codex

Use this skill to diagnose retained Codex app-server resources and, when separately authorized, reap identities from a prior exact-tree snapshot or recycle one fully attested detached Unix server. It never decides whether a task is complete or archived.

## Inspect

From this skill directory:

```bash
node scripts/cleanup-codex.mjs inspect
```

From the Yardmaster repository root:

```bash
node plugins/yardmaster/skills/cleanup-codex/scripts/cleanup-codex.mjs inspect --json
```

`inspect` is the default action, so it may be omitted. The command reports app-server PID, parent and process-group identity, UID, executable, canonical command identity, start time and age, GUI or detached ancestry, numeric descriptors, descendants, remote proxies, control-socket ownership, and missing evidence.

The stable JSON result always includes `action`, `selected`, `skipped`, `warnings`, and `verification`. A detached entry in `selected` is an inspection candidate only; `authorizesMutation` remains false. GUI and ambiguous entries are skipped with reasons.

### Root SessionEnd hook

Codex invokes `cleanup --hook` only at root `SessionEnd`. It accepts only a bounded JSON payload naming `SessionEnd` and a UUID `session_id`, then takes paired plain and environment-expanded macOS process snapshots. It considers only same-user PIDs carrying that exact `CODEX_THREAD_ID`; process groups are used for exclusion and reporting, never group signaling. Mixed-thread, cross-user, hook/app-server, proxy/daemon, incomplete, or oversized groups are refused.

Under the shared mutation lock, the hook revalidates each exact PID, UID, start time, absolute executable, and process group, signals exact PIDs deepest-first with `TERM`, waits about 200 ms, then revalidates and sends `KILL` only to exact survivors. It verifies the old birth identities are absent or reused. The hook stays within the three-second manifest timeout, remains silent during normal invocation, never restarts or signals the shared app-server, and never writes raw commands or environment values to its private receipt.

The hook atomically replaces one mode-`0600` latest receipt for the exact app-server identity under `${XDG_STATE_HOME}/yardmaster/cleanup-codex` when `XDG_STATE_HOME` is set, otherwise under `~/Library/Application Support/yardmaster/cleanup-codex`. A later complete manual inspection prunes only private receipts whose exact identities are proven absent or reused. Set `YARDMASTER_CLEANUP_CODEX_HOOK_DISABLED=1` to disable hook cleanup. Claude Code exposes this skill for explicit use but does not install the Codex hook.

## Snapshot

Record exactly one fully classified detached server, its recorded descendants, and only proxies linked by exact control-socket evidence:

```bash
node scripts/cleanup-codex.mjs inspect --snapshot /private/path/codex-tree.json --json
```

The destination must not already exist. The script publishes one same-user regular mode-`0600` file atomically and serializes process metadata only. Zero or multiple detached candidates, incomplete target identity, tree churn, unsafe paths, and incomplete evidence refuse without creating a snapshot.

## Reap

Reap residue only from a previously generated snapshot:

```bash
node scripts/cleanup-codex.mjs reap --snapshot /private/path/codex-tree.json --json
```

`reap` is macOS-only and takes one host-local exclusive mutation lock. It proceeds only when the recorded owner PID is authoritatively absent; a live, reused, or unreadable owner refuses. Every recorded target is checked for PID, UID, start time, absolute executable, and process-group identity before `TERM`, then checked again before survivor-only `KILL`. After `KILL`, a bounded final check requires the old identity to be absent; an exact survivor or unknown state returns exit `3`, while a reused PID is reported and never signaled again. New children and changed or unrelated identities are never selected.

## Recycle

Recycle is an explicit two-pass operation. Start with the exact detached PID reported by `inspect`, an absolute descriptor-attestor path, and no confirmation:

```bash
node scripts/cleanup-codex.mjs recycle --pid 500 --nofile-attestor /private/absolute/codex-nofile-attestor --json
```

The first pass always refuses with exit `2` and returns a `confirmationToken`. Review the receipt, then rerun the identical command with the quoted token:

```bash
node scripts/cleanup-codex.mjs recycle --pid 500 --nofile-attestor /private/absolute/codex-nofile-attestor --confirm 'RECYCLE sha256-digest' --json
```

The receipt binds the exact server, applicable parent, descendants, socket-linked proxy PIDs, socket, native daemon evidence, minimum limit, attestor, launcher, and expected replacement executable. Any drift before mutation invalidates it.

Managed mode is the default. It requires stable native daemon samples before confirmation, under the lock, and immediately before mutation, plus replacement attestation after restart. Each sample requires backend `pid`, the exact native PID record, selected-socket ownership, and the managed executable identity. The current native `codex app-server daemon restart` command does not accept the receipt-bound expected PID and start time, so Yardmaster fails closed with `managed-restart-exact-pid-unsupported` before confirmation or mutation. A future native compare-and-swap adapter may own the lifecycle; Yardmaster never signals a managed server directly and may reap only still-matching residue from the confirmed old snapshot.

Use unmanaged mode only when native evidence explicitly proves no managed backend and no PID record:

```bash
node scripts/cleanup-codex.mjs recycle --pid 500 --unmanaged --launcher /private/absolute/codex-wrapper --nofile-attestor /private/absolute/codex-nofile-attestor --json
```

After reviewing that receipt, rerun the identical command with `--confirm`. Unmanaged mode revalidates the full tree under the mutation lock, sends `TERM` and survivor-only `KILL` to exact recorded PIDs, then launches only the receipt-bound launcher. If `--launcher` is omitted, resolution checks `YARDMASTER_CODEX_BIN`, absolute `PATH` entries, then `~/.local/bin/codex`; symlinks are resolved and the canonical target is bound.

The configured minimum soft descriptor limit defaults to `8192` and may be changed with `--min-soft-limit`. `--nofile-attestor` may instead be supplied as `YARDMASTER_NOFILE_ATTESTOR`. Yardmaster does not bundle or provision an attestor, launcher, or descriptor-limit configuration; Roundhouse owns that machine configuration, and the operator may only select an already approved path. Without a trusted provider, recycle intentionally refuses before mutation.

The attestor is an explicit trust boundary. It must be an absolute, executable, single-link regular file owned by root or the current user, with no set-ID or group/world-write bits. The command must emit only the following bounded JSON schemas:

```json
{"schema":"codex-nofile-attestation-v1","pid":500,"uid":501,"processStartTime":"2026-08-02T16:00:00.000Z","softNofile":8192}
```

for `attestor --pid 500 --json`, and:

```json
{"schema":"codex-launcher-nofile-attestation-v1","path":"/canonical/codex-wrapper","dev":1,"ino":2,"replacementExecutable":"/canonical/codex","softNofile":8192}
```

for `attestor --launcher /canonical/codex-wrapper --json`. Do not substitute an inferred limit or a helper that cannot attest the exact PID or launcher contract.

Success requires a different replacement PID, exact ready-socket ownership, replacement descriptor-limit attestation, descriptor count and highest descriptor, a direct-child baseline, absence or safe reuse of every old identity (including an applicable parent), and unchanged GUI app-server identities. Any incomplete post-mutation proof exits `3` with the recovery reason.

## Warning thresholds

Override a warning threshold directly when needed:

```bash
node scripts/cleanup-codex.mjs inspect --fd-count-warn 200 --highest-fd-warn 220 --age-hours-warn 72 --descendant-warn 75
```

Thresholds identify pressure only. Age, descriptor use, and child count never prove staleness or authorize cleanup.

## Safety and evidence

- Treat incomplete process, ancestry, descriptor, or socket evidence as a refusal.
- Require an absolute executable path from read-only `lsof` text-file evidence; `ps comm` alone is not an executable identity.
- Associate a non-descendant `codex app-server proxy` only when its `lsof` control-socket path exactly matches the server-owned socket.
- Do not signal by name, age, or pressure; do not use `killall` or broad process patterns.
- Do not edit snapshots. Reap accepts only a same-user, non-symlink, single-link regular mode-`0600` file with the exact supported schema.
- Do not break a contended mutation lock automatically. Resolve the active owner before retrying.
- Never unlink `app-server-control.sock`. Native app-server startup owns that path.
- Do not archive tasks, infer completion, change launchers, or change descriptor limits.
- Do not use unmanaged mode as fallback for missing or conflicting managed evidence.
- Do not run a live recycle without explicit operator approval. Tests use isolated fixture processes and sockets only.
- JSON contains process metadata and canonical identities only. Raw command arguments, prompts, transcripts, environment values, and unrelated process arguments are discarded.
- The shared skill works in Codex and Claude Code. This inspection collector requires macOS; other platforms return an explicit refusal rather than weaker evidence.

## Exit codes

- `0`: healthy inspection or hook cleanup, successful reap, or fully verified recycle
- `1`: warning or pressure; no action authorized
- `2`: refused, ambiguous, unsupported, or invalid request
- `3`: attempted cleanup or restart verification failure
