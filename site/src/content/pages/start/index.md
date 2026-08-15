---
layout: default
title: Start here
nav_order: 2
has_children: true
---

# Start here

Begin with one outcome you can prove. Install the smallest useful surface, make one delivery on the machine you already trust, and add a machine when placement or convergence earns its place. This sequence builds confidence from working evidence and keeps the operating model easy to understand.

If a command or gate stops, use the [troubleshooting guide](/troubleshooting/) before changing the delivery path.

## The run

The operator asks for one verified result, not a tour of every feature. Railyard carries the first change through route, review, merge, and post-merge proof; Roundhouse adds a machine only when readiness or convergence earns its place. The turn is the first terminal receipt: a merged result for delivery or a readiness result for the machine. The run closes when that evidence is visible and the operator can choose the next loop from experience.

- [Install](/start/install/) — add the delivery and fleet plugins to Claude Code, Codex, or both.
- [First delivery](/start/first-delivery/) — go from one sentence to a verified merge on one machine.
- [First machine](/start/first-machine/) — establish a readable fleet baseline and a readiness proof.
- [Bootstrap a fleet](/start/fleet-bootstrap/) — create the private store, signed genesis, verified remote, and first convergence.

## What happens around your request

Railyard makes three ambient behaviors visible so a session starts with the same operating contract it later audits.

At session start, the routing charter supplies the delivery, remote-operation, orchestration, model, review, and retrospective doctrine. It also checks the two required workflow dependencies as one install group and writes a metadata-only session anchor to the run log.

When a prompt clearly names software delivery, planning, existing-PR work, fleet maintenance, several independent pieces, or a bounded operation on one host, the prompt hook adds at most one just-in-time routing line. Ordinary conversation, slash commands, and short prompts stay quiet. The nudge chooses a workflow while work-start authority remains with the session.

At Stop in Claude Code or SessionEnd in Codex, the retrospective hook looks for a substantial run that has not closed its audit loop. Two allowed dispatches meet the default threshold; a session-bound opening `approach` line also covers a multi-hour run with no fan-out. The reminder is metadata-only, once per session, and non-blocking. The session still performs the [audit and retrospective](/delivery/audit/).

```text
session_start=charter+run-log-anchor
prompt=delivery-intent nudge=railyard:deliver
session_end=substantial retrospective=reminded non_blocking=true
```

## Choose the path

| You want | Start with |
| --- | --- |
| Reviewed code delivery | [First delivery](/start/first-delivery/) |
| Fleet inventory and readiness | [First machine](/start/first-machine/) |
| A new private fleet | [Bootstrap a fleet](/start/fleet-bootstrap/) |
| Both | Install both plugins, then follow the two paths independently |

The delivery system and fleet system each produce value on their own. With both installed, their integration adds readiness-aware placement.

Railyard and Roundhouse provide the implementation evidence behind this way of working. Their [delivery source](https://github.com/novotnyllc/railyard) and [fleet source](https://github.com/novotnyllc/roundhouse) keep releases and review history visible beside the guide.
