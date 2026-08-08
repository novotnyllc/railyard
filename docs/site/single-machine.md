<!-- cross-repo links use site-absolute paths, resolved at site build -->

# railyard on one machine

Everything on this page runs on the machine in front of you, with nothing else configured. No
fleet, no second host, no shared store. You install railyard, say "set up railyard," answer "just
this machine," and you have the whole delivery system: a human says *go do X*, and agents route
it, implement it, review it, merge it, and prove it landed.

The [fleet](#when-you-add-a-second-machine) is an amplifier you can add later. It is never a
prerequisite for anything below.

## Intent-routed delivery

You say what you want in plain language. railyard reads the intent and stops at the artifact you
actually asked for — no skill name to remember, no workflow to pick.

```text
> Fix the flaky retry test in the billing service and get it merged.
```

That routes to a full implementation-through-merge run. But intent is read precisely:

- "Brainstorm an approach for X" stops at a framing artifact.
- "Plan the migration" stops at a plan.
- "Why is this test flaky?" stops at a diagnosis — it doesn't fall through to writing code.
- "Ship it" carries all the way to a merged, proven change.

An explicit narrower outcome always wins over "just implement it," and the boundary is
re-read on every follow-up: say "just get it to a local checkpoint" mid-run and shipping halts;
say "okay, ship it" later and it reopens. This is [deliver](./skills/deliver.md), the front door
for one host-local change or pull request.

## Budget-aware model routing

Before any work starts, railyard resolves an explicit model and effort for the unit about to run
— so routine steering doesn't burn a premium tier and hard implementation isn't handed to a model
that's too small for it. On the no-config default, Claude Code maps to:

| Work | Model / effort |
| --- | --- |
| Routine steering | Opus `medium` |
| Mechanical work | Sonnet `medium` |
| Implementation | Opus `high` |
| Difficult review | Fable `high` |
| Critical review | Fable `max` |

The point is the *right* model per task, not premium-for-everything. You never configure this on
one machine — the built-in defaults are a complete, valid setup. If you later want to encode your
own policy, a credential-free catalog can, but a zero-config machine already routes correctly.
This is [model-routing](./skills/model-routing.md).

## Dispatch discipline, enforced

Every subagent railyard dispatches names an explicit model and effort. That's enforced
mechanically, not by convention: a Claude Code `PreToolUse` hook (`dispatch-gate.js`) refuses any
`Agent`/`Task` dispatch that omits the model field, so routine work can't silently inherit a
premium session's tier. The hook fails open on anything it doesn't recognize — it closes exactly
one gap and never breaks a session.

Two lighter hooks round it out: a `SessionStart` charter injects the routing rules once per
session, and a `UserPromptSubmit` nudge points a delivery-shaped prompt at the right front door
before the model even has to think about it. A `SubagentStop` marker records when a fan-out
drains, so [audit](#the-audit-and-retrospective-trail) can tell a finished dispatch from an
abandoned one. Children are expected to delegate their own separable work to fresh
minimal-context subagents, with a nested ceiling — deep recursion is bounded, not open-ended.

## The Thermos review gates

Before every commit of risky or non-trivial work, [Thermos](./skills/thermos.md) runs two
independent review passes in parallel against the diff, then synthesizes both into one set of
findings — every real one fixed before the chunk lands. It's the pre-commit "would review have
caught this?" check, standing between "it compiles" and the review a human reviewer would give
the PR.

The two lenses are distinct skills, each a different read on the same frozen packet:

- **`thermo-nuclear-review`** — a security and correctness audit. It traces the changed code for
  three specific failure classes: functionality breakage from subtle cross-module side effects,
  developer-experience breakage (moved secrets, renamed env vars, remapped ports, new setup
  steps), and feature-flag leaks — a gated feature escaping its gate. It's told not to
  over-report: every high-priority finding needs end-to-end tracing first.
- **`thermo-nuclear-code-quality-review`** — an unusually strict maintainability review. It's
  told to be ambitious, hunting "code judo" that deletes whole categories of complexity rather
  than rearranging them. A file crossing 1,000 lines because of this PR is a default-blocking
  smell; ad-hoc conditionals on unrelated flows, thin wrappers, cast-heavy boundaries, and
  duplicated canonical helpers all get flagged.

Both run as fresh-context subagents, each carrying an explicit routed model and effort. Thermos
checks concern coverage first and reuses a matching independent review rather than launching a
redundant one.

## Oracle: a second model with your real code attached

When you want a second opinion that has actually read the files, [Oracle](./skills/oracle.md)
bundles a prompt plus a chosen file set and sends it to a second frontier model — through the
ChatGPT Pro browser, or an API call with your explicit consent. It's built for "attach the real
code and think hard," a review that can run ten minutes to an hour, checkpointed so you can walk
away and reattach. Every answer is advisory: verified against the codebase and tests before it's
acted on.

## The React gate

When a change touches React, Next UI, JSX/TSX, component packages, styling, client/server
boundaries, or any browser-visible behavior, railyard runs React Doctor from the project root
before committing that chunk:

```bash
npx react-doctor@latest --staged --no-score
```

Real findings get fixed before commit. Backend-only, schema-only, script-only, and docs-only
diffs skip this gate entirely — it runs where it earns its place.

## React Doctor for the delivery system itself

The other kind of diagnosis is the system, not the code. [Doctor](./skills/doctor.md) checks
whether the delivery system itself is healthy — harness parity across Claude Code and Codex,
marketplace freshness, Compound Engineering and ponytail present and current, router state,
credential *presence* (never values). Its diagnostic pass is strictly read-only; a healthy machine produces
a short all-green table, not noise. Fixes apply only after you consent, and every fix re-checks
green before it counts. Use [setup](./skills/setup.md) when something is missing; doctor when
something that worked stopped working.

## The audit and retrospective trail

Every delivery ends with a short recap. On request, [audit](./skills/audit.md) reconstructs the
full decision chain from railyard's run log — which skills routed, what decided what, how many
subagents fanned out on which models and why, retries, review rounds, and whether the run matched
its planned shape. It reads the run log, not the diff, so it answers "how did this run go?" The
log outlives transcript compaction, so the trail survives even after the conversation is gone.

The retrospective goes further, and it runs automatically: the closing step of a substantial run
asks pointed, run-specific questions and answers them against the evidence — a tier higher than the
work needed, a check re-run on unchanged input, a dispatch nobody noticed drain — and grades the
run against the approach it set out at kickoff. Repo-scoped lessons land in
`compound-engineering:ce-compound`; cross-repo routing lessons append to
`~/.config/railyard/learnings.md`; a fix that belongs in a skill becomes a suggestion file. A Stop
(Claude Code) / SessionEnd (Codex) hook reminds when a substantial run would end without that loop
— metadata only, and never blocking the stop. The system gets better because each run leaves a
durable trace of how it actually went, and closes the loop on itself.

## Codex runtime hygiene

If you run Codex, a crashed or detached session can leave app-server processes running.
[cleanup-codex](./skills/cleanup-codex.md) handles that: a macOS `SessionEnd` hook silently reaps
only same-user processes carrying the exact ending thread's ID, and a read-only `inspect` reports
stale servers, descriptor counts, and process age on demand. It only ever touches residue it can
prove is exactly the residue it thinks it is — incomplete evidence is always a refusal, never a
guess. On every platform other than macOS it's a guaranteed-safe no-op.

## What "done" means here

A pushed checkpoint, a review-ready branch, an open PR, green CI, a merged change, and post-merge
proof are six different states, and railyard treats them as six different states. When a run
reports done, it means the merge commit is reachable from the base branch —

```bash
git merge-base --is-ancestor <merge-commit> origin/<base>
```

— and the smallest applicable post-merge check ran green. Both are reported as evidence, not a
status message. "Tests pass" and "done" are different claims, and railyard always tells you which
one you're holding. Walk the full path on the [delivery lifecycle](./lifecycle.md) page.

## When you add a second machine

Everything above is complete on one host. A [fleet](/roundhouse) adds placement: work runs on the
machine best suited to it, and railyard verifies each destination is ready before placing anything
there. The delivery shape doesn't change — routing, gates, merge, and proof are identical — it
just gains a "which machine" decision, owned by [orchestrate](./skills/orchestrate.md).

That's the point at which the fleet-side docs start to matter:

- [The store](/roundhouse/store) — where a fleet's shared desired state lives.
- [Convergence](/roundhouse/convergence) — how every machine reaches the same agent surface.
- [Trust](/roundhouse/trust) — why the store is a trusted-write surface and how it's protected.
- [Why jj](/roundhouse/why-jj) — the version-control choice underneath it.
- [Operating a fleet](/roundhouse/operating) — the day-to-day.

Until then, none of it is in your way. railyard is a complete tool on the machine you're already
using.
