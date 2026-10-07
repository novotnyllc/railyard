# Review feedback settlement

The delivery owner passes this policy to the CE settlement owner
(`ce-babysit-pr`, `ce-resolve-pr-feedback`, or LFG's loop) as a project
settlement requirement. CE still owns settlement; this sets how each review
thread is decided so feedback is always handled and a PR does not cycle
through review rounds indefinitely. Requiring every review conversation to be
resolved stays: resolved means dispositioned, not necessarily fixed.

## One disposition per thread

Give every review thread exactly one disposition, record it in a reply, then
resolve the thread:

- **Fix** in this PR. The reply names the commit.
- **Decline** with a one-line reason: out of scope, incorrect, already
  handled, or superseded by an owner decision.
- **Follow-up**: open a linked issue, or a tracked task where the repository
  has no issues, in the repository that owns the affected code, and resolve
  the thread with a reply that links it. This policy authorizes those
  follow-up issues.

Resolve a declined or deferred thread as soon as its reply is posted; never
resolve a thread without a reply. Answer an untargeted review summary or
top-level comment the same way when it carries an actionable finding.

## Severity defaults

Classify each finding by its substance; a reviewer's label is evidence, not
the decision.

| Severity | Meaning | Default |
| --- | --- | --- |
| P1 | Real bug, security issue, or data loss | Fix. Decline only when it is demonstrably wrong or contradicts an explicit owner decision. |
| P2 | Real but bounded defect or gap | Fix when small and within the PR's scope; otherwise follow-up. |
| P3 or nit | Style, wording, preference | Fix if trivial; otherwise decline. |

## Round cap

A round is an automated review of a new head. After the second automated
round on the same PR, newly raised P2s and nits default to follow-ups; only a
new P1 still blocks the merge. Cluster repeats of the same root concern,
across rounds and reviewers, into one fix or one follow-up and point each
duplicate thread at it.

## Owner decisions

Explicit owner decisions outrank reviewer suggestions. Decline a comment that
asks to restore something the owner explicitly removed, citing that decision.

## Receipt and ledger

In the [whole-candidate review gate](whole-candidate-review.md) receipt, a fix
is fixed with proof, a decline is rejected with rationale, and a follow-up is
accepted under this owner-set policy with its issue link. In the delivery
ledger, a valid deferred finding still counts as escaped, but only a published
repair makes a revision round. A repair push still passes the gate before it
publishes.
