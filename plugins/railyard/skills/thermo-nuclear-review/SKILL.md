---
name: thermo-nuclear-review
description: Deep security and correctness audit of a branch's changes. Use for thermo nuclear, thermonuclear, or deep security/correctness review requests, or when a selected review needs deeper investigation of bugs, breaking changes, security issues, devex regressions, or feature-gate leaks.
---

# Thermo Nuclear Review

A deep security and correctness audit of a checked-out branch, or a focused
pass on risks found during another review. Keep the selected scope, and report
findings without changing code unless the task also authorizes fixes.

## Audit

Audit the branch's changes for bugs, regressions, and security
vulnerabilities. Trace plausible failure and attack paths through the relevant
callers, dependencies, and tests, going deepest where the change touches trust
boundaries, durable state, compatibility, or failure handling. Support each
finding with a concrete trigger and consequence, and name material evidence
gaps without presenting them as confirmed defects.

Report defects the branch introduces or exposes. Start from the diff and read
unchanged code as needed to establish the changed behavior or an affected
dependency, explaining the connection. Unrelated existing defects belong in a
separately requested audit.

## What to look for

**Broken functionality.** Small changes break things through cross-package or
module dependencies. Trace callers and side effects, including unchanged
consumers whose assumptions the diff alters.

**Broken developer experience.** Flag changes to how developers run or build
the code locally: where or how secrets are read, renamed or new environment
variables, remapped ports or networking, or new scripts that must be run for
existing functionality to keep working. New alternative ways to run or build
do not count, and neither do ordinary package-manager dependencies unless they
require something outside the normal workflow, such as manually installing
software from a website or app store.

**Failure memory.** Error handling can reach a wrong conclusion from a failure
and keep it: nothing crashes, tests pass, and the code now believes something
false. Read [failure memory](references/failure-memory.md) and apply it to
every `catch`, fallback, and default in the diff.

**Feature leaks.** For feature flags or internal-only checks, trace entry
points and fallback paths to confirm the intended gate still applies.

## Calibration

When a high-risk change is the branch's evident intent (breaking some
behavior, removing a flag or safeguard) and its scope is well constrained,
skip it. Report it anyway when the author may not see its full implications,
may be under-weighting the impact (a PR titled "Delete the database"), or the
change may be malicious.

Set priority by demonstrated impact under reachable conditions; an inflated
High erodes trust in every other finding. Trace each issue end to end and
state material uncertainty.

Check available code before reporting: for example, inspect an accessible
backend before alleging a client condition is unhandled. A clean review is a
scoped result, not proof that no defect exists; name any unavailable evidence
that limits the conclusion.

## Final response

Form an independent assessment first. Then compare medium-to-high findings
with relevant PR/MR discussion, reusing what the CE review owner already
collected, or inspecting it with `gh`/`glab` when a PR exists. Validate any
additional findings against the code, merge duplicates, and attribute issues
from BugBot or other reviewers that you include.

Return findings to the existing review owner. CE owns PR review settlement and
CI monitoring; this pass starts no watch loop of its own.
