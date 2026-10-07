---
name: thermos
description: "Run paired whole-candidate correctness/security and maintainability reviews before publication, alongside Codex review. Also use for standalone reviews. Supplies findings to the existing owner."
---

# Thermos

Run the two thermo review passes as concurrent subagents, collect both results directly, then synthesize them.

Use it before every push in `railyard:deliver`, where it runs beside
`codex review` and its findings go to the CE owner; also use it when the user
asks for it or when a change's risk needs both correctness/security and
maintainability depth. For a single concern, use the relevant sibling skill
directly. Choose each reviewer's model and reasoning effort with
`railyard:model-routing`. Thermos itself launches no other provider's review;
the Codex review beside it is the caller's to run.

## Workflow

1. For delivery or publication, read the [whole-candidate review gate](../../references/whole-candidate-review.md). Scope both passes to the complete cumulative change-set and affected lifecycle, even for a focused fix. For a standalone review, honor an explicitly narrower user scope and label that limitation; it cannot satisfy the publication gate.
2. Freeze the exact candidate and gather its cumulative diff, unchanged dependencies, entrypoints, contracts, host-preservation requirements, and failure paths. Include existing proof and known limitations. Publication requires the gate's hash-bound coverage receipt; a larger frozen packet remains optional. Diff scope bounds reported defects, not investigation.
   - Revalidate the whole candidate before every push. Reuse prior proof only for unchanged inputs and behaviors with matching hashes and assumptions; investigate changed interactions and uncovered boundaries. Reviewers need not rerun broad suites whose proof remains valid.
3. Reuse a completed review only when it covers the same inputs and concern with the independence the caller needs. Launch the uncovered passes, normally both, in parallel:
   - Correctness/security, for bugs, breakages, security, devex regressions, feature-flag leaks, and other branch-audit risks: give the reviewer the full instructions of `../thermo-nuclear-review/SKILL.md` and its `references/failure-memory.md`.
   - Maintainability, for structure, file-size growth, spaghetti, abstractions, and codebase-health risks: give the reviewer the full instructions of `../thermo-nuclear-code-quality-review/SKILL.md`.
   - Launch both reviewers concurrently and collect their results directly rather than waiting on background completion notices: a nested background subagent's completion notice can go to the top-level session instead of this coordinator, which then waits on reviews that already finished.
     - Claude Code: two foreground (blocking) `Agent` calls issued together in one message, so both run concurrently and return their results as tool results.
     - Codex: `spawn_agent` returns immediately, so spawn both reviewers together (read-only `explorer` role where available), then collect both final reports with `wait_agent` or the native result mechanism before continuing.
   - Attach the sibling skill, or include its instructions in the prompt when structured skill attachments are unavailable. Use a registered thermo review agent type only after confirming it exists.
4. Pass each subagent the same complete candidate and lifecycle context in a self-contained brief (a fresh reviewer has none of this conversation's history) and ask it to return prioritized findings with file references and evidence, plus an explicit disposition for its concern. Reviewers do not edit the shared tree.
   - Where the change ships a runtime artifact (script, hook, manifest, package, or installed file), have the reviewer validate the actual producer, package, install, and consumer path. An actual delivery/packaging risk is a finding; a missing formal receipt alone is not a code defect. For publication, missing required receipt evidence still blocks the publishing decision under the gate.
5. Collect every launched reviewer's final report; a spawn acknowledgement or progress update is not a completed review. Then synthesize the results with findings first, deduplicated across reviewers. Weight overlapping findings more heavily, resolve disagreements with your own judgment, and keep summaries brief. Launch a further reviewer only for a specific unresolved question.
6. Return the unified verdict, coverage and known unverified boundaries, evidence hashes, and findings disposition to the workflow owner for the publication receipt and delivery ledger. For delivery, grade each finding and propose its default disposition by the [review feedback settlement policy](../../references/review-feedback-settlement.md). CE owns review settlement and CI: when CE owns delivery, it resolves feedback, settles review, and monitors CI. Thermos supplies findings and starts no watcher, re-review loop, or merge gate.

If individual reviewer summaries are already visible to the user, do not restate them wholesale. Surface the unified verdict, the highest-signal findings, and any remaining uncertainty.
