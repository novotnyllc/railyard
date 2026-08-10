# Run audit: the run log, the recap, the retrospective

Sibling of the dispatch banner in `harness-model-invocation.md`. The banner is
per-dispatch self-ID *inside* a transcript; this is the aggregate
reconstruction *across* one — which survives compaction, because it is written
to disk as the run happens.

Three depths, each opt-in deeper than the last:

| Depth | When | What it is |
| --- | --- | --- |
| **Recap** | automatic, every deliver/orchestrate completion | 3–6 plain lines ending the final user-facing message |
| **Audit** | on request (`railyard:audit`, "how did that run work?") | the decision chain, reconstructed from the run log |
| **Retrospective** | closing step of a substantial run, or on request | self-generated questions about that run, answered against the evidence and graded against the kickoff `approach` line, ending in learnings and suggestions |

The retrospective is no longer only on-request: a substantial run runs it as
its closing step, and a **Stop** hook (Claude Code) / **SessionEnd** hook
(Codex) reminds when a substantial run would end without a recorded
`retrospective` or `recap` marker. The hook only surfaces the reminder
(metadata-only, never blocks the stop, no prompt/secret capture); the session
runs the loop.

**Substantial is by cost, not by route.** The hook fires on either signal: a
small fan-out of dispatches, *or* this session's own `what:"approach"` line
with no closing marker. The second signal is what covers a run that spends
hours without dispatching anything — a fleet or release run — which the
dispatch count alone reads as trivial. Only `what:"approach"` counts, not the
other `decision` kinds, and only when the line carries this session's
`session_id`: an unscoped approach line arms nobody's reminder.

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

### Mechanical lines (written by hooks)

| Event | Written by | Fields |
| --- | --- | --- |
| `session` | SessionStart charter (both harnesses) | `ts`, `harness`, `cwd` |
| `dispatch` | PreToolUse dispatch gate, on every **allowed** dispatch | `ts`, `harness`, `tool`, `model`, `effort` (Codex), `role`, `label`, `session_id` |
| `subagent_stop` | Claude Code `SubagentStop` | `ts`, `harness`, `session_id` |

A refused dispatch is never recorded — the log holds dispatches that happened.

The PreToolUse position is deliberate: it fires on both harnesses from a
subscription that already exists, and it records a dispatch even when the
child crashes or is abandoned — exactly the case an audit needs to see. A
PostToolUse recorder would miss it.

`subagent_stop` carries no tool payload, so it pairs with dispatches only by
count and time: it answers "did the fan-out drain, and when" — not per-worker
duration. Codex exposes no equivalent event; there, worker completion comes
from `outcome` lines.

Deliberately **not** subscribed: `UserPromptSubmit` (fires on every prompt,
records nothing about routing that the `session` anchor does not) and
`SessionEnd` (an audit is asked for *during* the run being audited, so an end
marker would never have been written for it).

### Doctrine lines (written by the session)

Hooks cannot see outcomes, review rounds, retries, or why anything was
chosen. The orchestrating session appends those itself:

```bash
node <plugin>/hooks/run-log.js note '{"event":"decision","what":"...","because":"...","fed_by":"..."}'
```

`note` stamps `session_id` itself, from the id the harness exports to the
commands it spawns (`CLAUDE_CODE_SESSION_ID` / `CODEX_THREAD_ID`), so a
doctrine line binds to the run that wrote it; passing `session_id` explicitly
overrides that.

Three event kinds, no more:

| Event | Fields | For |
| --- | --- | --- |
| `decision` | `what`, `because`, `fed_by`, `led_to` | route chosen at intake, tier picked, fan-out vs sequential, a finding triggering a fix batch, a review verdict forcing another round, an escalation, a replan, a phase boundary |
| `outcome` | `what`, `result`, `fed_by` | a worker finished, a gate passed or failed, a round closed |
| `deviation` | `what`, `because` | actual shape diverged from the planned shape |

Every substantial run opens with one of these, whatever routed it. A run that
is substantial **by cost** — multi-host, multi-repo, or multi-hour — MUST open
an `approach` line before it executes, even when nothing will ever dispatch:
that single `note` call is the entire audit spine for an ops or release run,
and it is also what arms the Stop/SessionEnd reminder.

The run's **first** `decision` line is its `approach`: `what:"approach"`,
`because:` the one-paragraph "how would an excellent engineer run *this* run?"
— the loop, the isolation boundary, the evidence that proves done, and the long
pole, derived from first principles before the route executes. It is the
baseline the retrospective grades the run against; its absence is itself a
finding.

A completed retrospective (or the closing recap) records a marker line —
`{"event":"retrospective", ...}` or `{"event":"recap", ...}` — so the Stop/
SessionEnd reminder knows the loop already ran and stays quiet. Marker lines
are metadata only, like every other line.

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
plain label `/list-agents` shows. Launch named children (`--name`) so that
label, the ledger, and the agent list agree; the session UUID remains the
resume identity that `dispatch` and `subagent_stop` lines carry.

## Recap format

End the final user-facing message of every deliver/orchestrate completion with
3–6 plain lines. Text, not ceremony — no heading, no table, no version
framing:

```text
Route: railyard:deliver → ce-plan → LFG → thermos → merge
Chain: intake chose local delivery (one lane) → thermos found 2 real findings
  → one fix batch → clean re-review
Dispatches: 4 (3 opus implementation, 1 sonnet extraction), 1 review round
Ran as expected.
```

The last line is the verdict: `Ran as expected.` or one plain sentence naming
the divergence. Counts are one line; the chain is the content.

## Retrospective

Not a checklist. Read the audit report plus the session history and **generate
3–7 pointed questions about this specific run**, then answer each against the
evidence. Good questions are concrete and come from something the audit
actually shows:

> Phase 3 dispatched 4 workers sequentially with no data dependency between
> them — why not parallel?

> Two reviewers each re-read the same 9k-line file — could one have briefed
> the other?

> The intake picked Opus for a mechanical rename. What did the extra tier buy?

Alongside the run-specific questions, five standing **discipline lenses** run
every time — the charter's default triggers, asked in the past tense. Each is
pass/fail against the evidence, and a fail is a finding that must land in a
sink:

| Lens | The question |
| --- | --- |
| Greenfield-disposable | Was migration/production caution spent on state nobody depends on? Was "who depends on this?" asked before preserving it? |
| Scope→plan threshold | Did scope cross multi-host / multi-repo / multi-hour with no plan artifact produced before execution continued? |
| Never override a guard | Was a tripped safety guard bypassed instead of fixed or routed through the sanctioned path? |
| Bytes, not version | Where a fix shipped under an unchanged version, were installed bytes (resolved SHA) verified rather than the version string? |
| Completeness | Was the plan/handoff/retrospective built by sweeping the primary record, mapping every flagged item and every mid-run workaround to captured/not-captured — never re-summarizing a summary? Every workaround (shim, alias, hand-edit) is an open defect to capture. |

Answer honestly, including "nothing was wasteful here". An answer that yields
an improvement goes to one of exactly two sinks:

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
