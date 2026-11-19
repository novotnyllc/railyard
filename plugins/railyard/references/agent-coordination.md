# Agent completion and waiting

Dispatch a bounded scope, then do independent work without duplicating the
child's assignment. Ask the child to report completion, a blocker, or a
dependency that needs attention, and carry the same rule into any
descendant's brief. Children do not poll the parent for more work, and the
parent does not ask for repeated status.

## Worktree ownership

When writers work concurrently in one repository, assign each writer a
separate Git worktree and branch before edits, even for disjoint files. Count
the coordinator as a writer when it edits. A shared checkout is fine for
read-only work. Keep one integration owner and integrate each verified result
before publishing the combined change.

Reuse a suitable harness-managed worktree when a writer already has one. For
setup, follow `compound-engineering:ce-worktree` when available. It prefers the
harness tool and falls back to Git when necessary. Verify the path, branch,
and intended base before edits, including when the harness creates the tree
on dispatch. If isolation is unavailable, serialize the writes.

After the writer stops, remove a worktree created by this task only when its
output is verified as integrated and the tree is clean of changes and untracked
files, including ignored files. Use normal removal or the harness's cleanup
operation without force. Preserve user-owned, active, unmerged, dirty, and
untracked work. Report the path and reason for each task-created worktree left
behind. Task archival and process cleanup require separate authorization.

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
| Claude Code subagents | A top-level session can background children and use native completion notifications. A subagent that coordinates its own children launches them as foreground (blocking) `Agent` calls issued together: a nested background child's completion notice goes to the top-level session, not to it. Use `Monitor` or another wait capability only when it is exposed and documents the needed wake-up behavior. |
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
