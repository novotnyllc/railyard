---
name: audit
description: "Reconstruct how a run of agent work actually went (decisions, delegation, models, retries, review rounds) from the Railyard run log. Use when the user asks to audit a run, how or why it ran as it did, or for a retrospective."
---

# Run audit

Answer one question: what were the decision points, and how did each feed the
next? Report a chain, not an activity list; counts get one line.

Read `../../references/run-audit.md` for the run-log location, line grammar,
task selection, and optional learning formats.

## Scope the run

Identify the requested task's exact `session_id`, or the current task's ID
when the user means this run, from runtime/task metadata or an identified
SessionStart payload. A task name or date must resolve to that identity; a
shared working directory is not one. If the task cannot be identified, say so
and use only task history whose ownership is known.

Read at most the last 3 day files unless the user asks for a wider window.
Print the log path with `node <this plugin>/hooks/run-log.js path` and select
entries with `entriesForSession(entries, requestedSessionId)` from
`../../hooks/run-log.js`, which matches `session_id` exactly. Concurrent tasks
interleave in the same daily file, so never take the latest global `session`
line and everything after it. Repeated anchors for one ID can be resumes or
compactions; keep that task's earlier records. Include a child's separate ID
only when native parent/child evidence links it, and name it.

Say plainly when the window is empty or the log starts mid-run; that is a gap
to name, not to fill in.

## Sources

1. **Run log**: mechanical `session`/`dispatch`/`subagent_stop` lines plus the
   session's own `decision`/`outcome`/`deviation` notes.
2. **Native runtime results and task history**: observed child starts,
   resolved model/effort, and outcomes. A PreToolUse `dispatch` entry shows the
   gate allowed an attempt, not that the child ran with those settings.

## Report

In this order:

1. **The chain.** Each decision: what was decided, what fed it, what it
   caused. For example, "intake chose orchestrate because of 3 independent
   pieces → piece 2's review found a shared-writer conflict → a fix batch →
   a second review round on pieces 1 and 2." Follow `fed_by`/`led_to`; where
   they are missing, say the link is inferred from ordering.
2. **Shape.** One line: allowed dispatch attempts by requested model/effort,
   observed fan-out, rounds, retries, and timing. Unobserved values are
   unknown; the default log does not record child concurrency or completion.
3. **Did it work as expected.** Compare the decision sequence with the planned
   route. Name divergences: a skipped phase, a model/effort change without a
   recorded reason, a child confirmed incomplete, a repeated review round.
   End with the conclusion the evidence supports, including uncertainty.

Add a small mermaid decision-flow diagram only for a fan-out of 10+ or a
multi-phase pipeline, never a swimlane of every event.

## Follow-ups

Answer "why did you do that?" from the `because` and `fed_by` fields plus
session context. When the record does not capture why, say so rather than
reconstructing a rationale.

## Retrospective

Run one when the user asks, or when a concrete repeated failure makes it
useful. Pick a few questions from observed decisions and outcomes: why a model
and effort were chosen, whether a child lacked context, whether review or
verification repeated unchanged work, which retries or repairs were needed.
Compare complete accepted assignments, including children, retries, and
repairs; per-call price does not establish cost per completed task.

Report findings in the answer. Write a durable learning or upstream suggestion
only when requested or needed for an authorized repair; repository learnings
go through `compound-engineering:ce-compound`, and the local formats are in
the reference. Posting messages or issues needs user authorization.
