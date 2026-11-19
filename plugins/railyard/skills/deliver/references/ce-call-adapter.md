# Calling a Compound Engineering skill

Use the applicable Compound Engineering (CE) skill directly for its workflow.
When Deliver calls a CE stage, resolve its `SKILL.md`, execute the procedure,
and return to the requested delivery boundary. A CE stage can run in the
current session or in a native subagent.

CE coordinates implementation and selects the engine through `ce-work`'s
`references/execution-engines.md`. A `ce-work` run uses one implementation
engine. If the user requests different engines for independent units, the
same coordinator gives each bounded unit its own `ce-work` invocation and
retains integration, verification, and publishing ownership. Use
`mode:return-to-caller` for units whose shipping tail belongs to that coordinator.

Give each publisher, including LFG and CE feedback or CI repairs, the
[local review policy](../../../references/whole-candidate-review.md) as a
project publishing requirement. With default `light` review, pass along the
last reviewed head when known, the applicable review result, and the checks.
An existing independent CE review can satisfy the same scope. One repair
batch gets one focused review before its push. Material changes to design or
risk and unknown review coverage call for a fresh whole-change review. Only
`full` requires the exact-candidate receipt and delivery ledger. With
`checks`, run the repository checks. If the stage cannot honor the selected
policy, stop before it publishes.

Before calling a stage that settles review feedback, including LFG and
`ce-babysit-pr`, supply the
[review feedback settlement policy](../../../references/review-feedback-settlement.md)
as a project settlement requirement; CE still owns the settlement loop.

## Repairs during the CE watch

Give the watcher this publishing restriction before its first tick. Carry
it into each delegate before it starts. A normal CE repair pipeline can push
as part of the fix. Grant repair delegates only local edit, check, and commit
authority. Keep the push with the publisher that runs the selected review
policy. Require the same gate before LFG's internal pushes and before any
branch-currency or stack update that publishes a new head.

- For review feedback, use `ce-resolve-pr-feedback mode:return-to-caller`
  and pass CE's feedback trajectory. Review and check the resulting fix
  commit with the local policy, publish
  that exact commit against the verified PR head, then call
  `ce-resolve-pr-feedback mode:resume handoff:<path>` to finish the saved
  replies and resolutions. Carry the resolver's typed decisions unchanged.
  A verified no-change batch can finish without a push.
- For CI repair, use `ce-debug mode:pipeline` with local-only authority
  when it supports `fixed-not-pushed` under that scope. Pass the current
  failure and CE's recurrence evidence. Otherwise use `ce-debug
  mode:return-to-caller` on the PR branch and accept its `fixed` result as
  a local fix. Confirm the fix is on the expected branch and based on the
  current PR head. After reviewing and checking it, publish the verified
  commit, read back the result, and let the watcher refresh its checks.
  Preserve unresolved decisions.

If the installed watcher cannot use a local handoff, pause it before its
publishing step. Keep its recorded state and original scope, run the supported
local repair and publication steps above in the current chat, then resume
that same watcher. Leave the batch pending with its concrete blocker if the
handoff, review, or safe publication cannot complete.

## Merge authorization at publication

Resolve landing authority from the user's request or standing owner
instructions for the project. A plugin update grants no additional authority.

For a push-only or PR-only endpoint, inspect the repository's automatic
landing rules before every publish. Create a new auto-landing PR as a draft
in the create operation. If the user requests a ready PR, apply and verify
the repository hold while it is still a draft before marking it ready. For
an existing auto-landing PR, apply a repository hold if needed. Before
pushing, verify an effective draft or repository hold and confirm that the
queue cannot land the current head. A failed or uncertain hold blocks
publication. Preserve the hold until the user grants landing authority.
Push-only does not create a PR.

## Watch ownership

For a single PR delivered directly through CE, use
`ce-commit-push-pr mode:pipeline`. Once the publisher returns the PR URL,
run `ce-babysit-pr mode:pipeline <pr-url> posture:target` if no CE watcher
already owns it. This uses CE’s bounded feedback and CI loop without adding
an interactive quiet period after readiness. Inspect the returned disposition.
Continue the same watch when work remains pending. Required checks, approvals,
and unresolved blockers still govern landing. Respect a narrower PR-only stop.

LFG owns its internal stages, including its CE review and babysitting loop;
do not duplicate them around it. Deliver consumes its result and continues the
authorized merge, release/deployment, and consumer-verification tail.
Retain any stack-aware watch and its posture across handoffs. For an
existing PR outside LFG, the selected CE PR workflow is the single review and
CI owner.

Explicit user and repository scope or stop instructions win: a plan-only or
local-only request stays bounded even when a loaded skill has a broader
default.
