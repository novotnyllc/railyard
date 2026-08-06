<!-- cross-repo links use site-absolute paths, resolved at site build -->

# Model routing

Model routing picks the model, effort level, transport, and budget for one piece of work before
that work starts, and hands back a frozen decision the calling workflow must actually use. It
exists so that routine work runs on a cheap, capable model and expensive judgment work runs on a
model that's worth the cost — instead of every subagent quietly inheriting whatever premium
model the parent session happens to be running on.

## When to use it

- You're about to dispatch a subagent, thread, or worker and need to know which model and effort
  level it should carry.
- You're building or reviewing a workflow that starts work — `railyard:deliver` and
  `railyard:orchestrate` both call this before anything else happens, so you rarely invoke it by
  hand.
- You're debugging why a child ran on the wrong model, or why a dispatch got refused.
- You want to check current routing state (`status`) or clear a stale claim (`inspect-claim`)
  without starting new work.

You don't call this to pick a model for your own top-level session — that's session
configuration, not routing. This is for every model decision a workflow makes on a *child's*
behalf.

## How it works

### One entrypoint, one contract

`railyard:model-routing` is the only public entrypoint for model, effort, budget, and transport
decisions. Every caller passes exact contract version `railyard/model-routing/v1`. The router is
a script (`model-routing.mjs`) invoked with a JSON request over stdin — a shell command, not a
host tool:

```bash
ROUTER="$SKILL_DIR/../../scripts/model-routing.mjs"
printf '%s\n' '<request JSON>' | node "$ROUTER"
```

Requests are content-free: no prompts, task titles, paths, source, files, tokens, endpoints, or
command text — only the classification of the work. The router returns a decision or a receipt.
It never creates a task, calls a provider, opens a browser, or runs a command on a provider's
behalf; the calling workflow does the actual dispatch.

### The lifecycle

1. **Classify** the work: its role, shape, dispatch kind, scope, and privacy. Runtime and
   transport facts come from the router, never from the caller's JSON.
2. **`resolve`** reads one immutable policy snapshot. With no catalog configured, the built-in
   defaults apply: Sol at `high`/`max` for orchestration and review, Luna at `max` for
   implementation, and Terra at `max` only as the router's own attested substitute for Luna.
   Nothing in a catalog, request, or environment variable can nominate Terra or mark Luna
   unavailable — those are router-owned facts.
3. For work that's actually starting, the workflow **`admit`**s it with a stable request ID and
   a frozen digest of what's being done, then **`claim-dispatch`**s immediately before the one
   carrier dispatch happens. A claim is one-way — it can't be replayed to authorize a retry.
4. The workflow dispatches to the one selected adapter and **reconciles** the receipt through
   the router's own importer. Model output and caller-authored JSON are never treated as
   receipts.
5. `status`, `inspect-claim`, local-only `refresh`, and the `learning
   inspect|clear|disable|enable` commands go through this same contract; `refresh` never calls
   out to a live provider.

For a status message or narrowing question that doesn't expand scope, a workflow can use
`resolve` with `budgetEffect:"none"` against the exact prior route — that's a free look, not a
new decision. Anything that actually grows the work (more files, more checks, more calls) tops
up the existing reservation with `adjust_active` instead of silently reusing the old one.

### Session defaults by work type

The no-config route is the same regardless of which harness is running it; each harness maps it
to its own model names:

| Work | Claude Code | Codex |
| --- | --- | --- |
| Routine steering | Opus `medium` | Sol `medium` |
| Mechanical work | Sonnet `medium` | Luna `max` |
| Implementation | Opus `high` | Terra `max` |
| Difficult review | Fable `high` | Sol `high` |
| Critical review | Fable `max` | Sol `max` |

`medium` is the everyday steering effort. Codex implementation runs at `max` because Luna and
Terra are priced for it; Opus `high` is the sweet spot for agentic coding, with `xhigh` held
back for genuinely hard units. Escalate deliberately, not by default.

### The dispatch rule: no silent inheritance

**Every subagent, thread, or worker dispatch names an explicit model — and on Codex, an explicit
effort — with no exceptions.** If a dispatch omits the model field, the harness quietly runs
that child on the parent session's own tier. On a premium session (Fable, Sol `max`) that means
routine or mechanical work silently burns premium spend — exactly the failure this router exists
to prevent. Naming the session's own tier explicitly is a legitimate, deliberate escalation;
*omitting* the field is not a neutral default, it's a routing violation.

Per-harness, the model and effort land in different places: Claude Code's `Agent` tool sets
`model`; Codex's `spawn_agent` sets `model` and `reasoning_effort` (it has no provider field, so
a non-OpenAI child needs its thread already started on that provider); Codex `thread/start` sets
`model` and `config.model_reasoning_effort` plus `modelProvider` for anything non-OpenAI; `codex
exec` uses `-m` plus `-c model_provider=` and `-c model_reasoning_effort=`.

Cross-harness dispatch (Claude reaching a Codex model, or vice versa) is opt-in only, never a
silent default — each harness meters usage separately. Claude reaches Codex models through the
`codex` plugin's `codex:rescue` skill or a direct `codex` CLI call; Codex reaches Claude models
through `claude -p`.

### The PreToolUse gate

The dispatch rule above isn't just a convention — it's enforced mechanically on Claude Code by a
hook. `plugins/railyard/hooks/claude-hooks.json` wires `dispatch-gate.js` to `PreToolUse` on the
`Agent|Task` tool matcher. Before any subagent dispatch reaches the harness, the gate inspects
`tool_input`:

- For `Agent`/`Task`: if `model` isn't a non-empty string, the call is refused
  (`process.exitCode = 2`, a stderr message explaining the fix) so the dispatch can be retried
  with the field set.
- For Codex's `spawn_agent`: both `model` and `reasoning_effort` are required; either missing
  triggers the same refusal, naming exactly which field is missing.
- Anything else — malformed JSON, a tool the gate doesn't recognize — is allowed through
  untouched. The gate fails open by design: it must never break a session, only close the one
  gap it's built for.

A companion `SessionStart` hook (`routing-charter.js`) injects a short ambient reminder of these
rules once per session, and a `UserPromptSubmit` hook (`routing-nudge.js`) adds a one-line nudge
when a prompt looks like a delivery, planning, or fleet-maintenance request — pointing toward
`railyard:deliver` or `railyard:orchestrate` before the model even has to think about routing.

### GLM and Oracle are fixed, narrow transports

GLM work is Codex-only: `codex exec -m glm-5.2 -c model_provider=zai_litellm`, available when
the provider config and local proxy are present — a failed command *is* the availability check.
Claude Code cannot invoke GLM-5.2 at all: a Claude session can't authenticate to Z.ai and keep
its account-bound capabilities at the same time, so that route doesn't exist. The
`glm-5-2-scout`/`glm-5-2-engineer` carrier rows stay fail-closed everywhere else — they're never
a selector value on Codex or a native-subagent model.

Oracle review runs only as `oracle-browser` on `chatgpt_current_pro`; Oracle API is not
supported through this router. Lifecycle (install/upgrade) is a separate carrier,
`oracle-homebrew-lifecycle`. See [oracle.md](./oracle.md) for the CLI itself.

Fable/Opus cross-model review runs only through Compound Engineering's existing attested
read-only Claude `-p` adapter — model routing never stands up a second, parallel `claude -p`
runner alongside it.

### Work contracts and Compound Engineering overrides

After a model/effort selection, the workflow runs the router's `build-work-contract` command
with the frozen objective/source-of-truth/scope/constraints/authorization/acceptance/stop
digests plus the selected carrier/model/effort. This produces one carrier-neutral brief: the
underlying content (the "invariant digest") stays identical across every carrier, and only the
presentation changes to fit the target — a lean brief for GPT/Sol, a complete spec for Opus,
autonomy/pause boundaries for Fable, standards-plus-plan for GLM, a self-contained one-shot for
Oracle. Direct user and repository instructions always outrank that presentation layer.

Compound Engineering (the external workflow engine `railyard:deliver` drives — see
[deliver.md](./deliver.md)) is never edited by routing. A routed decision can replace only one
named CE execution mechanism at an attested seam in a closed registry — never CE's workflow,
persona, legitimacy checks, writer ownership, review authority, or terminal boundary. If the
exact carrier/seam isn't attested, the router returns `transport_unsupported` or a disclosed
fallback — it doesn't improvise a substitute.

## Boundaries

- Model routing decides; it never executes. It doesn't spin up a browser, call a provider API,
  or run a command — the calling workflow does that with the decision it was handed.
- It doesn't invent model names, tiers, or ranking rules. The normative contract — commands,
  request shapes, catalog schema, budget rules, CE override clauses — lives in
  `references/model-routing.md`; this skill is the entrypoint, not a second source of truth.
- A skill cannot switch its own session's model. If a session is running a premium tier and the
  next unit of work is mechanical, that unit goes to a freshly dispatched child carrying the
  routed tier — it does not run inline just because the session is already there.
- `refresh` is local-only. It never probes a live provider, and none of this skill's commands
  mint "the provider actually worked" evidence — that requires a separately authorized canary or
  an equivalently bound trusted receipt.

## Example session

**Prompt:** "Fix the flaky retry test in the billing service."

**What happens:** `railyard:deliver` receives the request, classifies it as a generic
implement/fix (see [deliver.md](./deliver.md)), and before doing anything else calls
`railyard:model-routing` with contract `railyard/model-routing/v1`. With no catalog configured,
the router resolves the no-config defaults and returns Terra `max` (Codex) or Opus `high`
(Claude Code) for the implementation unit. Deliver runs `build-work-contract` with the frozen
objective and the selected carrier/model/effort, then dispatches the implementation work —
through LFG — as a fresh child that explicitly carries that model and effort. If the dispatch
call is missing the `model` field for any reason, the `PreToolUse` gate refuses it immediately
with a message naming the fix, and the retry succeeds once the field is set. Deliver never
reports the fix as done because CI is green; it reports the model/effort actually used alongside
the merge and post-merge proof.

