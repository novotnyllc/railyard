---
name: thermos
description: "Combine targeted correctness/security and maintainability reviews when explicitly requested or justified by substantial risk. Optional deep review; not a routine delivery gate."
---

# Thermos

Run a combined deep review when the user asks for one or when a change's risks
need both correctness/security and maintainability expertise. For a single
concern, use the relevant sibling skill directly. Ordinary work does not need
Thermos or an extra review after the delivery workflow has covered the
relevant concerns.

Choose each reviewer's model and reasoning effort with
`railyard:model-routing`. When Compound Engineering owns a cross-model review
mechanism, use it rather than launching a separate provider runner.

## Workflow

1. Establish the reviewed base/head or changed file set, the objective,
   relevant requirements, and the two concerns. Keep the review snapshot
   stable while reviewers run, and include useful existing test results and
   known limitations.
2. Reuse a completed review that covers the same inputs and concern with the
   independence the caller needs. Launch only uncovered concerns, in parallel
   when independent:
   - Correctness/security: read `../thermo-nuclear-review/SKILL.md` and its
     references, and pass that guidance with the scoped brief.
   - Maintainability: read `../thermo-nuclear-code-quality-review/SKILL.md`
     and pass that guidance with the scoped brief.
   Use a registered review agent type only after confirming it exists;
   otherwise include the instructions in a generic subagent's brief.
3. Ask each reviewer for prioritized, evidence-backed findings and an explicit
   disposition of its concern. Reviewers inspect the changed behavior and its
   dependencies without editing the shared tree, reuse unchanged test results,
   and run further checks only to resolve a concrete gap.
4. Collect every launched review through the native wait/result mechanism;
   acknowledgement and progress are not a completed review. Deduplicate
   overlaps and resolve disagreements. Launch a further reviewer only for a
   specific unanswered question.
5. Return the unified verdict, actionable findings, coverage, and remaining
   uncertainty to the workflow owner. When CE owns delivery, it resolves
   feedback, settles review, and monitors CI; Thermos supplies findings and
   starts no watcher, re-review loop, or merge gate.

Report what the combined review changes about the decision rather than
restating each reviewer's summary.
