---
name: thermo-nuclear-review
description: Deep security and correctness audit of a branch's changes. Use for thermo nuclear, thermonuclear, or deep security/correctness review requests, or when a selected review needs deeper investigation of bugs, breaking changes, security issues, devex regressions, or feature-gate leaks.
---

# Thermo Nuclear Review

Use this skill for a requested deep security and correctness audit of a
checked-out branch, or a focused pass on risks identified during another
review. Keep the selected scope; ordinary changes do not automatically need
this additional pass. Review and report findings without changing code unless
the task also authorizes fixes.

## Prompt

Audit the branch's changes for bugs, regressions, and security vulnerabilities.
Trace plausible failure and attack paths through the relevant callers,
dependencies, and tests. Prioritize depth where the change affects trust
boundaries, durable state, compatibility, or failure handling. Support each
finding with a concrete trigger and consequence; report material evidence gaps
without presenting them as confirmed defects.

# Scope
Report defects introduced or exposed by this PR. Start with the diff and
inspect unchanged code when needed to establish the changed behavior or an
affected dependency. Explain the connection to the change; unrelated existing
defects belong in a separately requested audit.

# Guidelines

## Breaking Functionality Guidelines
Simple changes can break functionality through cross-package or module
dependencies. Trace relevant callers and side effects, including unchanged
consumers whose assumptions the diff alters.

## Breaking Devex Guidelines
Check whether the changes break developers' ability to run or build the code
locally. Some examples (not exhaustive):
- Modifying how secrets are read / where they are read from
- Updating environment variable names / adding environment variables
- Remapping ports / networking
- Adding scripts that must be run for certain functionality to continue working. Broadly speaking these are changes that will modify the way developers currently run / build the code. This does not include changes that introduce new alternative ways to run/build things. Adding dependencies with package managers does not count as a devex breaking change, unless it requires the user to do some very new thing that is not part of their normal development workflow, like manually installing software off of a website / App Store.

## Failure Memory Guidelines
Error handling that reaches a WRONG and DURABLE conclusion from a failure is a
distinct defect class, and ordinary review keeps missing it: nothing crashes,
the error is handled, the tests pass — and the code now believes something
false for the rest of the process. Read `references/failure-memory.md` and
apply it to every failure branch in the diff. In short, for each `catch`,
fallback, or default: what does this now BELIEVE, for how long, was the failure
actually evidence for that belief, and does anything ever re-check it? A
cancellation is evidence about intent, not about the world; downtime is not
evidence about a server's capabilities; an incomplete walk learned nothing.
Assuming under uncertainty is fine — RECORDING the assumption as fact is the
bug.

## Feature Leak Guidelines
For changes involving feature flags or internal-only checks, trace entry points
and fallback paths to verify that the intended gate still applies.

## Intended Breakage Guidelines
If you identify a high risk finding, but the intent of the branch is to introduce that finding – e.g. break some functionality, remove a feature flag, remove a safeguard – AND the scope of the change is well constrained, you SHOULD NOT waste the author's time by reporting the issue to them. However, if you believe it is likely that they are not aware of the full implications of their change, or you are worried that they are under-weighting the negative impacts (extreme example: a developer pushes a PR titled "Delete the database"), or you are worried that the change is actually malicious, you should still report the finding.

## Over-reporting Guidelines
If you report issues as High priority when they are not in fact high priority / meaningful issues, devs will lose trust in you and stop listening to you over time.
Calibrate priority to the demonstrated impact and reachable conditions. Trace
the issue end to end with the available evidence; state any material uncertainty.

# Final Response
After the independent audit, compare medium-to-high risk findings with relevant
PR/MR discussion. Reuse discussion already collected by the CE review owner;
if it is missing and a PR exists, inspect it using gh/glab.
Validate any additional findings against the code, combine duplicates, and
attribute issues from BugBot or other reviewers that you include in the report.


# Critical Rules
- Check available code before reporting a finding. For example, inspect an
  accessible backend before alleging that a client condition is unhandled.
- Form an independent assessment before consulting additional PR/MR discussion.
- Name any unavailable evidence that limits the conclusion. A clean review is
  a scoped result, not proof that every possible defect has been excluded.
- Feed findings back to the existing review owner. CE remains the single owner
  of PR review settlement and CI monitoring; this pass does not start another
  watch loop.
