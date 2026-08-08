<!-- cross-repo links use site-absolute paths, resolved at site build -->

# The delivery lifecycle

One prompt, traced end to end. This is what happens between "go do X" and a merged, proven change
— on a single machine, with nothing else configured. Every stage below is a real mechanism, not a
diagram of an ideal.

The prompt:

```text
> Fix the flaky retry test in the billing service and get it merged.
```

## 1. Intent intake

[deliver](./skills/deliver.md) reads the request against a fixed route table and resolves the
artifact it's supposed to produce. "Fix … and get it merged" is a generic implement-and-ship
request, so it routes to the full delivery path and stops only at post-merge proof. Had you said
"just diagnose it" or "plan the fix," it would have stopped at the findings or the plan instead —
the narrower outcome always wins, and the boundary is re-read on every later instruction.

## 2. Model routing

Before anything starts, deliver calls [model-routing](./skills/model-routing.md) with contract
`railyard/model-routing/v1`. No model call, provider probe, or task creation runs ahead of it.
With no catalog configured, the router returns the no-config default for an implementation unit —
Opus `high` on Claude Code. That decision is frozen and handed back for the workflow to actually
use.

Every subagent dispatched from here names an explicit model and effort. A `PreToolUse` hook
refuses any dispatch that omits the model field, so routine steps can't quietly inherit the
session's premium tier.

## 3. Plan and implement

deliver hands the feature brief to `compound-engineering:lfg` — the Compound Engineering workflow
engine that plans, implements, simplifies, and opens the PR. railyard drives it but never modifies
it; Compound Engineering is a credited [dependency](./credits.md), not part of railyard's own
code. LFG owns its internal stages; deliver doesn't wrap or reorder them. ponytail, the other
credited required dependency, runs alongside — its efficiency reflex is what deliver applies to
the verification loop: scoped, tiered checks over full re-runs, independent work isolated in its
own worktree converging to one PR, and a "green" trusted only when it's the process's own unmasked
exit, actually run.

For this fix, LFG plans the change, reproduces the flake, writes the fix and a deterministic test,
and runs `ce-simplify-code` over the result.

## 4. The Thermos gate

Before the change commits, the [Thermos](./skills/thermos.md) gate runs. Both review lenses launch
in parallel against the same frozen packet — the staged diff's digest, the relevant source
context, and the requirement it's meant to satisfy:

- **`thermo-nuclear-review`** traces the retry logic against the existing queue consumer and finds
  a partial-write-on-failure case with no idempotent retry story.
- **`thermo-nuclear-code-quality-review`** notices the fix added a second, near-duplicate retry
  helper when an existing one already covers the case, and flags it as canonical-helper
  duplication — not a style nit.

Thermos synthesizes both into one findings list, deduplicated. Both get fixed before the chunk
commits; anything not fixed is recorded with its evidence rather than dropped.

## 5. The React gate

If the diff had touched React, Next UI, or any browser-visible behavior, deliver would run
`npx react-doctor@latest --staged --no-score` before committing and fix real findings first. A
billing-service test fix touches no UI, so this gate is skipped — and the skip is explicit, not
silent.

## 6. Commit, push, PR

LFG commits, pushes, and opens the pull request. Alongside it, deliver runs a lightweight
checkpoint monitor that pushes clean, stable commits as the work advances — so another agent or
machine could resume — and stops that monitor once LFG reaches its own commit/push/PR stage.

## 7. The delivery tail

This is the part deliver owns that LFG doesn't. When LFG returns, deliver doesn't report "merge
ready" and stop. It:

1. **Settles the PR.** It consumes any bounded watch LFG hands back and keeps going through
   `ce-babysit-pr` until review, CI, branch currency, and stack state are all settled — without
   waiting for a new request from you.
2. **Confirms independent review.** It checks that the review evidence includes an independent
   Sol High or Sol Max pass. If that's missing, it runs that read-only review before merge, fixes
   anything actionable with the implementation model, and reruns the affected checks — the model
   that wrote the code never merges on the strength of only its own self-review.
3. **Merges.** Once no explicit hold remains, it merges with the repository's configured strategy
   (`gh pr merge <pr> --squash|--merge|--rebase`). A stacked set merges in dependency order via
   `gh-stack`.

## 8. Post-merge proof

deliver proves the merge actually landed rather than asserting it:

```bash
gh pr view <pr> --json state,mergedAt,mergeCommit
git merge-base --is-ancestor <merge-commit> origin/<base>
```

Then it runs the smallest applicable post-merge check — here, the retry test itself against the
merged base — and reports those artifacts. "CI is green" is never the finish line; the merge
commit reachable from `main` plus a real check passing is.

## 9. Durable learnings

Because a review pass surfaced a real, reusable mistake (the missing idempotent-retry story),
deliver invokes `compound-engineering:ce-compound mode:headless depth:full` to capture it as a
repo learning before the final summary. Cross-repo routing lessons would instead append to
`~/.config/railyard/learnings.md`. Typo fixes and one-liners skip this step.

For a substantial run this is not left to chance: the run closes with its **retrospective as a
mandatory step** — [audit](./skills/audit.md)'s loop generates pointed questions about the run,
grades it against the approach recorded at kickoff, and lands its lessons in those same two sinks,
plus a skill-improvement suggestion file when the fix belongs upstream. A Stop (Claude Code) /
SessionEnd (Codex) hook is the backstop that reminds when a substantial run would end without it —
metadata only, never blocking the stop. On request, `audit` reconstructs the whole run from the
same run log — the route chosen, the models dispatched and why, the extra review pass, the fix
batch — and compares it against the shape the intake planned. The trail outlives the transcript.

## The shape, in one line

```text
intent → routed → planned → implemented → gated → reviewed → merged → proven → learned
```

Six of those are distinct states railyard tracks separately: a pushed checkpoint, a review-ready
branch, an open PR, green CI, a merged change, and post-merge proof. An explicit stop from you or
the repository can end the route at any earlier one — but left alone, it carries to the end and
tells you exactly which state it reached.

## The same shape across machines

Add a [fleet](/roundhouse) and this lifecycle doesn't change — routing, gates, merge, and proof
are identical. What's added is a placement decision at the front:
[orchestrate](./skills/orchestrate.md) verifies each destination is ready, places a visible task
on the right host, and tracks the graph of lanes to completion. Each lane still runs the delivery
above. See [railyard on one machine](./single-machine.md) for the full single-host surface, and
the [roundhouse lifecycle](/roundhouse/lifecycle) for the fleet-side view.
