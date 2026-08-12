<!-- cross-repo links use site-absolute paths, resolved at site build -->

# Orchestrate

Orchestrate breaks an objective into independently resumable pieces of work, places each one on
the right host, and tracks the whole graph through to done — without ever touching the code
itself. It's the skill for "these three things, in parallel," "run this on my other machine," or
"handle this across the fleet." It stays available to you as the control point while fresh,
visible children do the actual implementation, research, or review.

## When to use it

- Configured fleet or account policy owns where delivery work runs — orchestrate is the entry
  point even if that policy ends up fast-pathing everything to one lane.
- The objective breaks into two or more independently resumable tasks — separate scopes,
  separate PRs, separate ownership.
- Work needs to run on a different machine than the one you're talking to.
- You ask to run something "on my other Mac," "across the fleet," "everywhere," or name a
  specific enrolled host.
- You name this skill directly.

Use [deliver.md](./deliver.md) instead for explicit local, no-fleet delivery, or when there's no
fleet configuration at all and the work is a single host-local lane — that's deliver's default
path, not orchestrate's. One bounded task that isn't software delivery just uses its own
appropriate skill directly.

## How it works

### Readiness before placement

Orchestrate never dispatches first and discovers requirements later. Before any placement
decision it verifies, per host: repository identity, checkout state, and project baseline
(`roundhouse:fleet-projects`); runtime versions, plugin versions, and skill hashes
(`roundhouse:fleet-agents`); and a read-only inventory snapshot (`roundhouse:fleet-inventory`,
with `roundhouse:fleet-auth` only when a task needs authenticated tooling). Missing projects,
stale runtimes, inconsistent skills, unhealthy auth, and unreachable hosts are readiness
problems that get handed to Roundhouse for user-approved reconciliation — orchestrate never
mutates a host directly. If Roundhouse isn't available, orchestrate requires equivalent
read-only evidence instead and reports consistency as unverified rather than assuming it.

Once readiness is established, allocation order (unless you specify otherwise) is: filter to
hosts that actually have the required access, plugins, skills, credentials, platform, and
toolchain; verify the chosen host's requirements and baseline right before dispatch; prefer an
idle capable host, then the least-utilized one; break ties by data locality and expected
wall-clock time.

### Classifying your turn

Every turn gets classified before any work starts — never inferred from an earlier plan or from
transcript history. An explicit instruction to perform delivery work ("go do," "implement,"
"fix," "ship," or "carry out the approved plan") is work-starting: after bounded read-only
intake, decomposition, allocation, and readiness checks, orchestrate consumes one task-authority
use per destination and dispatches fresh visible execution tasks. A configured single-lane fast
path still creates one real, fresh `deliver` child — it doesn't satisfy a
work-starting instruction with analysis or a status response alone.

A request for an answer, a status update, an explanation, planning, or bounded read-only
inspection is non-work-starting: orchestrate answers or performs that bounded action without
consuming task authority or creating a task. "Plan and implement" counts as work-starting.

In both cases orchestrate stays controller-only — intake, decomposition, allocation, monitoring,
synthesis, lifecycle cleanup, and verification. It never implements, tests, commits, pushes, or
merges child work itself.

### The placement lanes

Two remote lanes exist, one per destination harness. Orchestrator-side subagents run on the
orchestrator's own host unless a native tool supports placing them elsewhere.

**Codex destination.** A visible task or thread on that destination's saved project, following
the Codex remote-control contract documented in [roundhouse](/roundhouse). A Claude Code
orchestrator can't drive that app-tool surface directly — it reaches a Codex destination through
the `codex` plugin's rescue forwarder, or a directly invoked `codex` CLI on the destination over
the SSH lane below.

**Claude Code destination.** Over fleet-verified SSH — the configured alias, login shell,
bounded timeouts — orchestrate launches a real destination-native worker in the fleet-verified
project checkout:

```bash
claude -p '<child brief>' --session-id <orchestrator-assigned uuid> \
  --output-format json --permission-mode <mode>
```

Output is captured to a destination-local log. Long-running or interactive children get wrapped
in a named tmux session (the [`roundhouse:remote-mac`](/roundhouse/skills/remote-mac) pattern),
and orchestrate reports back the attach command. The session UUID is the child's durable
identity — the same child resumes later with `--resume <uuid>` on the same host; a new
assignment always gets a fresh UUID.

**The WSL-as-launcher lane for native Windows.** A native-Windows destination that declares a
`wsl_interop_via` sibling is reached through this same SSH lane, with one twist: orchestrate
SSHes into the *WSL side* of that machine, `cd /mnt/c`, and from there launches the
Windows-native `claude` binary through full-path `cmd.exe /c` — following Roundhouse's
fleet-agents interop rules (`%VAR%` syntax, not `$env:`; quote-heavy briefs go through the
`-EncodedCommand` hatch rather than nested quoting). WSL is only the launcher here — the actual
`claude` process that runs is a native Windows process, not something executing inside WSL. This
matters for evidence: WSL-side execution can never stand in as proof that something ran natively
on Windows (see [doctor.md](./doctor.md) for how this shows up as a health check). Dispatch
prerequisites for a native-Windows destination — marketplace desired-records, profile bundles —
can be staged ahead of time from any harness through Roundhouse's enrolled `windows-sftp` lane,
with broker pickup inside a minute, leaving only the final in-session convergence to run on the
Codex task surface.

Whichever lane is used, this is never raw shell commands dressed up as delegation. What gets
launched is an actual harness process with its own session identity, model policy, and terminal
report — held to the same readiness verification, single-use-child rule, one-canonical-writer
boundary, and monitoring cadence as any other child.

### Propagating the delivery policy

Orchestrate owns the task graph, the project's budget epoch, and the global concurrency
allowance. Before allocation or any work-starting action, it calls `railyard:model-routing` with
exact contract `railyard/model-routing/v1` (see [model-routing.md](./model-routing.md)) and
consumes the immutable snapshot it returns — policy digest, model/effort/transport, project
reservation, destination-bound lease, fallback. It never copies model constants or scoring rules
locally. With no catalog configured, the router's built-in Sol orchestration/review and Luna
implementation defaults apply.

This policy is only passed down to software-delivery children — a research, review, or
documentation child gets its own appropriate skill instead. Every child receives its objective,
owner, dependencies, terminal evidence, and title contract, plus an explicit concurrency
allowance and nested-subagent ceiling carved out of the global budget. Nothing gets sent back
into the orchestrator to execute.

Orchestrate applies the same explicit-model-and-effort dispatch rule that deliver and
model-routing enforce: every destination action — creating a thread, sending a message to one,
spawning an agent, launching a remote worker — re-enters model routing under exactly one
sender's authority, and a fresh dispatch always names its model and effort rather than silently
inheriting whatever the destination was last running.

### Freezing shared contracts before parallel work

For every seam two lanes share, orchestrate assigns one integration owner and one canonical
writer per shared file, freezing exact paths, schemas, field order, permissions, and acceptance
checks before parallel writers start — bound to content hashes, acknowledged by both sides
before dependent work is dispatched. Right after that freeze, it runs the thinnest possible
end-to-end canary across the seam. Once the interface has converged, scope is frozen too: no
adjacent abstractions or cleanup creep unless the accepted contract requires them or you change
the objective.

Each substantial independent lane runs in its own worktree so no two lanes and the orchestrator
share one tree — independent work is never serialized on a shared tree, and a lane is never paused
so the orchestrator can edit it. The lanes' branches converge onto **one integration branch → one
PR** as the usual end state; stacked PRs are the exception. Verification rides the same reflex:
lanes run scoped, tiered checks rather than a full long-suite re-run; a worker that writes tests
runs them and returns the command, its unmasked exit, and the output tail — a claimed "green"
without that receipt is rejected at acceptance; and a failure *class* is audited across the whole
surface in one pass rather than found one expensive run at a time.

### Directing the work

1. Define the outcome, constraints, dependencies, risks, and terminal evidence.
2. Split substantial work into a dependency DAG of independently verifiable scopes; keep simple
   work on one lane. One canonical writer per scope and shared file.
3. Give each durable, separately resumable assignment its own fresh visible task. A child task
   is single-use — orchestrate never resumes, unarchives, or repurposes an older task, even to
   reuse its worktree. Bounded internal subagents are for the orchestrator's own research or
   review, never a substitute for a visible execution task.
4. Every task or subagent starts with no inherited context: objective, owner, scope,
   title/concurrency/readiness contract, constraints, dependencies, acceptance criteria, and
   required evidence only — never the orchestrator's transcript or conclusions.
5. Children are expected to delegate their own separable work to fresh minimal-context subagents
   when useful, keeping writer boundaries explicit as they do.
6. Each lane is tracked through `admitted → oriented → active → frozen →
   consumed|superseded|blocked → terminal`. All dependency-ready lanes start together;
   monitoring happens by milestone or artifact, not tight polling. A lane producing nothing
   consumable gets one bounded redirect before it's replaced — a healthy long-running tool is
   never restarted just because time passed.
7. Before integration, orchestrate records each canonical checkout's expected branch, upstream,
   and HEAD, then synthesizes child evidence and verifies the combined objective — delegating
   any actual integration, review, or repair work to named owners rather than doing it itself.
8. If you change the objective mid-flight, still-valid evidence is preserved, only the affected
   children are revised or canceled, and the new contract propagates without restarting
   unaffected work.

## Scope

- Orchestrate is scoped to the objective, with each cross-project delivery
  receiving an explicit integration and baseline owner.
- Child work owns implementation, tests, commits, pushes, and merges (typically
  through a [deliver](./deliver.md) lane); the orchestrator verifies that work
  rather than repeating it.
- A checkpoint push records resumability. Review-ready branch, open PR, green
  CI, and completion are later states; the delivery owner performs branch
  pushes and the orchestrator records and verifies their evidence.
- Archive eligibility requires inspectable acceptance evidence, complete
  tests/reviews/docs, authorized merge and post-merge proof for delivery tasks,
  absent task worktrees from the registry and filesystem, and cleaned
  merged/closed/abandoned branches. Harness stop and idle signals remain
  observational until that evidence exists.
- Dirty worktrees and unmerged refs remain until explicit authorization covers
  their deletion.

## Example session

**Prompt:** "Ship the retry-queue fix on this machine and the dashboard update on my Windows
box, in parallel."

**What happens:** Orchestrate classifies this as work-starting and, because it spans two
independently resumable tasks on two hosts, takes the objective itself rather than fast-pathing
to deliver. It runs readiness checks through `roundhouse:fleet-projects` and
`roundhouse:fleet-agents` for both hosts, confirms the Windows box's `wsl_interop_via` entry and
interop lane are healthy, then calls model routing for the project's policy snapshot. It
dispatches the retry-queue fix as a local `deliver` child, and the dashboard update
as a real `claude` process launched over SSH through the WSL side of the Windows machine — `cd
/mnt/c` then a full-path `cmd.exe /c` launch of the native `claude` binary, wrapped in a named
tmux session it reports the attach command for. It tracks both lanes to terminal acceptance
(merge plus post-merge proof for each), synthesizes the combined result, and only then retitles
and closes out each child.
