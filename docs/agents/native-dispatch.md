# Native dispatch payloads (maintainer notes)

Background for maintaining `plugins/railyard/hooks/dispatch-gate.js`. Captured
2026-09-14 against the exposed native agent tool and Codex CLI 0.154.0; this is
a dated snapshot, so re-check it when Codex changes. User-facing model and
effort guidance lives in `skills/model-routing/SKILL.md` and
`references/harness-model-invocation.md`, not here.

## Hook payload

The model-facing tool is `agents.spawn_agent`; its serialized hook name is
`agentsspawn_agent`, with no separator. Legacy CLI dispatch uses
`spawn_agent`. This CLI canonicalizes shell operations to `Bash`.

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

The top-level `model` is the parent's. Child overrides sit inside
`tool_input`; the payload does not attest the child's effective settings or the
parent's effort. The gate logs allowed attempts with `phase:pre_tool_use`;
actual start, settings, and completion need native child evidence.

The spawn tool's roster is narrower than the local proxy and
`models_cache.json` catalogs, so native catalog presence is not proof of
external CLI adapter support, or vice versa.

## Forks and roles

The exposed contract accepts overrides only with `fork_turns: "none"` or a
positive turn-count string; omitted or `"all"` forks inherit the parent's model
and effort. The current v2 tool has no `agent_type` parameter. On a legacy CLI
tool with named roles, the role's authoritative configuration supplies model
and effort; do not infer them from the role name.

The inspected CLI binary accepted full-history overrides in an isolated
synthetic test despite the tool guidance forbidding them; the gate enforces
the exposed contract rather than relying on the binary. The CLI also cannot
fork full history from an ephemeral parent; no-history children work there.

## Verification boundary

The payload canary used a local synthetic response server and a private Codex
home, trusting hooks through `hooks/list` and `config/batchWrite` rather than
bypassing trust. It exercised real CLI dispatch and captured outgoing child
model/effort controls with no provider-model usage. That proves serialization
and control propagation, not model quality or cost. Before enabling an
installed update, repeat the relevant hook cases against the manager-installed
bytes and run representative work through the actual startup path.
