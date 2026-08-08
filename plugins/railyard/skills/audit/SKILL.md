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

The closing step of a substantial run — not merely on-request. Every
substantial deliver/orchestrate run runs it before it declares done; the
Stop (Claude Code) / SessionEnd (Codex) hook is the backstop that reminds when
a substantial run would end without one. Run it also whenever asked how the
work could have gone better.

Read the audit report and the session history, then **generate 3–7 pointed
questions specific to this run** — not a fixed checklist — and answer each
against the evidence. Question quality is the whole skill here: "phase 3
dispatched 4 workers sequentially that had no data dependency — why not
parallel?" beats "was parallelism used?".

**Grade the run against its kickoff approach.** A substantial run records an
`approach` decision line at the start — the loop, isolation boundary, and
done-evidence an excellent engineer would have chosen for *this* run. Compare
what actually happened against it as one lens: did first principles fire, or
was the literal route executed and stopped at? A missing `approach` line is
itself the first finding — name it so the next run derives one. This is the
same lens for the process reflex (worktree isolation, scoped verification,
verify-don't-trust) the charter names: was it applied, or re-learned mid-run?

Look for waste the log makes visible: sequential dispatches with no
dependency, duplicated reading across workers, a tier higher than the work
needed, the same expensive command re-run on unchanged input, a review round a
chunk gate would have prevented, a self-noted loop-tightener deferred for
iterations, an abandoned dispatch nobody noticed.

Every answer that yields an improvement lands in one of two sinks, per the
reference — and producing at least one concrete sink entry (or a plain "nothing
was wasteful here", honestly reached) is what makes the retrospective real
rather than ceremony:

- **Local learning** — repo-scoped lessons go to
  `compound-engineering:ce-compound` (its `<root>/solutions/` store owns that
  surface); only cross-repo routing/run-shape lessons append to
  `~/.config/railyard/learnings.md`. Read that file first so a lesson is not
  learned twice.
- **Upstream suggestion** — one file under `~/.config/railyard/suggestions/`,
  written to be postable as a GitHub issue verbatim.

Writing a suggestion is not permission to post it or to implement it. Offer
both paths and stop.
