---
name: jev
description: "Use TypeSafe Jev by default when TYPESAFE_API_KEY is available for model and reasoning-effort selection, workflow choice, evidence selection, work prioritization, and review triage. Preserve explicit choices, privacy restrictions, and CE review ownership."
---

# Jev advice

Use Jev by default for Railyard's bounded semantic decisions when
`TYPESAFE_API_KEY` is present. It supplies a typed suggestion; the calling
agent still owns the decision and its evidence. This works in Codex and
Claude Code with Node 24 and no package installation.

## Choose the question

| Mode | Use it for | Caller still owns |
| --- | --- | --- |
| `workflow` | Choosing among available native or CE workflows | Requested scope, stage availability, and permission to publish |
| `allocation` | Selecting a model and reasoning-effort pair from eligible candidates | Tool compatibility, explicit preferences, budgets, privacy, and dispatch |
| `evidence-selection` | Choosing the next relevant document, code excerpt, test, or observation to inspect | Retrieval, permitted context, freshness, and factual verification |
| `work-priority` | Choosing the next ready subtask or check | Dependencies, ownership, execution, and completion evidence |
| `review-triage` | Choosing the next investigation for a review finding | CE's review settlement, reproduction, fixes, and CI |

Use it throughout planning, implementation, debugging, and review wherever a
bounded semantic judgment helps. Revisit a choice when new evidence, candidate
availability, or task state changes; do not repeat the same unchanged request.
Use allocation mode before a substantive model-and-effort selection. Explicit user
choices and deterministic lookups need no inference. Do not ask Jev to
approve actions, certify tests, dismiss findings, authorize a merge, or
generate implementation code. It is not an execution model or a carrier in
the strict routing catalog.

## Prepare and call

1. Honor task privacy and offline instructions before calling. A configured
   key enables the adviser, but does not override a restriction on sending
   content to TypeSafe. Use `--offline` when remote inference is disallowed.
2. Prepare a small, relevant `state` string describing the question and its
   evidence. The state and candidate descriptions go to TypeSafe. Exclude
   credentials and unrelated private material. The helper does not read the
   repository, transcripts, configuration, or credential stores for you.
3. Supply locally checked eligible `candidates` with stable IDs. For
   allocation, include complete model and reasoning-effort pairs, availability,
   and relevant accepted-task evidence; do not invent a cheap-model ladder.
   Keep Astra Max as the substantive Codex baseline candidate when eligible,
   and consider Fable 5.1 deliberately for Claude Code. Honor fixed roles.
4. Resolve `SKILL_DIR` to this loaded skill's absolute directory, then run:

   ```sh
   node "$SKILL_DIR/scripts/jev-adviser.mjs" < /path/to/jev-request.json
   ```

   No enabling flag is needed. The helper reads `TYPESAFE_API_KEY` from its
   environment; do not put the key in a command, request file, or output.
   Do not install another plugin or fetch credentials merely because the key
   is absent. Use the user's established environment setup when requested.
5. Read the structured result. A `recommended` result contains only a
   `candidateId`; resolve it through the original local candidate list.
   Recheck that the evidence, available tools, and constraints still apply,
   then use the recommended candidate when those checks pass. Override it
   when concrete evidence or the user's instructions require another choice.
   `deferred`, `unavailable`, or `error` means use ordinary Railyard reasoning
   and the existing policy. An optional adviser failure does not block the task.

Read [the request and response reference](references/usage.md) for runnable
examples, bounds, failure states, and probability semantics.

## Keep ownership explicit

For workflow selection, pass the suggestion back to `railyard:deliver` and
preserve the requested endpoint. For allocation, continue through
`railyard:model-routing`; its strict resolver remains content-free and
retains all admission, budget, and authority checks. A Jev candidate ID is
not a reservation, capability attestation, or dispatch receipt.

For review triage, offer only next investigations, such as reproducing a
failure, examining a relevant code path, or obtaining missing evidence.
Feed the advice to the existing CE owner without starting another watcher.
Neither a high-confidence answer nor an `exit 0` establishes correctness or
review settlement.

Use evidence selection while assembling context for planning, diagnosis,
implementation, or a second opinion. Candidate descriptions must represent
the evidence honestly; Jev cannot judge omitted material or prove a claim
from a filename. Use work priority only after the caller has filtered out
blocked or unauthorized work. Neither mode retrieves files, starts agents,
runs tests, or changes dependency state.

The helper asks one Choice and one independent Noul question in a single
request. Choice selects a candidate or `no_match`; Noul estimates whether
the supplied evidence supports a choice. All three default thresholds are
0.8: Choice confidence, selected-option probability, and Noul probability.
These are conservative initial filters, not measured Railyard accuracy.
Evaluate them on representative labeled tasks before changing them or making
efficiency claims. Record the returned provider model and usage when useful;
compare complete accepted outcomes, retries, repairs, and elapsed time.

Missing key, offline mode, uncertainty, invalid responses, rate limits, and
service errors return no recommendation. No inference runs inside startup or
tool hooks. Startup only advertises this default when the key is present.
