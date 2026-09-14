---
name: audit
description: "Reconstruct how a chunk of agent work actually ran — which skills routed, what decided what, how many subagents fanned out on which models and why, retries, review rounds, and whether it matched the planned shape. Use when the user asks how a run worked, to audit the last run, why a route or model was chosen, whether it ran as expected, or for a retrospective on how the work could have been done better. Reads the railyard run log, not the code diff."
---

# Run audit

Answer one question: **what were the decision points that fed one thing into
the other?** Not an activity list — a chain. Counts are one line; decisions are
the content.

Read `../../references/run-audit.md` for the run-log location, the line
grammar, the recap format, and the suggestion file format. It is the sibling
of the dispatch banner section in `../../references/harness-model-invocation.md`:
banners self-identify each child in the transcript, this reconstructs the run
across it.

## Scope the run

Default to the last run: the most recent `session` line in the run log, and
everything after it. Widen only when the user names a window ("this week",
"that run yesterday") — then read at most the last 3 day files unless they ask
for more. Print the log path with
`node <this plugin>/hooks/run-log.js path` (resolve `../../hooks/run-log.js`
from this file) and read the day files directly; they are small.

Say plainly when the window is empty or the log starts mid-run — a run that
predates the recorder, or a session whose SessionStart hook did not fire, is a
gap to name, not to interpolate.

## Sources

1. **Run log** — the spine. Mechanical `session`/`dispatch`/`subagent_stop`
   lines plus the session's own `decision`/`outcome`/`deviation` lines.
2. **Model routing state** — what was actually admitted and claimed: the
   `status` and `inspect-claim` commands of `railyard:model-routing`
   (read-only; never resolve a new decision during an audit).
3. **Dispatch banners** in the transcript, when the transcript is still in
   scope. Corroboration only — the log outlives compaction, banners do not.

## Report

Text first, in this order:

1. **The chain.** Each decision point as: what was decided, what fed it, what
   it caused. "Intake chose orchestrate because 3 independent pieces → piece 2's
   review found a shared-writer conflict → which spawned a fix batch → which
   forced a second review round on pieces 1 and 2." Follow the `fed_by` /
   `led_to` labels; where they are missing, say the link is inferred from
   ordering.
2. **Shape.** One line of counts: dispatches by model/tier, fan-out width,
   rounds, retries, and the timing span.
3. **Did it work as expected.** Compare the *decision sequence* against the
   route the intake planned — not just the counts. Name divergences plainly:
   a phase that never ran, a tier that escalated without a recorded reason, a
   fan-out that never drained (dispatches with no matching completion), a
   review round that repeated. End with `Ran as expected.` or the divergence.

Then a diagram **only when the shape genuinely benefits** — a fan-out of 10+
or a multi-phase pipeline. Small mermaid, few nodes, showing *what fed what*
(a decision flow), never a swimlane of every event. Don't make it impossible
to understand; text is better many times.

## Answering follow-ups

The user will ask why. "Why did you do that?", "how did you come to that
conclusion?", "was that right, or could it have been done better?" Answer from
the `because` and `fed_by` fields of the decision records plus session context.

When the record does not capture why, **say the record doesn't capture why**.
Never reconstruct a plausible-sounding rationale that was not written down —
a fabricated reason is worse than a gap, because it ends the investigation.
A missing `because` is itself a finding: name it so the next run records it.

## Retrospective

Run only when the user requests one or a concrete repeated failure makes a
bounded audit useful. Substantial work, fan-out, elapsed time, and multiple
repositories do not automatically require a retrospective, plan artifact, or
learning file. The default hook set does not remind at Stop or SessionEnd.

Choose a few questions from observed decisions and outcomes: why a model and
reasoning effort were selected, whether a child needed more context, whether a
review or verification repeated unchanged work, and which retries or repairs
were necessary. Compare complete accepted assignments including subagents,
retries, and repairs. Per-call prices and quota per hour do not establish cost
per correctly completed task. Astra Max is a baseline candidate for substantial
agentic work, not proof of a universal efficiency optimum.

Use recorded reasons and actual runtime outcomes. PreToolUse log entries prove
that the gate allowed an attempt, not that the child started or completed. A
missing outcome, token meter, or rationale stays unknown. Do not demand a
kickoff artifact retroactively or infer a failed run from its absence.

Report actionable findings in the answer. Create a durable learning or upstream
suggestion only when requested or when it is needed to complete the authorized
repair. Repository learning uses `compound-engineering:ce-compound` when
selected; the optional local formats live in the reference. Never create an
artifact merely to satisfy a closing ritual, and do not post messages or issues
without user authorization.
