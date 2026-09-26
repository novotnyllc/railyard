# CE result handoff for merge

CE owns review settlement and CI. Railyard's shell guard consumes its completed
result and checks PR identity; it never starts CE, watches CI, judges reviewer
signals, or waits for a review timer. It covers recognized `gh` merge commands,
not arbitrary API clients or a stack manager's internal transport.

## Handoff from the existing CE owner

1. Complete the selected `ce-babysit-pr` mode. Interactive settlement includes
   CE's judgment about reviews still coming; pipeline mode uses CE's bounded
   success conditions. A `BABYSIT_WAKE` with `reason: merge-ready` is only a
   candidate, and `state.json` has no persisted settlement verdict.
2. Retain the final successful `pr-snapshot snapshot` stdout unchanged as
   `snapshot.json` beside that invocation's `state.json`. Capture the normal
   final snapshot within CE using its existing invocation parameters. Write to
   a temporary file and rename only after the command succeeds. Do not start
   another invocation or fetch solely to manufacture a passing handoff.
3. Pass that absolute path in `RAILYARD_CE_SNAPSHOT` on the authorized merge,
   and pass its full `head_sha` to `gh pr merge --match-head-commit`. Use a
   literal absolute path in the shell call so the guard can read it before the
   shell runs. Follow the repository's merge strategy. Do not queue an auto
   merge that could execute after this evidence changes.

The guard defaults to CE's `pipeline` success contract, including at least one
observed check. If the CE owner completed interactive settlement instead, set
`RAILYARD_CE_MODE=interactive`; that mode permits a settled repository without
configured checks. Other mode values fail explicitly. Selecting a mode never
replaces CE's decision or changes its workflow.

For example, substitute the actual state path, PR, repository, and full head:

```sh
RAILYARD_CE_SNAPSHOT=/absolute/ce-state/snapshot.json gh pr merge 123 --repo OWNER/REPO --squash --match-head-commit FULL_HEAD_SHA
```

## User-directed merge override

When the user explicitly directs a specific merge without CE settlement —
for example "merge it now" or "bypass branch protection" — prefix that one
merge command with `RAILYARD_MERGE_OVERRIDE=user-approved`. The guard then
allows it without a snapshot, head pin, or live identity read, and `--admin`
is permitted:

```sh
RAILYARD_MERGE_OVERRIDE=user-approved gh pr merge 123 --repo OWNER/REPO --squash --admin
```

The override must be an inline assignment in the command text; an ambient
environment variable is ignored and any other value is ignored. It applies
only when the command holds exactly one `gh pr merge` or REST merge that
names its PR literally (a number, branch or URL, with any `--repo` also
literal) and contains no loop, function, `xargs` or `parallel` that could
re-run it. Two merges in one command, a variable selector, or a raw GraphQL
merge are still refused. Do not use it on your own initiative or
because a reviewer is slow — use it only on the user's explicit instruction.

The selected handoff asserts that the CE owner completed its judgment. A raw
snapshot alone is not proof of that judgment. The guard checks the snapshot's
readiness fields, absence of actionable work and blockers, and matching latest
CE invocation, tick, head, and base. It requires CE evidence observed within
five minutes, then performs one bounded live identity check against the PR's
current head and base ref. This is a freshness limit, not a reviewer wait.

Missing, malformed, stale, superseded, or mismatched evidence refuses the merge
with a recovery message. Continue the same CE owner, resolve its remaining
work, and hand off its refreshed result. An unavailable GitHub identity check
also refuses; it is not a settlement pass. Ordinary shell commands and local
work do not read CE state or contact GitHub.

This is a point-in-time workflow guard, not a cryptographic attestation or a
replacement for server branch protection. CE remains responsible for review
judgment and late review activity. The head match prevents a concurrent push
from silently changing the commit being merged; GitHub still enforces its
configured checks and merge rules.

The adapter is tested against CE 3.25.0's snapshot/state fields and checked
against CE 3.22.4 and 3.26.2 producers with green, empty-check, and pending-check
results. If CE changes that contract, an incompatible result fails explicitly;
update the adapter from the actual installed contract rather than weakening
the check.
