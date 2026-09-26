# Run audit: the run log and retrospectives

Reconstruct the requested task from its session-scoped metadata and available
native runtime history. Shared daily files can hold several concurrent tasks;
chronological proximity does not tie their events together.

## Run log

`${XDG_STATE_HOME:-$HOME/.local/state}/railyard/run-log/YYYY-MM-DD.jsonl`
(Windows: `%LOCALAPPDATA%\railyard\state\run-log\`). One JSON object per line,
one file per day. `node <plugin>/hooks/run-log.js path` prints the current
file; `RAILYARD_RUN_LOG_DIR` overrides the directory.

The log holds metadata only: never prompts, handoff bodies, diffs, or provider
output. Labels are truncated to about 120 characters. Nothing rotates or
prunes it; audits read at most the last 3 day files unless the user names a
wider window, and an oversized directory is a doctor finding.

### Select the task before reading its sequence

Resolve the requested task to its exact `session_id`, or use the current task
ID confirmed by runtime metadata or its SessionStart payload. Do not guess from
the newest anchor, a cwd, or a date. Nested harnesses can inherit an
ancestor's environment IDs, so confirm identity before trusting an
environment hint.

After parsing the selected files, use the read-only selector:

```js
const { entriesForSession } = require("<plugin>/hooks/run-log.js");
const taskEntries = entriesForSession(entries, requestedSessionId);
```

It uses exact identity equality and returns nothing for an unknown ID. In the
sequence `session A → session B → dispatch A → dispatch B`, A keeps its own
anchor and dispatch even though B has the latest anchor. Keep repeated anchors
for the same task; startup can mean resume or compaction. Entries without a
`session_id` stay unidentified. Report malformed lines or a torn tail as
coverage gaps.

A native parent/child relationship can justify including a child's separate
ID; name the extra ID and the evidence. Shared labels or adjacent timestamps
do not join two tasks. Missing anchors do not erase identified dispatches, but
the start of the run is then unknown.

### Mechanical lines (written by hooks)

| Event | Written by | Fields |
| --- | --- | --- |
| `session` | SessionStart charter (both harnesses) | `ts`, `harness` when known, payload `session_id` and `cwd` when available |
| `dispatch` | PreToolUse dispatch gate, on every **allowed** dispatch | `ts`, `harness`, `tool`, `model`, `effort` (Codex), `role`, `label`, `session_id` |
| `subagent_stop` | Optional lifecycle hook (off by default) | `ts`, `harness`, `session_id` |

A refused dispatch is not recorded. A `dispatch` line records permission for
an attempt, not that the runtime accepted, started, or completed it;
corroborate actual model/effort and completion from native runtime evidence.
Because it is written at PreToolUse, it still appears when the child crashes
or is abandoned.

Startup reads identity and working directory from the SessionStart JSON and
never fills them from an ancestor's environment or the hook's own cwd.
Malformed, missing, oversized, or late input leaves an unidentified anchor.

`subagent_stop` does not identify which dispatch it ends, so count and timing
cannot prove a particular child finished. Missing completion evidence stays
unknown.

### Session notes (written by the session)

Hooks cannot see outcomes, review rounds, retries, or reasons. The session can
append them:

```bash
node <plugin>/hooks/run-log.js note '{"event":"decision","what":"...","because":"...","fed_by":"..."}'
```

`note` accepts an explicit `session_id`; otherwise it uses `CODEX_THREAD_ID`,
then `CLAUDE_CODE_SESSION_ID`. A nested harness can carry an ancestor's ID,
so pass the confirmed current task ID when that is ambiguous. A note without
identity stays unidentified.

| Event | Fields | For |
| --- | --- | --- |
| `decision` | `what`, `because`, `fed_by`, `led_to` | route chosen, tier picked, fan-out vs sequential, a finding triggering a fix batch, a review verdict forcing another round, an escalation, a replan |
| `outcome` | `what`, `result`, `fed_by` | a worker finished, a check passed or failed, a round closed |
| `deviation` | `what`, `because` | actual shape diverged from the planned shape |

An `approach` note can preserve the reason for a consequential allocation or
execution choice. Notes are optional and never delivery gates.

`fed_by` and `led_to` name other lines by label in plain words ("piece 2
review", "intake"); the chain is meant to be read, not joined by a query.
`because` is the field that makes a decision explainable later.

### Cross-session messages

A message to another session is not a dispatch, and the gate never logs it.
Record one only when it changed the run, as a `decision` or `outcome` naming
the peer by its session name as the native agent list shows it. The parent's
`session_id` on a dispatch attempt is not the child's runtime identity.

## Retrospective

When selected, read the audit and relevant session history. Ask only
questions grounded in observed uncertainty or waste: unnecessary serial work,
context rereads, repeated unchanged checks, duplicated review ownership,
model/effort changes, failed starts, retries, and repairs. Compare total cost
and elapsed time at the same acceptance boundary; missing usage data stays
unknown.

Explain findings in the answer. Use the formats below only when a durable
learning or suggestion is requested or needed for an authorized repair.

**Local learning.** A learning about this repository's work belongs to
`compound-engineering:ce-compound`, which writes `<repo root>/solutions/`. Only
a cross-repo, machine-local lesson about routing or run shape goes to
`${XDG_CONFIG_HOME:-$HOME/.config}/railyard/learnings.md` as a dated bullet.
Read that file at the start of a retrospective so a lesson is not relearned.

**Upstream suggestion.** A change that belongs in a skill or plugin, Railyard's
or a third party's, becomes one file:
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

Write the body so it can be posted as a GitHub issue verbatim. For a
third-party skill the user posts it; for a repository the owner controls, the
session can apply it through normal delivery once the owner says so. Writing
the file grants permission for neither.
