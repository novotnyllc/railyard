# Calling a selected CE skill

Resolve the selected Compound Engineering `SKILL.md`, read its instructions,
execute the applicable procedure, and return to the requested delivery
boundary. Reading the file alone does not execute the workflow. A CE stage can
run in the current session or in a native subagent.

Before calling any stage or child that can publish, supply the
[whole-candidate review gate](../../../references/whole-candidate-review.md)
as a project publishing requirement, with the candidate receipt and an owner
for its refresh. This applies to LFG internal stages and every CE feedback
repair continuation. The publisher must stop before every push until the full
cumulative candidate is covered and the receipt matches; an earlier review or
a stage's completed result cannot retroactively satisfy the gate. If a selected
workflow cannot honor this requirement, stop before its external write and
report the integration limitation.

LFG owns its internal stages, including its CE review and babysitting loop;
do not duplicate them around it. Deliver consumes its result and continues the
authorized merge, release/deployment, and consumer-verification tail. For an
existing PR outside LFG, the selected CE PR workflow is the single review and
CI owner.

Explicit user and repository scope or stop instructions win: a plan-only or
local-only request stays bounded even when a loaded skill has a broader
default.
