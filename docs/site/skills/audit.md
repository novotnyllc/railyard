<!-- cross-repo links use site-absolute paths, resolved at site build -->

# Audit

Audit reconstructs how a chunk of agent work actually ran — which skills routed,
what decided what, how many subagents fanned out on which models and why,
retries, review rounds, and whether it matched the planned shape. It reads the
railyard run log, not the code diff, so it answers "how did this run go?" rather
than "what did the change touch?" Every deliver or orchestrate completion already
ends with a short recap; audit reconstructs the full decision chain on request.

## When to use it

- You ask how a run worked, or to audit the last run.
- You ask why a route or model was chosen, or whether a run went as expected.
- You want a retrospective on how the work could have been done better.
- Something fanned out wider, escalated higher, or repeated a review round and you
  want to see where and why.

## How it works

### Scope the run

Audit defaults to the last run — the most recent `session` line in the run log
and everything after it — and widens only when you name a window ("this week",
"that run yesterday"). It reads the small per-day log files directly. When the
window is empty or the log starts mid-run, it says so plainly rather than
interpolating: a run that predates the recorder, or a session whose SessionStart
hook did not fire, is a gap to name, not to guess at.

### Sources

- **Run log** — the spine: mechanical `session` / `dispatch` / `subagent_stop`
  lines plus the session's own `decision` / `outcome` / `deviation` lines. It
  outlives transcript compaction.
- **Model routing state** — what was actually admitted and claimed, read through
  `railyard:model-routing`'s read-only `status` and `inspect-claim` commands. See
  [model-routing.md](./model-routing.md). Audit never resolves a new decision.
- **Dispatch banners** in the transcript, as corroboration only, when the
  transcript is still in scope.

### The report

Text first, in order:

1. **The chain** — each decision point as what was decided, what fed it, and what
   it caused, following the `fed_by` / `led_to` labels. Where a link is only
   inferred from ordering, audit says so.
2. **Shape** — one line of counts: dispatches by model or tier, fan-out width,
   rounds, retries, and the timing span.
3. **Did it work as expected** — the decision sequence compared against the route
   the intake planned, naming divergences plainly (a phase that never ran, a tier
   that escalated with no recorded reason, a fan-out that never drained, a review
   round that repeated). It ends with `Ran as expected.` or the divergence.

A diagram appears only when the shape genuinely benefits — a large fan-out or a
multi-phase pipeline — and shows what fed what, never a swimlane of every event.

### Retrospective

The closing step of a substantial run — not only on request. It generates a
handful of pointed questions specific to that run and answers each against the
evidence — waste the log makes visible: sequential dispatches with no dependency,
duplicated reading across workers, a tier higher than the work needed, the same
expensive command re-run on unchanged input, a self-noted loop-tightener deferred
for iterations, an abandoned dispatch nobody noticed. It also **grades the run
against the approach it recorded at kickoff** — did the run derive its loop,
isolation, and done-evidence from first principles, or execute the literal route
and stop? Improvements land in one of two sinks: repo-scoped lessons go to
`compound-engineering:ce-compound`; cross-repo routing or run-shape lessons append
to `~/.config/railyard/learnings.md`, and an upstream-worthy note becomes one file
under `~/.config/railyard/suggestions/`, written to be postable verbatim.

A Stop (Claude Code) / SessionEnd (Codex) hook is the backstop: when a substantial
run — a small fan-out of dispatches or more — would end without a recorded
retrospective, it reminds you to run this loop. The hook only surfaces the
reminder; it reads the run log's own counts, captures no prompt or content, and
never blocks the session ending.

## Boundaries

- Audit reads evidence; it never mutates state and never resolves a new routing
  decision during an audit.
- When the record does not capture why a thing happened, audit says the record
  doesn't capture why — it never reconstructs a plausible rationale that was not
  written down. A missing reason is itself a finding.
- Writing a suggestion is not permission to post or implement it. Audit offers the
  paths and stops.

## Example session

**Prompt:** "How did that last delivery actually run — did it go as planned?"

**What happens:** Audit scopes to the most recent `session` line and reads
forward. It walks the chain: intake chose orchestrate because three independent
pieces were in play, piece 2's review found a shared-writer conflict, which
spawned a fix batch, which forced a second review round on pieces 1 and 2. The
shape line reports the dispatch counts, fan-out width, and the two review rounds.
The "did it work as expected" section notes the extra review round the intake
plan did not anticipate, names the shared-writer conflict as its cause from the
`led_to` label, and closes on that divergence rather than a bare `Ran as
expected.`
