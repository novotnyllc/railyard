# Run audit: the run log, the recap, the retrospective

Reconstruct the requested task from its session-scoped metadata and available
native runtime history. Shared daily files can contain several concurrent
tasks; chronological proximity does not establish that their events belong
together.

Use the depth that answers the question:

| Depth | When | What it is |
| --- | --- | --- |
| **Completion report** | at task completion | result, relevant checks, and remaining limitations |
| **Audit** | on request or to investigate a concrete repeated failure | the decision chain reconstructed from available evidence |
| **Retrospective** | explicitly selected for improvement | a few run-specific questions answered from that evidence |

Audit and retrospective are available on demand. A run does not need a recap
marker, approach artifact, or learning file to finish.

## Run log

`${XDG_STATE_HOME:-$HOME/.local/state}/railyard/run-log/YYYY-MM-DD.jsonl`
(Windows: `%LOCALAPPDATA%\railyard\state\run-log\`). One JSON object per line,
one file per day. `node <plugin>/hooks/run-log.js path` prints the current
file; `RAILYARD_RUN_LOG_DIR` overrides the directory (tests use it).

**Metadata only.** Never prompts, handoff bodies, diffs, or provider output —
privacy first, size second. Labels are truncated to ~120 characters.

Nothing rotates or prunes the log. Audits read at most the last 3 day files
unless the user names a wider window; an oversized directory is a doctor
finding, not a daemon's job.

### Select the task before reading its sequence

Resolve the user's requested task to its exact `session_id`; otherwise use the
current task ID confirmed by runtime/task metadata or its SessionStart payload.
Do not guess from the newest global anchor, a cwd, or a date. Environment IDs
can be inherited from an ancestor when harnesses are nested; confirm the
requested identity before using an environment hint.

After parsing the selected daily JSONL files, use the small read-only selector:

```js
const { entriesForSession } = require("<plugin>/hooks/run-log.js");
const taskEntries = entriesForSession(entries, requestedSessionId);
```

The selector uses exact identity equality and returns no entries when the ID
is unknown. A sequence `session A → session B → dispatch A → dispatch B` gives
A its own anchor and dispatch, even though B has the latest anchor. Keep
repeated anchors for the same task within the requested window; startup can
also mean resume or compaction. Log entries without a `session_id` remain
unidentified. Report malformed lines or a torn tail as coverage gaps.

A native parent/child relationship can justify including a child's separate
ID; name the extra ID and that evidence. Without that relationship, shared
labels or adjacent timestamps do not join two tasks. Missing anchors do not
erase otherwise identified dispatches, but the start of the run is unknown.

### Mechanical lines (written by hooks)

| Event | Written by | Fields |
| --- | --- | --- |
| `session` | SessionStart charter (both harnesses) | `ts`, `harness` when known, payload `session_id` and `cwd` when available |
| `dispatch` | PreToolUse dispatch gate, on every **allowed** dispatch | `ts`, `harness`, `tool`, `model`, `effort` (Codex), `role`, `label`, `session_id` |
| `subagent_stop` | Optional lifecycle hook (not enabled by default) | `ts`, `harness`, `session_id` |

A refused dispatch is not recorded as allowed. PreToolUse records permission
for an attempt; it cannot prove the runtime accepted, started, or completed it.
Corroborate actual model/effort and completion from native runtime evidence.

Startup reads the native/Claude SessionStart JSON for its identity and working
directory. It never fills missing identity from an ancestor's environment or
substitutes the hook process's cwd. Input reading is bounded; malformed,
missing, oversized, or late input leaves an unidentified anchor and the route
guide still prints. Only metadata is recorded.

The PreToolUse position is deliberate: it fires on both harnesses from a
subscription that already exists, and it records a dispatch even when the
child crashes or is abandoned — exactly the case an audit needs to see. A
PostToolUse recorder would miss it.

`subagent_stop` does not identify a matching dispatch in this log format.
Count and time alone cannot prove that a particular child finished or that
all work completed. Default startup/dispatch hooks do not subscribe to these
optional lifecycle events. Use native child outcomes and optional `outcome`
notes when available; missing completion evidence stays unknown.

### Doctrine lines (written by the session)

Hooks cannot see outcomes, review rounds, retries, or why anything was
chosen. The orchestrating session appends those itself:

```bash
node <plugin>/hooks/run-log.js note '{"event":"decision","what":"...","because":"...","fed_by":"..."}'
```

`note` accepts an explicit `session_id`. Otherwise it uses the environment
hint `CODEX_THREAD_ID`, falling back to `CLAUDE_CODE_SESSION_ID`. A nested
harness can retain an ancestor's ID, so this precedence does not establish the
innermost task. Pass the confirmed current task ID explicitly when that is
ambiguous. A note with no identity remains unidentified.

Three event kinds, no more:

| Event | Fields | For |
| --- | --- | --- |
| `decision` | `what`, `because`, `fed_by`, `led_to` | route chosen at intake, tier picked, fan-out vs sequential, a finding triggering a fix batch, a review verdict forcing another round, an escalation, a replan, a phase boundary |
| `outcome` | `what`, `result`, `fed_by` | a worker finished, a gate passed or failed, a round closed |
| `deviation` | `what`, `because` | actual shape diverged from the planned shape |

An `approach` note can preserve the reason for a consequential allocation or
execution choice. It is optional. Record one when it helps diagnose the run;
do not create a process stage solely to produce it. Completion and optional
retrospective markers are metadata, not delivery gates.

`fed_by` and `led_to` reference other lines **by label, in plain words** —
"piece 2 review", "intake". No ID scheme, no schema; the chain is meant to be
read by a human and reconstructed by a session, not joined by a query planner.

`because` is the load-bearing field. A decision recorded without it cannot be
interrogated later, and the audit must then say so rather than invent one.

### Cross-session messages

A message to another session is not a dispatch: the gate never sees it and the
log gets no line for it. Record one only when it changed the run — the status
that unblocked a lane, the finding handed to a sibling — as an ordinary
`decision` or `outcome` line naming the peer by its session name, the same
label the native agent list shows. Use labels already provided by the native
tool; the parent task's `session_id` on a dispatch attempt is not the new
child's runtime identity.

## Completion report

Lead with the requested result and its verification. Add model/effort,
dispatch count, retries, or timing only when relevant to the user's question.
No fixed route chain, recap block, heading, or audit verdict is required.

## Retrospective

When selected, read the audit report and relevant session history. Ask only
questions grounded in observed uncertainty or waste: unnecessary serial work,
context rereads, repeated unchanged checks, duplicated review ownership,
model/effort changes, failed starts, retries, and repairs. Compare total cost
and elapsed time at the same acceptance boundary; missing usage data stays
unknown. Higher effort can reduce actions, but a benchmark does not prove the
best allocation for every coding task.

There are no mandatory discipline lenses, grades, sink entries, or artifacts.
Explain useful findings in the answer. The formats below are available only
when a durable learning or suggestion is requested or needed for an authorized
repair.

**Local learning.** A learning about *this repository's* work is
`compound-engineering:ce-compound` — it already owns that surface and writes
`<repo root>/solutions/`. Never duplicate it. Only a cross-repo, machine-local
lesson about routing or run shape (which CE has no home for) goes to
`${XDG_CONFIG_HOME:-$HOME/.config}/railyard/learnings.md` — one
human-editable markdown file, append a dated bullet, no schema. Read it at the
start of a retrospective so the same lesson is not learned twice.

**Upstream suggestion.** A change that belongs in a skill or plugin —
railyard's own or a third party's — becomes one file:
`${XDG_CONFIG_HOME:-$HOME/.config}/railyard/suggestions/<YYYY-MM-DD>-<slug>.md`

```markdown
---
repo: novotnyllc/railyard
target: plugins/railyard/skills/orchestrate/SKILL.md
change: doctrine
---

# Fan out independent verification lanes

**Proposed change.** …

**Rationale.** …

**Evidence.** Run 2026-08-06: 4 dispatches, sequential, no shared writer …
```

Write the body so it can be posted as a GitHub issue verbatim. Two
consumption paths: for a third-party skill the user posts it; for a repo the
owner controls, the session can apply it through the normal delivery flow once
the owner says so. Writing the file is never permission to do either.
