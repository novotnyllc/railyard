# Review feedback settlement

The delivery owner passes this policy to the CE settlement owner
(`ce-babysit-pr`, `ce-resolve-pr-feedback`, or LFG's loop) as a project
settlement requirement. CE still owns settlement; this policy decides each
review thread so feedback is always handled and a PR does not cycle through
review rounds indefinitely. Every thread still gets resolved; resolved means
dispositioned, not necessarily fixed.

## One disposition per thread

Give every review thread exactly one disposition, record it in a reply, then
resolve the thread:

- **Fix** in this PR. The reply names the commit.
- **Decline** with a one-line reason: out of scope, incorrect, already
  handled, or superseded by an owner decision. Explicit owner decisions
  outrank reviewer suggestions: decline a request to restore something the
  owner explicitly removed, citing that decision.
- **Follow-up**: open an issue in the repository that owns the affected code
  (or an item in its issue tracker when it has no GitHub issues), and reply
  with the link. This policy authorizes those follow-up issues; they are not
  agent tasks or sessions.

Resolve a declined or followed-up thread once its reply is posted, and only
then. Answer an actionable finding in a review summary or top-level comment
the same way.

A finding that needs a decision beyond the inherited authority (security
posture, auth, billing, data retention, migrations, or a product call; CE's
`needs-human`) stays open and goes to the user; it becomes a
decline or follow-up only after the user's answer.

## Severity defaults

Classify each finding by its substance; a reviewer's label is evidence, not
the decision. Treat P0 as P1. Downgrading a reviewer's P0 or P1 is a P1
decline: the reply shows it is wrong or cites the owner decision.

| Severity | Meaning | Default |
| --- | --- | --- |
| P1 | Real bug, security issue, or data loss | Fix. Decline only when it is demonstrably wrong or contradicts an explicit owner decision. |
| P2 | Bounded defect or gap that breaks no user path | Fix when small and within the PR's scope; otherwise follow-up. |
| P3 or nit | Style, wording, preference | Fix if trivial; otherwise decline. |

## Round cap

Each new head that automated reviewers review is one round, however many
automated reviewers comment on it. After the second round on the same PR,
newly raised P2s and nits default to follow-ups; only a new P1 still blocks
the merge. Cluster repeats of the same root concern, across rounds and
reviewers, into one fix or one follow-up and point each duplicate thread at
it.

## Receipt

The [whole-candidate review gate](whole-candidate-review.md) receipt records a
follow-up under this policy as an accepted finding with its issue link. A
repair push still passes the gate before it publishes.
