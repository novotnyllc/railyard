# Jev request and response

Resolve `SKILL_DIR` from the loaded `jev/SKILL.md`. With Node 24:

```sh
node "$SKILL_DIR/scripts/jev-adviser.mjs" < /path/to/request.json
node "$SKILL_DIR/scripts/jev-adviser.mjs" --offline < /path/to/request.json
node "$SKILL_DIR/scripts/jev-adviser.mjs" --help
```

The only credential input is `TYPESAFE_API_KEY` in the process environment.
Key presence enables remote advice by default. The helper calls
`https://api.typesafe.ai/v1/systemone` using `jev-latest`, with no base-URL
override, redirect following, retries, or persisted state. The total request
deadline, including reading the response, is ten seconds.

## Input

Input is one JSON object on stdin. `mode`, `state`, and `candidates` are
required; `requiredCandidateId` and `thresholds` are optional. Unknown fields
are rejected. IDs must be unique; `no_match` is reserved for abstention.
Only include candidates the caller has checked are available and eligible.
Limits are 64 KiB each for stdin, the encoded API request, and the response;
16 KiB for `state`; 16 candidates; and 2 KiB per candidate description.
The input pipe must finish within ten seconds, separately from the network
deadline. Oversized or stalled inputs receive no recommendation.

For an illustrative workflow decision:

```json
{
  "mode": "workflow",
  "state": "An intermittent integration test fails after a retry. The cause is unknown. Diagnose and fix locally; do not publish.",
  "candidates": [
    {"id": "direct", "workflow": "native", "description": "Make a bounded edit whose cause and fix are already understood."},
    {"id": "diagnose", "workflow": "compound-engineering:ce-debug", "description": "Investigate a difficult failure before choosing a fix; this skill is available."}
  ]
}
```

Supported workflow values are `native` and `compound-engineering:` followed
by `ce-brainstorm`, `ce-debug`, `ce-plan`, `ce-work`, `ce-code-review`,
`ce-test-browser`, `ce-commit-push-pr`, `ce-babysit-pr`,
`ce-resolve-pr-feedback`, `ce-compound`, or `lfg`. Availability is checked by
the caller, not inferred from this list.

For an illustrative allocation comparison:

```json
{
  "mode": "allocation",
  "state": "Compare these locally supported allocations for a cross-module concurrency defect. Correctness matters; no comparable lower-effort result has been measured.",
  "candidates": [
    {"id": "baseline", "model": "gpt-6-sol", "reasoning_effort": "high", "description": "Supported candidate for this cross-module defect."},
    {"id": "escalation", "model": "gpt-6-astra", "reasoning_effort": "high", "description": "Use if the investigation needs Astra's broader reasoning."}
  ]
}
```

These model pairs illustrate the format, not a roster or a benchmark.
`requiredCandidateId` restricts the question to that supplied candidate and
`no_match`. Usually bypass inference when the user already chose an allocation.
The helper validates shape, not provider availability or native tool support.

For review triage, keep the current CE owner and describe next investigations:

```json
{
  "mode": "review-triage",
  "state": "A reviewer suspects a retry can repeat a payment. No reproduction or trace is attached. CE owns this review.",
  "candidates": [
    {"id": "reproduce", "description": "Construct a bounded retry reproduction and inspect the idempotency evidence."},
    {"id": "inspect-tests", "description": "Inspect current retry tests to identify which failure conditions are already covered."}
  ]
}
```

Never supply options that approve, dismiss, merge, or settle the review. An
advisory selection does not execute its description.

`evidence-selection` and `work-priority` use the same `{id, description}`
candidate shape. For example:

```json
{
  "mode": "evidence-selection",
  "state": "A retry test records duplicate callbacks. Choose the next available evidence to inspect for the callback duplication investigation.",
  "candidates": [
    {"id": "retry-trace", "description": "A trace from the failing test includes each retry attempt and callback invocation."},
    {"id": "rendering-doc", "description": "Documentation for the unrelated dashboard rendering component."}
  ]
}
```

For `work-priority`, describe the current objective and dependency state in
`state`, and list only ready, authorized subtasks or checks. Jev chooses one
next candidate; it does not schedule work. For evidence selection, it chooses
one next item; its competing-option probabilities are not independent
relevance scores for all items.

Optional thresholds are numbers between zero and one:

```json
{"minConfidence": 0.8, "minProbability": 0.8, "minSufficientContext": 0.8}
```

Put that object in the request's `thresholds` field. The defaults are initial
filters requiring evaluation on representative Railyard tasks. Changing a
threshold never changes workflow authority.

## Output and fallback

Every result carries `schema: "railyard/jev-advice/v1"` and
`advisoryOnly: true`. The statuses are:

| Status | Meaning | What the caller does |
| --- | --- | --- |
| `recommended` | A known candidate passed all configured filters | Resolve `recommendation.candidateId` locally and apply normal policy |
| `deferred` | Abstention or uncertain evidence | Make the decision through ordinary Railyard reasoning |
| `unavailable` | Offline, unconfigured, or service failure | Continue without Jev |
| `error` | Invalid input, arguments, or provider response | Repair the request when applicable, then continue without the adviser |

The `reason` is a stable diagnostic code. `judgment` carries
`selection.choice`, `selection.probabilities`, `selection.confidence`, and
`sufficientContext`. `provider` carries the returned model and token usage.
Fields without a valid observation are null. The helper does not return
state, candidate descriptions, the key, or provider error bodies.

Choice confidence describes distribution concentration; it differs from the
winning probability. Noul is a probability of yes, with no separate confidence.
The two questions are independent, so neither can justify the other's answer.
Schema validation proves the answer has the expected shape, not that the
judgment is true. Invalid provider data returns no recommendation.

Exit code 2 means invalid or stalled input, or invalid arguments. All optional-adviser outcomes,
including no recommendation, exit 0. Always inspect `status`; exit code is
not a success, correctness, or merge signal.

## Why these uses

Jev chooses among known outcomes and returns probabilities instead of free-form
reasoning. That fits the semantic choice before a workflow, a comparison
among eligible allocations, selecting relevant evidence, prioritizing ready
work, and the order in which to investigate review evidence. Deterministic policy, open-ended implementation, proof of test
success, and final review disposition remain with their existing owners.

Contract checked against TypeSafe's primary documentation on 2026-09-22:
[HTTP API](https://docs.typesafe.ai/api),
[Choice](https://docs.typesafe.ai/primitives/choice),
[Noul](https://docs.typesafe.ai/primitives/noul),
[confidence](https://docs.typesafe.ai/confidence), and
[skill suggestions](https://docs.typesafe.ai/cookbooks/skill_suggestion).
The integration uses built-in Node HTTP facilities; no SDK or TypeSafe plugin
installation is required.
