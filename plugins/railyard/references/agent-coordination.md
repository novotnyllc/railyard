# Agent completion and waiting

Use completion notifications to coordinate children. Dispatch a bounded scope,
then do independent work without duplicating the child's assignment. Ask the
child to report completion, a blocker, or a dependency that needs attention;
do not request repeated status messages or acknowledgements of those reports.
Children do not poll the parent for more work. Carry the same coordination rule
into any descendant's brief.

## When the coordinator has nothing else to do

1. Prefer the harness's supported yield or end-turn mechanism **only when it
   guarantees resumption on the required child event**. A notification that
   arrives during an active turn does not prove it can wake an ended turn.
2. Otherwise use a blocking event wait, with a substantial timeout within the
   current harness and user-interruption limits. Handle delivered events, then
   re-arm the wait if owned work remains. A timeout is not completion or failure.
3. Poll only when the carrier has no usable event/wait surface, or a concrete
   recovery question requires a status check. Set a deadline and back off on
   unchanged state; never use tight sleep/status or log-reading loops.

Do not end a turn merely to abandon unfinished work. Establish the resume path
first, retain ownership, and verify the returned artifacts before accepting
completion. Never duplicate a dispatch just because a wait timed out.

## Use the actual tool contract

| Surface | Coordination |
| --- | --- |
| Codex native subagents | Consume pushed messages and final results. When blocked, use `wait_agent` if exposed; it wakes on mailbox activity. Do not loop over `list_agents`, log files, or status requests. |
| Explicitly requested Codex tasks | Use `wait_threads` with the returned task ID, host ID, and latest cursor as `afterCursor`. Batch independent targets within the tool's limit. Use a nonzero timeout for waiting; `timeoutMs: 0` is a one-off snapshot, not a monitoring loop. |
| Claude Code subagents | Use native completion notifications. If an exposed `Monitor` or other wait capability documents the required event and wake-up behavior, use it; do not assume the tool exists or that it watches every child type. |
| Remote or provider workers | Prefer the carrier's completion stream, callback, or native wait. Use bounded result/log inspection with backoff only when that surface is unavailable or recovery needs it. |

Use `read_thread` only to retrieve missing context or investigate a concrete
problem after an event or explicit status request. A wait cursor suppresses
already-delivered results; retain it across waits. Commentary does not wake
`wait_threads`, so a time-sensitive dependency or blocker needs a supported
direct message to its owner. Do not repeatedly fetch unchanged transcripts.

For native Codex children, `send_message` delivers coordination but does not
start an idle agent. Use `followup_task` when an idle child must resume; do not
send a message and then wait forever for work that was never started. Other
harnesses use their documented resume/message operation. Discover deferred
tools when needed; the active schema wins over these examples. A supported
yield is not an invented `yield_agent` call or an arbitrary final response.

Keep one completion owner. The orchestrator handles child dependencies; CE's
existing watcher owns PR review and CI. Do not create another watcher, timer,
automation, or visible task to simulate a missing completion mechanism without
the applicable user authorization.

## Evidence and limits

Checked 2026-09-22 against the active Codex tool schemas and primary posts:

- [pvncher, September 12](https://x.com/pvncher/status/2098841379837260144):
  delegate a bounded assignment and send a completion message that wakes its
  originator. This depends on a working wake-up route, not merely messaging.
- [pvncher, September 11](https://x.com/pvncher/status/2098390877047570473):
  different models use subagents differently; stopping and using Monitor can
  reduce waiting overhead where that harness supports it.
- [pvncher, September 16](https://x.com/pvncher/status/2100214368835133700):
  longer waits limit polling overhead; repeated context and duplicate work
  also matter. A longer wait is a fallback, not proof polling is eliminated.
- [pvncher, September 19](https://x.com/pvncher/status/2101388254020870389):
  newer advice explicitly rejects transferring the earlier Sol-era
  orchestrator pattern to Astra. These waiting rules do not prescribe that
  orchestration topology or establish a model-efficiency claim.

These observations guide coordination, not model selection or task-creation
authority. Follow the active harness's documented behavior rather than copying
another model's tools or assuming an idle session resumes automatically.
