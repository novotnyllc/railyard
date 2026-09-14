# Native dispatch contract

Verified on 2026-09-14 against the exposed native agent tool and Codex CLI
0.154.0. This is a dated adapter snapshot, not a claim that every provider or
future Codex version has the same controls.

## Hook payload

A trusted hook exercised by the installed binary captured the following
shape. The model-facing tool is `agents.spawn_agent`; its serialized hook name
is `agentsspawn_agent`, with no separator. Legacy CLI dispatch uses
`spawn_agent`. Shell operations are canonicalized to `Bash` by this CLI.

```json
{
  "hook_event_name": "PreToolUse",
  "session_id": "<runtime session UUID>",
  "model": "gpt-6-astra",
  "tool_name": "agentsspawn_agent",
  "tool_input": {
    "task_name": "bounded_work",
    "message": "Implement the bounded change and run its acceptance check.",
    "model": "gpt-6-astra",
    "reasoning_effort": "max",
    "fork_turns": "none"
  },
  "tool_use_id": "<runtime call ID>"
}
```

The top-level model is the parent model. Child overrides are inside
`tool_input`; the payload does not attest the child's effective settings or
the parent's reasoning effort. The gate logs allowed attempts with
`phase:pre_tool_use`. Actual start, selected settings, and completion require
native child evidence.

The current model/effort combinations are centralized in
[`native.mjs`](../scripts/model-routing/native.mjs). The active spawn tool's
roster is narrower than the local proxy and `models_cache.json` catalogs.
An external CLI provider therefore has a separate explicit route; native
catalog presence is not proof of external adapter support, or vice versa.

For `codex exec`, `--model`/`-m` takes precedence over `-c model=...`
regardless of argument order. The inspected binary normalized an unsupported
Luna `ultra` request to `max`. The shell gate must therefore validate the
effective model and effort before launch; presence checks alone cannot
preserve the requested allocation.

## Forks and role controls

The exposed native contract permits overrides with `fork_turns:"none"` or a
positive turn-count string. Supply a self-contained brief with scope,
constraints, necessary context, and the expected result. Omitted/`"all"`
forks inherit the parent model and effort. Deliberate inheritance uses:

```text
Allocation: inherit model and reasoning effort; the parent allocation suits this assignment.
```

Omit both override fields for that choice. Do not add a new allocation field
to the native tool schema. The current v2 tool has no `agent_type` parameter.
On a legacy CLI tool that exposes named roles, inspect its authoritative role
configuration and omit model/effort overrides when selecting that role; any
unset controls deliberately inherit. Do not infer fixed settings from a role
name or reconstruct layered configuration in a hook.

The inspected CLI binary accepted full-history model/effort overrides in an
isolated synthetic test, despite the active tool guidance forbidding them.
Railyard deliberately enforces the exposed contract before dispatch. It does
not claim that this binary rejects the shape itself. The CLI also cannot
fork full history from an ephemeral parent; no-history children work there.

## Verification boundary

The native payload canary used a local synthetic response server and a private
Codex home. Hooks were trusted through `hooks/list` and `config/batchWrite`;
hook trust was not bypassed. It exercised real CLI dispatch and captured
outgoing child model/effort controls with no provider-model usage. This proves
serialization and control propagation, not model quality or task cost.

Source regression tests cover the captured payload, supported pairs,
inheritance, fork constraints, named-role handling, and shell parsing. Before
enabling an installed update, repeat the relevant hook cases against its
manager-installed bytes and run representative work through the actual
startup path. Keep workflow-selection results distinct from synthetic
transport results. No benchmark here establishes a universally cheapest
coding allocation.
