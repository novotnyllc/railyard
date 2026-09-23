---
name: thermos
description: "Combine targeted correctness/security and maintainability reviews when explicitly requested or justified by substantial risk. Optional deep review; not a routine delivery gate."
---

# Thermos

Use Thermos for a requested combined deep review or a change whose risks need
both correctness/security and maintainability expertise. For a single concern,
use the relevant sibling skill directly. Ordinary work does not require
Thermos, a second model, or an additional review after the selected delivery
workflow has covered the relevant concerns.

## Reviewer allocation

Choose each reviewer's model **and** reasoning effort for its bounded scope
before dispatch. Use `railyard:model-routing` when an active Railyard route
owns that assignment; consume any already-reserved slot once. Otherwise make
the choice through the current native tool's supported fields. GPT-6 Sol at
`medium` is the ordinary Codex review baseline where that dispatch surface
supports it; raise effort for demanding review and use Astra for a specific
need. Deliberate inheritance is valid when the
inherited pair is known and suitable; record that choice rather than silently
omitting allocation.

Use the available native subagent tool and roles. On Codex, explicit model or
effort overrides require a supported limited/no-history fork; full-history
forks inherit both settings. Give a reviewer without history a self-contained
brief. If the runtime offers a role with fixed model/effort, use its
authoritative binding and omit forbidden overrides. A persona is prompt
content, not proof that a named `explorer` or custom agent type exists. Native
spawn does not provide arbitrary per-child plugin enablement.

For a selected cross-model pass, use the owning workflow's supported adapter.
Compound Engineering owns its configured cross-model review mechanism; do not
launch an additional raw provider runner alongside it. Railyard's fixed
adapter contract applies only when that exact seam and receipt binding are
available. Otherwise report `transport_unsupported` for the routed request,
and let the owner select an available route. A requested model, provider
receipt, and verified serving model/effort are distinct facts; disclose any
missing evidence. Oracle browser Pro is a separate transport from native
Astra `max`.

## Workflow

1. Establish the reviewed base/head or changed file set, objective, relevant
   requirements, and the two concerns. Keep a stable review snapshot while
   reviewers run. Include useful existing test results and known limitations.
   Use a frozen digest or formal packet when the caller's contract needs one;
   routine review does not require a new artifact ledger.
2. Reuse a completed review when it covers the same inputs and concern with
   the independence the caller needs. Launch only uncovered concerns or an
   unresolved question. Independent passes can run concurrently:
   - Correctness/security: read `../thermo-nuclear-review/SKILL.md` and its
     applicable references, then pass that guidance with the scoped brief.
   - Maintainability: read
     `../thermo-nuclear-code-quality-review/SKILL.md` and pass that guidance
     with the scoped brief.
   On Codex and Claude Code, use the current generic subagent facility and
   include the needed instructions when structured skill attachments are not
   supported. On a harness with registered review agents, use a registered
   type only after confirming it exists.
3. Ask for prioritized, evidence-backed findings and an explicit disposition
   of the assigned concern. Reviewers inspect the changed behavior and its
   relevant dependencies without editing the shared tree. Validate an actual
   delivery/packaging risk where it exists; a missing formal receipt alone is
   not a defect. Reuse unchanged test results and run further checks only to
   resolve a concrete gap.
4. Collect every launched review through the available native wait/result
   mechanism. Launch acknowledgement and progress are not completed review.
   Synthesize findings, deduplicate overlaps, and resolve disagreements. A
   further reviewer needs a specific unanswered question and a deliberate
   model/effort choice.
5. Return the unified verdict, actionable findings, coverage, and remaining
   uncertainty to the existing workflow owner. When CE owns delivery, it is
   the single owner of feedback resolution, review settlement, and CI
   monitoring. Thermos supplies findings; it does not start a competing
   watcher, re-review loop, or merge gate.

Do not restate individual background summaries wholesale when they are
already visible. Report what the combined review changes about the decision.
