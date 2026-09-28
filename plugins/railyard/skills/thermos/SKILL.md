---
name: thermos
description: "Combine targeted correctness/security and maintainability reviews. Railyard's recommended end-of-PR review, run beside Codex review; also use when the user asks or a change's risk justifies it. Supplies findings; not a merge gate."
---

# Thermos

Run the two thermo review passes as async background subagents in parallel, then synthesize their results.

Use it when the user asks for it or when a change's risk needs both
correctness/security and maintainability depth; for a single concern, use the
relevant sibling skill directly. Choose each reviewer's model and reasoning
effort with `railyard:model-routing`. When Compound Engineering owns a
cross-model review mechanism, use it rather than launching a separate provider
runner.

## Workflow

1. Determine the review scope from the user request, PR, current branch, or relevant changed files.
2. Gather the diff and any file/context excerpts needed for reviewers to evaluate the change without guessing. Keep the reviewed snapshot stable while reviewers run, and include useful existing test results and known limitations.
   - Frozen review packet (opt-in): when the user or the calling workflow's contract asks for one, freeze a deterministic packet instead: objective and stop condition, exact diff/file digests, relevant source excerpts, requirement map, changed runtime-artifact chain, and reusable hash-bound validation results. Reviewers then do not rerun unchanged broad suites. Routine Thermos runs do not need a packet.
3. Reuse a completed review only when it covers the same inputs and concern with the independence the caller needs. Launch the uncovered passes, normally both, in parallel:
   - Correctness/security, for bugs, breakages, security, devex regressions, feature-flag leaks, and other branch-audit risks: give the reviewer the full instructions of `../thermo-nuclear-review/SKILL.md` and its `references/failure-memory.md`.
   - Maintainability, for structure, file-size growth, spaghetti, abstractions, and codebase-health risks: give the reviewer the full instructions of `../thermo-nuclear-code-quality-review/SKILL.md`.
   - Claude Code: launch both reviewers as two `Agent` tool calls in one message (fresh-context background subagents). Codex: spawn two `explorer` subagents in parallel, attaching the sibling skill, or including its instructions in the prompt when structured skill attachments are unavailable. Use a registered thermo review agent type only after confirming it exists.
4. Pass each subagent the same scoped diff/file context in a self-contained brief (a fresh reviewer has none of this conversation's history) and ask it to return prioritized findings with file references and evidence, plus an explicit disposition for its concern. Reviewers do not edit the shared tree.
   - Where the change ships a runtime artifact (script, hook, manifest, package, or installed file), have the reviewer validate the actual producer, package, install, and consumer path. An actual delivery/packaging risk is a finding; a missing formal receipt alone is not.
5. Wait for every launched reviewer to finish through the native wait/result mechanism; acknowledgement and progress are not a completed review. Then synthesize the results with findings first, deduplicated across reviewers. Weight overlapping findings more heavily, resolve disagreements with your own judgment, and keep summaries brief. Launch a further reviewer only for a specific unresolved question.
6. Return the unified verdict to the workflow owner. CE owns review settlement and CI: when CE owns delivery, it resolves feedback, settles review, and monitors CI. Thermos supplies findings and starts no watcher, re-review loop, or merge gate.

If individual background summaries are already visible to the user, do not restate them wholesale. Surface the unified verdict, the highest-signal findings, and any remaining uncertainty.
