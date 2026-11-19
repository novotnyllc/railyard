# Review feedback settlement

Pass this policy to the CE settlement owner (`ce-babysit-pr`,
`ce-resolve-pr-feedback`, or LFG's loop) as a project settlement requirement.
CE collects PR feedback and CI results and owns each repair batch. Apply the
dispositions below as the project rules when CE judges feedback.

## Batch repairs

Read the actionable feedback already posted and group reports of the same
root concern across reviewers and revisions. Address the available batch
while reviews or checks are running. Apply fixes together, complete the
[local review before publication](whole-candidate-review.md), and push the
batch once. Refresh the PR after publication before acting on new feedback or
failed checks tied to a revision.

## One disposition per thread

Give every review thread exactly one disposition and post a reply:

- **Fix** in this PR. Name the commit and verify it is on the published head.
- **Decline** with a one-line reason and the relevant evidence. Use this for
  feedback that is incorrect, already addressed, or superseded by an explicit
  owner decision. Explain that decision when it governs the finding.
- **Follow-up** when the PR can ship safely and the work has independent value.
  Search the repository or tracker that owns the work and link an existing
  issue for the same root concern. If none exists, open one with the actionable
  work and the source feedback link. Use that one issue for every duplicate
  thread. Verify the issue exists before replying with its link. Use CE’s
  reply-only path for this disposition.

Verify the submitted reply is visible before resolving the thread. On retry,
check for the reply, issue, and resolution before repeating any write. If an
issue cannot be created or verified, leave the actionable thread open and
report the blocker. Answer actionable review summaries and top-level comments
with the same dispositions.

A finding beyond inherited authority (CE's `needs-human`) stays open and goes
to the user. Act on the decision once the user answers.

## Severity and automated feedback

Classify the finding by its impact and evidence. Treat P0 as P1. Downgrading a
reviewer's P0 or P1 requires the same evidence as declining a P1.

| Severity | Meaning | Default |
| --- | --- | --- |
| P1 | Defect that makes the change unsafe or incorrect to ship | Fix. Decline only with evidence the finding is wrong or an explicit owner decision permits it. |
| P2 | Bounded defect or gap that can ship independently | Fix when small and in scope. Otherwise open or link a follow-up. |
| P3 or nit | Style, wording, or preference | Fix if trivial. Follow up if independently useful. Decline the rest. |

Use one routine automated repair batch per PR, shared across all reviewers.
Collect actionable findings from any provider, deduplicate, and publish the
verified fixes together. Count a push only when it repairs a substantive bot
finding. On resume, match the published commit to that finding using the
thread reply or watcher result. CI-only and human-only repairs leave the batch
available. After the batch, defer safe P2 findings with independent value even
when small. Fix actual blockers on every head. Apply the ordinary disposition
to human feedback.

An optional reviewer that is silent, skipped, cancelled, or out of quota
requires no wait or retry. Handle any substantive findings it already posted.
For a visibly queued or running review, allow CE’s existing bounded wait once.
After that budget expires, or when the optional review is absent or terminal,
refresh the current head, required checks, approvals, threads, and queue rules.
Continue only when those confirm eligibility. Preserve the actual conclusion.
A required check or approval still blocks when unavailable. If GitHub cannot
be read or requiredness is unclear, report readiness as unknown. Actual blockers,
decisions requiring the user, and repository-required reviews and checks
still govern readiness.

Once CE settles the current head and GitHub or the repository's merge queue
can proceed, continue promptly to the authorized merge or enqueue. A new
optional review round is never a prerequisite for that handoff. Honor open
blocking feedback and required review or CI at the head being landed. In
`full` review mode, record the linked follow-up's disposition in the receipt.
