---
layout: default
title: Jev advice
parent: Skills
nav_order: 3.5
---

# Jev advice

Jev supplies typed selections for five Railyard decisions: which available
workflow fits a task, which eligible model and reasoning-effort pair fits an
assignment, which evidence to inspect, which ready work to prioritize, and
which investigation should come next in a review. The calling
agent keeps responsibility for the decision and its evidence.

## Default behavior

With `TYPESAFE_API_KEY` set, Railyard consults Jev only when a model, effort,
or workflow choice is genuinely open between eligible options and the choice
matters for cost or outcome — for example a substantive subagent, an
escalation, or a fork between a direct fix and a heavier workflow. It skips
explicit choices, clear defaults, single-option cases, and small dispatches,
and reuses an answer already reached in the session rather than asking again
for a similar assignment. An auth or rate-limit failure stops further
consultation for the rest of the session. Explicit user choices always win.
Task privacy restrictions still apply. Missing keys, uncertain results,
invalid responses, and other service failures fall back to normal Railyard
reasoning. Use the helper's `--offline` option to disable remote advice. With
no `TYPESAFE_API_KEY` set, Jev is inactive.

Codex and Claude Code use the same Node 24 helper. No SDK, additional plugin,
or background service is required. Startup only advertises the configured
adviser; it does not call the API.

## How it works

Invoke `railyard:jev`, or resolve the loaded skill's directory and run:

```sh
node "$SKILL_DIR/scripts/jev-adviser.mjs" < /path/to/request.json
```

The request contains a bounded state summary and a list of eligible candidates.
The helper sends those to TypeSafe using the key from the environment. It
neither discovers credentials nor reads repository content or transcripts.

It asks Jev to choose a candidate and independently judge whether the supplied
evidence is sufficient. A recommendation contains a candidate ID for the
caller to resolve locally. Uncertainty or failure returns no recommendation.
The result also reports probabilities, confidence, provider model, and token
usage. Initial thresholds require evaluation on representative tasks; they
are not a measured accuracy guarantee.

## Ownership

[Deliver](/skills/deliver/) retains the requested endpoint.
[Model routing](/skills/model-routing/) retains compatibility, privacy,
and dispatch checks. CE retains review settlement and CI monitoring. Jev
cannot approve actions, dismiss findings, attest capabilities, or satisfy a
merge guard. It isn't an execution model.

## Source

Ships in the `railyard` plugin. The
[skill and runnable examples](https://github.com/novotnyllc/railyard/tree/main/plugins/railyard/skills/jev)
describe the request contract and fallback behavior. The integration follows
TypeSafe's [HTTP API](https://docs.typesafe.ai/api) and
[confidence semantics](https://docs.typesafe.ai/confidence).
