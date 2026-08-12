<!-- cross-repo links use site-absolute paths, resolved at site build -->

# Cleanup Codex

Cleanup Codex diagnoses and, only when separately authorized, cleans up leftover Codex
app-server processes on macOS — the kind of residue a crashed or detached session can leave
running. It never decides whether a task is complete or archived; it only ever touches
process-level evidence it can prove is exactly the residue it thinks it is.

## When to use it

- You suspect stale Codex app-server processes are sitting around after a session ended badly.
- You're inspecting resource pressure — file descriptor counts, descendant process counts,
  process age — on a machine that runs Codex.
- [Orchestrate](./orchestrate.md) runs `cleanup-codex inspect` (read-only) after archiving a
  child that ran on a Codex carrier, as routine host-wide runtime hygiene.
- You want to explicitly reap or recycle one identified, fully attested detached server after
  reviewing what inspect found.

You won't typically invoke this by name — it mostly runs automatically as a `SessionEnd` hook,
or gets called read-only by orchestrate's cleanup step.

## How it works

### Four operations, increasing in what they're allowed to touch

**`inspect`** (the default action) is entirely read-only:

```bash
node scripts/cleanup-codex.mjs inspect --json
```

It reports app-server PID, parent and process-group identity, UID, executable, canonical command
identity, start time and age, whether it's GUI or detached, descriptor counts, descendants,
remote proxies, control-socket ownership, and any missing evidence. Every result includes
`action`, `selected`, `skipped`, `warnings`, and `verification`. A detached entry in `selected`
is only an inspection candidate — `authorizesMutation` stays `false`. GUI and ambiguous entries
are skipped with a stated reason, never guessed at.

**`inspect --snapshot <path>`** records exactly one fully classified detached server, its
recorded descendants, and only proxies linked by exact control-socket evidence, into a single
same-user, mode-`0600` file. The destination must not already exist. Zero or multiple detached
candidates, incomplete identity, process-tree churn mid-scan, or unsafe paths all refuse rather
than writing a partial snapshot.

**`reap --snapshot <path>`** cleans up residue, but only from a snapshot already recorded by
`inspect`:

```bash
node scripts/cleanup-codex.mjs reap --snapshot /private/path/codex-tree.json --json
```

`reap` is macOS-only and takes a host-local exclusive lock. It proceeds only when the recorded
owner PID is authoritatively absent — a live, reused, or unreadable owner refuses outright.
Every recorded target gets checked again for PID, UID, start time, executable, and process-group
identity right before `TERM`, then checked a second time before a survivor-only `KILL`. After
`KILL`, a final check requires the old identity to actually be gone; an exact survivor or
unknown state exits `3` rather than claiming success, and a reused PID is reported but never
signaled again.

**`recycle`** is the most invasive operation and is explicitly two-pass. The first call always
refuses and returns a `confirmationToken`:

```bash
node scripts/cleanup-codex.mjs recycle --pid 500 --nofile-attestor /private/absolute/codex-nofile-attestor --json
```

You review the receipt, then rerun the identical command with `--confirm '<token>'`. The receipt
binds the exact server, its descendants, any socket-linked proxies, the launcher, and the
expected replacement executable — any drift before the confirmed mutation invalidates it.
Managed mode (the default) requires stable native-daemon samples before and immediately before
mutation, plus replacement attestation after restart; the current native restart command doesn't
accept a receipt-bound expected PID and start time, so managed recycling currently fails closed
with `managed-restart-exact-pid-unsupported` rather than guessing. Unmanaged mode is available
only when native evidence explicitly proves there's no managed backend, and needs an explicit
`--launcher`.

### The attestor: an explicit trust boundary

Recycle requires a `--nofile-attestor` — an absolute, executable, single-link file owned by root
or the current user, no set-ID or group/world-write bits — that emits one of two fixed, bounded
JSON schemas (`codex-nofile-attestation-v1` or `codex-launcher-nofile-attestation-v1`) proving
the exact PID's or launcher's file-descriptor limit. Cleanup Codex doesn't bundle, provision, or
infer this attestor — Roundhouse owns that machine configuration, and you can only point at an
already-approved path. Without a trusted provider, recycle refuses before it touches anything.

### The root SessionEnd hook

Codex invokes `cleanup --hook` only at root `SessionEnd`, with a bounded JSON payload naming
`SessionEnd` and a session UUID. On macOS, it takes paired process snapshots, considers only
same-user PIDs carrying that exact `CODEX_THREAD_ID`, and refuses outright on anything
mixed-thread, cross-user, ambiguous, or oversized. Under the shared mutation lock it revalidates
each exact PID/UID/start-time/executable/process-group, signals deepest-first with `TERM`, waits
about 200ms, revalidates, and sends `KILL` only to exact survivors — then verifies the old
identities are gone or safely reused. It stays inside Codex's three-second hook timeout, stays
silent during normal operation, never restarts or signals the shared app-server, and never
writes raw commands or environment values to its private receipt. Set
`RAILYARD_CLEANUP_CODEX_HOOK_DISABLED=1` to turn it off.

**On every platform other than macOS, the hook is a no-op that exits `0` before it even reads
stdin.** It never blocks the session and never reports a refusal on an unsupported platform —
the same holds if the hook is explicitly disabled via the environment variable above. This is
deliberate: `SessionEnd` fires on every platform Codex runs on, but the cleanup logic itself
only understands macOS process semantics, so everywhere else it's a guaranteed-safe
pass-through. Claude Code exposes this skill for explicit, manual use but does not install the
Codex `SessionEnd` hook itself.

## Scope

- `reap` and the hook's live mutation logic operate on macOS; every other platform returns a clean
  no-op exit, keeping the evidence requirement intact.
- Complete process, ancestry, descriptor, and socket evidence is required for cleanup; incomplete
  evidence produces a refusal and preserves evidence integrity.
- Cleanup authorization uses canonical process identities and complete evidence. The cleanup signal
  set uses those identities and evidence; process name, age, resource pressure, `killall`, and broad
  process-pattern matching provide diagnostic context. Age, descriptor counts, and child-process
  counts support investigation, while complete evidence governs cleanup authorization.
- Contended mutation locks remain with their live owner until that owner resolves the contention;
  cleanup retries afterward.
- `app-server-control.sock` stays under native app-server startup ownership.
- Task archiving, completion inference, launcher changes, and descriptor-limit changes remain with
  their owning workflows.
- A live `recycle` runs only after the confirmation step records your explicit approval.
- JSON output carries process metadata and canonical identities; raw command arguments, prompts,
  transcripts, environment values, and unrelated process arguments are discarded at serialization.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Healthy inspection or hook cleanup, successful reap, or fully verified recycle |
| `1` | Warning or pressure noted; no action authorized |
| `2` | Refused, ambiguous, unsupported, or invalid request |
| `3` | Attempted cleanup or restart verification failed |

## Example session

**Prompt:** "A Codex session crashed earlier — check if anything's still running and clean it up
if it's safe."

**What happens:** You run `node scripts/cleanup-codex.mjs inspect --json` from the skill
directory. It reports one detached app-server entry with a stale age and no live parent,
alongside two descendant processes and a socket-linked proxy — all with complete evidence, so it
lands in `selected` with `authorizesMutation: false`. You take a snapshot of exactly that entry
(`inspect --snapshot /private/tmp/codex-tree.json --json`), review it, then run `reap --snapshot
/private/tmp/codex-tree.json --json`. Reap re-verifies every recorded PID's identity, confirms
the owner is authoritatively absent, sends `TERM` to the exact recorded PIDs, waits, sends
`KILL` only to survivors, and exits `0` once the final check confirms the old identities are
gone. Nothing else on the machine — including any GUI-attached Codex process — was ever a
candidate.
