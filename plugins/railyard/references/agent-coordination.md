# Agent completion and waiting

Dispatch a bounded scope, then do independent work without duplicating the
child's assignment. Ask the child to report completion, a blocker, or a
dependency that needs attention, and carry the same rule into any
descendant's brief. Children do not poll the parent for more work, and the
parent does not ask for repeated status.

## When the coordinator has nothing else to do

1. End or yield the turn only when the harness guarantees resumption on the
   child's event. A notification delivered during an active turn does not
   prove it can wake an ended one.
2. Otherwise use a blocking event wait with a substantial timeout. Handle
   delivered events and re-arm while owned work remains. A timeout is neither
   completion nor failure, and never a reason to dispatch a duplicate.
3. Poll only when the carrier has no event or wait surface, or a concrete
   recovery question needs a status check. Set a deadline and back off on
   unchanged state.

Before ending a turn with work outstanding, establish the resume path and keep
ownership. Verify returned artifacts before accepting completion.

## Tool behavior

| Surface | Coordination |
| --- | --- |
| Codex native subagents | Consume pushed messages and final results. When blocked, use `wait_agent` if exposed; it wakes on mailbox activity. Do not loop over `list_agents`, log files, or status requests. |
| Explicitly requested Codex tasks | Use `wait_threads` with the returned task ID, host ID, and latest cursor as `afterCursor`. Batch independent targets within the tool's limit. Use a nonzero timeout; `timeoutMs: 0` is a one-off snapshot. |
| Claude Code subagents | Use native completion notifications. Use `Monitor` or another wait capability only when it is exposed and documents the needed wake-up behavior. |
| Remote or provider workers | Prefer the carrier's completion stream, callback, or native wait; fall back to bounded result/log inspection with backoff. |

A `wait_threads` cursor suppresses already-delivered results; keep it across
waits. Commentary does not wake `wait_threads`, so a time-sensitive blocker
needs a direct message to its owner. Use `read_thread` only for missing context
or a concrete problem.

For native Codex children, `send_message` delivers coordination but does not
start an idle agent; use `followup_task` to resume one. Other harnesses use
their documented resume or message operation. The active tool schema wins over
these examples.

Keep one completion owner: the orchestrator handles child dependencies, and
CE's existing watcher owns PR review and CI. Do not create another watcher,
timer, automation, or visible task to stand in for a missing completion
mechanism without user authorization.
