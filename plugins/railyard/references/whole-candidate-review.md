# Whole-candidate review before publication

The delivery owner applies this gate before every push: initial publication,
feedback repairs, rebases, release/version changes, stack updates, and pushes
inside CE or LFG. It is a project publishing requirement supplied to the CE
publisher, not a second settlement watcher. Review does not authorize a push
outside the user's endpoint. A focused implementation assignment or a narrow
child handoff does not narrow the integration owner's review scope.

## Candidate and investigation

Resolve the intended target repository, branch, base commit, and exact candidate
commit/tree. Review the complete cumulative change-set against the integration
base, never only the latest commit or last few changed lines. For stacks, cover
each pushed head against its intended base plus interactions across the stack;
record those bases and heads. If a base or target is unresolved, stop publication.
Include every intended published file, including manifests, version bumps,
generated artifacts, deletions, renames, and executable/mode changes. Do not
include or disturb unrelated work. A provisional index/worktree review is valid
only if the final published tree matches it and the final commit and base are
bound in the receipt. Changed commit metadata requires renewed identity checks;
changed tree, base, requirements, or dependencies requires renewed review.

Use the existing Thermos correctness/security and maintainability passes alongside
Codex review, using the allocation selected by model-routing. Their completed
reports can fulfill this gate; do not add a third review tree or watcher. Supply both reviewers
with the complete candidate, user requirements, and affected lifecycle. Trace
unchanged dependencies and real entrypoints through producer, packaging,
publication, installation, startup, and consumer contracts where applicable.
Check host-owned state preservation and legal existing input forms. Investigate
failure paths, prerequisite ordering before writers, partial application,
recovery/idempotence, and false success from stale state or diagnostic streams.
Diff scope bounds reported defects, not investigation: report defects introduced
or exposed by the candidate, including interactions with unchanged code, rather
than unrelated historical issues. Tests, matching bytes, and receipts prove only
the behaviors and inputs they actually cover.

Before each push, revalidate the complete candidate and coverage map. Reuse
prior review/proof only for unchanged inputs and behaviors: compare their hashes,
requirements, dependency/runtime identities, assumptions, and affected
interactions. Recheck changed interactions and uncovered boundaries; a new receipt
must explain reused evidence. A previous clean verdict is not transferable to
new code merely because the newest patch is small. Collect every required
reviewer's completed report; progress or spawn acknowledgements are insufficient.

## Hash-bound receipt and publication decision

Keep a compact receipt in a user-owned local evidence location outside the
candidate payload to avoid self-referential hashes. Bind the base SHA, exact
candidate commit/tree, and SHA-256 of the cumulative binary diff. Link completed
broad review reports and applicable test results, coverage, and findings
dispositions. Hash pertinent dependencies or record runtime identities when they
matter to the behavior or reused proof; a deterministic manifest of every external
input is not required, particularly for trivial documentation changes. Existing
reports and test logs are sufficient evidence when their scope and identity match;
do not duplicate them or rerun passed tests without invalidated proof. Record:

- Target repository/branch; base SHA, candidate SHA/tree, cumulative diff SHA-256;
  completed review report and applicable test references, reviewer identities and
  observed model/effort (unknown when unavailable), and completion times.
- Coverage mapping each requirement and affected lifecycle boundary to inspected
  inputs and behavior evidence, including reused proof and why it remains valid.
- Known unverified boundaries with reason, risk, disposition, and owner. Separate
  required pre-push checks from future post-merge release, installation, and UI or
  consumer verification. Required pre-push behavior missing evidence blocks
  publication. Future consumer verification that depends on publication belongs
  to the delivery tail: mark it pending with a named owner, never passed, and do
  not force premature deployment to satisfy this gate. Use disposable fixtures
  for relevant failure cases; do not perform unauthorized live mutations.
- Deduplicated findings, severity, evidence, and disposition: fixed with proof,
  rejected with rationale, or explicitly accepted by the authorized owner.
  Unresolved actionable findings and missing required pre-push behavior evidence
  block publication unless the user explicitly accepts the stated risk. Stale
  candidate identity and incomplete required broad reviews also block publication.
  Missing formal receipt detail is not itself a code bug; seek only the compact
  identity, review coverage, and disposition evidence needed for this decision.

Immediately before the publishing command, the CE publisher verifies the final
commit/tree, base, pertinent inputs, and receipt still match; stops if they do not; and
records the successful remote head afterward. Failed or unknown push results
must be read back before retrying and are not counted as successful publication.
Keep receipt references in the delivery handoff. This is an instruction gate;
Git itself does not enforce it automatically.

## Compact delivery ledger

The delivery owner starts one ledger per PR/change and updates it after each
review, push, external feedback batch, and settlement. Link receipts and source
comments, deduplicate the same defect across reviewers, and keep these fields:

| Field | Definition |
| --- | --- |
| Initial review findings | Unique actionable findings in the first whole-candidate local review, before repairs |
| Local catches | Unique actionable defects caught locally before their first publication, across all candidates |
| Escaped actionable external findings | Unique valid defects first identified externally after publication; exclude duplicates, rejected comments, and newly requested scope |
| Pushes | Successful published head updates, including initial publication; distinguish failed attempts |
| External revision rounds | External actionable feedback batches that require a published repair; multiple pushes for one batch remain one round |
| Settlement elapsed | UTC time from first successful publication to CE's settled disposition; pending while unsettled |

Record candidate IDs, timestamps, and findings dispositions with each event so
counts can be audited. Retrospective unavailable values stay unknown, not zero.
Compare escaped findings and external revision rounds across comparable completed
changes; report sample size, scope, and settlement elapsed. A local catch rate,
if useful, is local catches / (local catches + escaped findings), deduplicated
by defect and only when both counts are known. Measure whether revision rounds
fall; do not promise a percentage or claim improvement before outcome data.
