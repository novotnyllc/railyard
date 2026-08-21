# Delivery routing

- Run the read-only `railyard:model-routing` intake on every software
  delivery turn. Explicit workflow and terminal instructions win. Configured
  fleet/account delivery enters `railyard:orchestrate`, even when it
  fast-paths one lane; explicit local/no-fleet or no-config single-host work
  enters `railyard:deliver` directly.
- Task Orchestrator owns decomposition, allocation, placement, concurrency,
  monitoring, synthesis, and evidence; it never executes child work. Each
  software-delivery child uses Deliver and consumes its immutable route,
  budget lease, checkpoint, and terminal policy.
- LFG owns plan through CI and review settlement. Deliver owns authorized
  merge and post-merge proof.
- `railyard/model-routing/v1` is the only operational model/effort, budget,
  and transport policy. Per-harness session defaults, the Codex-only GLM-5.2
  route, and cross-harness handoffs live in
  [`plugins/railyard/references/harness-model-invocation.md`](../../plugins/railyard/references/harness-model-invocation.md).
  Claude Code cannot invoke GLM-5.2.
- Task titles for an active workflow follow
  [`plugins/railyard/references/task-titles.md`](../../plugins/railyard/references/task-titles.md),
  which states its own precedence.
