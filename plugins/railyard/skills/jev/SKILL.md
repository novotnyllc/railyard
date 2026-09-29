---
name: jev
description: "Consult TypeSafe Jev when TYPESAFE_API_KEY is set and a model-and-effort, workflow, evidence, priority, or review-investigation choice is genuinely open between eligible options. Skip it for explicit choices, clear defaults, and small dispatches."
---

# Jev advice

Jev picks one option from a list you supply and returns probabilities. You
still own the decision. It needs Node 24 and no installation.

## When to consult

Consult Jev only when all of these hold:

- `TYPESAFE_API_KEY` is set, and privacy or offline instructions allow
  sending a short task summary to TypeSafe.
- At least two options are eligible, and the owning skill's default does not
  already settle the choice.
- The choice matters for cost or outcome. Examples: a substantive subagent,
  an escalation (Opus 5.5 to Fable 5.1, or Sol 6.1 `medium` to `high`),
  a workflow fork (a direct fix, `ce-debug`, or `ce-plan`), or the order of
  several ready investigations.

Skip it when:

- The user named the model, effort, or workflow.
- A default clearly applies: Haiku for read-only search, an inheriting fork,
  or mechanical work that runs through tools.
- Only one option is eligible, or a wrong pick would cost less than the call.
- You already asked this question in the session. Reuse the answer for
  similar assignments. Ask again only when the evidence, the candidates, or
  the task state changes.
- An earlier call in this session returned `missing_api_key`,
  `invalid_api_key`, `authentication_failed`, or `rate_limited`. Don't call
  Jev again for the rest of the session.

Never ask Jev to approve actions, certify tests, dismiss findings, authorize a
merge, or write code.

## Modes

| Mode | Chooses | Caller still owns |
| --- | --- | --- |
| `allocation` | A model and reasoning-effort pair | Tool support, explicit preferences, budgets, privacy, and dispatch |
| `workflow` | Native tools or one loaded skill | Requested scope, stage availability, and permission to publish |
| `evidence-selection` | The next document, excerpt, test, or observation to inspect | Retrieval, permitted context, and verification |
| `work-priority` | The next ready subtask or check | Dependencies, ownership, and completion evidence |
| `review-triage` | The next investigation of a review finding | CE's review settlement, reproduction, fixes, and CI |

## Build the request

1. Write `state` as a few sentences: the question and the evidence that
   bears on it. Leave out credentials and unrelated private material. The
   helper reads no files, transcripts, or configuration.
2. List 2 to 4 `candidates` that you have checked are available. Give each a
   stable `id` and an honest `description`.
   - For allocation, draw pairs from
     [model-routing](../model-routing/SKILL.md) for the current harness.
     Railyard keeps no capability table, so that skill and the live tool
     schema are the roster. Include the default pair: `opus` at `medium` in
     Claude Code, or the live selector for `gpt-6.1-sol` at `medium` in Codex. Use
     `"reasoning_effort": null` for a model with no effort setting, such as
     Haiku. Claude Code's Agent tool sets only the model, so list the effort
     that will actually apply: the session's, or the subagent definition's.
   - For a workflow, use `native` or a skill name exactly as your session
     lists it, such as `compound-engineering:ce-debug`. Offer only skills that are
     loaded now. The helper checks the name's format, not a roster, so new
     or renamed CE skills need no Railyard change.
3. Resolve `SKILL_DIR` to this skill's directory, then run:

   ```sh
   node "$SKILL_DIR/scripts/jev-adviser.mjs" < /path/to/jev-request.json
   ```

   The helper reads the key from its environment. Never put the key in a
   command, a file, or output. If the key is absent, don't fetch or install
   credentials. Continue without Jev.

## Apply the result

- `recommended`: map `recommendation.candidateId` back to your list. Recheck
  that the constraints still apply, then use it. Override it only when
  concrete evidence or the user requires another choice.
- `deferred`: use the owning skill's default. Don't reword the request to
  force a pick.
- `unavailable` or `error`: continue without Jev. The adviser never blocks
  a task. Exit code 2 means the request was invalid; fix it once or skip Jev.

A result is `recommended` only when three values each reach 0.8: Choice
confidence, the chosen option's probability, and Noul's estimate that the
context is sufficient. These are cautious starting filters, not measured
accuracy. Don't loosen them until you have labeled Railyard outcomes. When
auditing, record the returned provider model and token usage.

## Keep ownership explicit

Pass workflow advice back to `railyard:deliver`, and keep the requested
endpoint. Apply allocations through `railyard:model-routing` and the dispatch
tool. A candidate ID doesn't reserve capacity or prove that a tool supports
the model. For review triage, offer only next investigations, and give the
advice to the existing CE owner. Evidence selection and work priority each
pick one next item; they don't retrieve files, schedule work, or run tests.

No inference runs in startup or tool hooks. See
[the request and response reference](references/usage.md) for runnable
examples, limits, failure codes, and probability semantics.
