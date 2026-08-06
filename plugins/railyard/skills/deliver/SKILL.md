---
name: deliver
description: Route one host-local software change or pull-request task through the correct Compound Engineering workflow, with LFG-first implementation delivery, Thermos review gates, React Doctor, PR babysitting, merge proof, and durable learnings. Use whenever the user says to implement, fix, ship, deliver, or "go do" a software change — and equally when they ask to brainstorm, design, plan, spec, or debug one: those route to the matching CE stage (ce-brainstorm, ce-plan, ce-debug) and stop at that artifact. Applies including when they name this skill directly, for a feature, bug fix, risky refactor, long-running implementation, or existing PR. Use railyard:orchestrate instead for multiple independently resumable tasks or cross-host placement.
---

# Goal Driven Delivery

Choose the delivery route and invoke the right existing skills. Do not replace
those skills with a long ad hoc prompt. This skill is the implicit entry point
for delivery requests: a plain "implement/fix/ship X" enters here without the
user naming it, and naming it still means routing through the child skills
below, never bypassing them.

## Harness surface

Both harnesses run this skill. Codex-native nouns map as follows on Claude
Code; where the cell says none, skip that gate — never block or invent a tool:

| Operation | Codex | Claude Code |
| --- | --- | --- |
| Fresh execution child | visible task / thread | `Agent` tool subagent; `run_in_background` for long work (always fresh-context — no flag needed) |
| Durable goal tracking | `/goal` | native task list (`TaskCreate`/`TaskUpdate`); `/goal` does not exist |
| Task title | thread title (own it) | session title where the host exposes one; CLI has none — skip retitle steps |
| Archive at terminal | native task archive | none — the verified terminal report is the record |
| Time-based polling | in-chat scheduled task | `/loop` or a scheduled task |
| Parallel reviewers | parallel subagents when supported | two `Agent` calls in one block — always supported |

Harness stop signals are nonterminal on both sides: Codex idle/sidebar state,
Claude Code `Stop`/`SubagentStop` hook events, and a completed background
subagent are never cleanup or completion authority.

## Thread title

Read and enforce `../../references/task-titles.md` whenever this skill
activates. Goal Driven Delivery always owns and maintains its task title, even
when a child workflow would impose a different convention:

`🎯 <state emoji> <Git issue and/or PR if applicable> <specific focus>`

## Boundary

Own one host-local implementation or pull-request lane from planning through
its requested terminal state. If the outcome needs multiple independently
resumable scopes or PRs, or work placed on another host, invoke
`railyard:orchestrate`; each worker may then use this skill for
its single owned lane. Do not duplicate the orchestrator's decomposition, host
allocation, cross-lane dependency tracking, or task monitoring here.

Do not archive tasks or mutate agent runtime when returning locally verified,
review-ready, PR-ready, blocked, or owner-action-required work — leave the
work visible and resumable. Per the harness table above, stop/idle signals are
never cleanup authority. When this is a directed child, Task Orchestrator
closes it out after terminal acceptance and report verification.

This skill is built on the external Compound Engineering plugin
(`EveryInc/compound-engineering-plugin`) — a required dependency, never
modified. PR monitoring requires its `ce-babysit-pr` (v3.20.0+). If CE is
missing or too old, offer to fix it before stopping:
`claude plugin marketplace add EveryInc/compound-engineering-plugin` then
`claude plugin install|update compound-engineering@compound-engineering-plugin`
(Codex: `codex plugin add compound-engineering --marketplace
compound-engineering-plugin`). Never hand-roll a watcher.

## Route selection

Resolve the requested artifact and terminal boundary before invoking a child
skill. An explicit narrower outcome wins over the implementation default. A
brainstorm, design, plan, or debug request about software work is a
delivery-routing request and enters this table — even when another installed
skill claims brainstorming or planning generically, and even when the
planning intent emerges mid-conversation rather than in the opening request
("update the plan", weighing approaches, requirements talk): load the route
at that moment. The CE stages below are the routes. Pick one route:

| Situation | Route | Stop at |
| --- | --- | --- |
| Brainstorm only | `compound-engineering:ce-brainstorm` | framing artifact |
| Plan only | `compound-engineering:ce-plan` | plan artifact |
| Diagnosis only | `compound-engineering:ce-debug` | findings |
| Diagnose and fix | `ce-debug`, then LFG | merge + post-merge proof |
| Generic implement, fix, or ship | `compound-engineering:lfg` | merge + post-merge proof |
| Explicit local-only implementation | `ce-plan` + `ce-work mode:return-to-caller` | requested local checks |
| Explicit Thermos after each chunk | Route B below | merge + post-merge proof |
| Existing PR review or watch only | CE review route or `ce-babysit-pr` | requested artifact |
| Existing PR to fix, drive, or deliver | CE review route or `ce-babysit-pr`, then tail | merge + post-merge proof |
| One-shot review cleanup | `compound-engineering:ce-resolve-pr-feedback` | resolved feedback |
| One-shot CI or code failure | `compound-engineering:ce-debug` | diagnosis/fix |
| Explicit tiny local edit | direct edit + targeted check | check green |
| Solved issue with reusable lesson | `ce-compound mode:headless depth:full` | captured learning |

"Plan and implement" is implementation delivery: LFG owns its plan stage, must
not invoke Goal Driven Delivery recursively, and is never wrapped in another
top-level plan/work route. Selecting an implementation-delivery route
authorizes the ordinary repository merge after required checks and reviews
pass; explicit approval requirements, merge restrictions, and protected-branch
policy still win.

Re-evaluate the boundary on every later user instruction: a later
local/return-to-caller stop halts shipping; a later authorized ship
instruction replaces an earlier local stop unless a higher-priority boundary
still applies. Record the reconciled boundary before invoking another carrier.

When invoked by Task Orchestrator, consume its explicit frozen contract rather
than inferring one from transcript history; the orchestrator owns the
plan-boundary routing decision.

## Delivery tail (merge and post-merge proof)

For implementation delivery, LFG owns plan → work → simplify → review →
browser test → commit/push/PR → CI and review settlement. Goal Driven
Delivery owns what comes after. When LFG returns, execute this tail rather
than merely reporting merge readiness:

1. Consume any bounded follow-up watch LFG returns; continue until review, CI,
   branch currency, and stack state are settled, without a new user request.
2. Confirm review evidence includes an independent Sol High or Sol Max pass;
   if missing, run that read-only review before merge, fix actionable findings
   with the selected implementation model, and rerun affected checks.
3. Confirm no explicit hold remains, then merge with the repository's
   configured strategy (`gh pr merge <pr> --squash|--merge|--rebase`). For a
   stack, use `gh-stack` and merge in dependency order.
4. Prove it: `gh pr view <pr> --json state,mergedAt,mergeCommit`, fetch the
   base, `git merge-base --is-ancestor <merge-commit> origin/<base>`, then run
   the smallest applicable post-merge check. Report those artifacts.

A pushed checkpoint, review-ready branch, open PR, green CI, merged change,
and post-merge proof are separate states; an explicit user or repository stop
still ends the route earlier.

## Model routing

Before work or any work-starting steering action, invoke
`railyard:model-routing` with exact contract
`railyard/model-routing/v1` — the only model, effort, budget, and
transport router. Run the shared intake first without a model call, provider
probe, task creation, or state mutation. Configured fleet/account delivery
enters Task Orchestrator even when it fast-paths one lane; explicit
local/no-fleet work or the no-config default stays here. Model selection never
changes the chosen workflow.

A skill cannot switch the session's model. If this session's model is a
materially higher tier than the routed tier for a work unit (premium
session, mechanical unit), dispatch that unit to a fresh child carrying the
routed model instead of running it inline; never open an unexpected
user-visible thread — subagents are the unsurprising form.

**Every subagent dispatch names an explicit model and effort. No
exceptions.** Subagents inherit the session model when the dispatch omits
one, which silently runs workers on the premium tier — the exact inversion
the routing exists to prevent. An omitted model field is a routing
violation, not a neutral default: implementation workers, researchers, and
routine reviewers dispatch at the harness's worker tier (on Claude Code,
Opus for implementation/research/review, Sonnet or Haiku for mechanical
extraction; effort per the harness reference), and a dispatch that
deliberately runs a child on the session's own premium tier must say so and
why in the dispatch. This applies to every carrier — direct Agent calls and
children spawned while driving external workflow skills alike.

Consume the resolver's immutable snapshot (policy digest, model/effort,
carrier/adapter, transport, budget lease, fallback, disclosure). With no
catalog it preserves the shipped Sol orchestration/review and Luna
implementation defaults, including the exact LFG implementation binding; never
reconstruct model constants or ranking rules here.

Immediately after selection, run the router's `build-work-contract` command —
a stdin command of the model-routing script, invoked exactly as that skill
describes, not a host tool — with the frozen
objective/source-of-truth/scope/constraints/authorization/acceptance/stop
digests plus the selected carrier/model/effort. Preserve its invariant digest
and apply its source-owned presentation overlay to the dispatched brief;
direct user and repository instructions outrank the overlay.

Before fan-out, emit an objective/artifact admission receipt covering every
named platform, lifecycle path, security boundary, deliverable, completion
condition, and producer-to-consumer chain. A missing objective item blocks
expansion; ordinary uncertainty gets at most one bounded spike.

For configured nested work, reserve and claim one bounded delegated-slot
bundle before the owning workflow; consume a slot durably immediately before
its action, release unused slots only at terminal reconciliation. Review peers
and workers cannot delegate, change policy, commit, push, merge, or expand
authority. Run independent work in parallel only when writers, dependencies,
transport, and reservations do not overlap; one canonical writer per mutable
scope.

### Stage-scoped overrides for unchanged Compound Engineering

CE stays an unchanged external carrier. A frozen model-routing decision may
replace only a named CE execution mechanism — never the workflow, persona,
legitimacy gate, artifact schema, writer ownership, review authority, or
terminal boundary. The supported case is the cross-family reviewer, and its
direction depends on the running harness: when CE Code Review, Doc Review,
POV, LFG review, or Thermos launches its optional cross-model reviewer, a
Codex host reaches Claude only through CE's existing attested read-only
Claude `-p` adapter, and a Claude Code host reaches the other family through
`railyard:oracle` or the codex plugin's rescue forwarder — never a
hand-rolled parallel runner in either direction. Findings feed the same
synthesis step; until the CE seam attests the binding, the route is
`transport_unsupported`. The router's GLM scout/engineer seams remain
fail-closed — GLM work runs on Codex via the harness reference's `codex exec`
route (from Claude Code, that command via Bash), not through a CE override.

If the selected adapter cannot be attested, take the resolver's disclosed
fallback or block. Never pass GLM, Fable, or Opus through a Codex selector,
silently inherit CE's model, or patch CE source/cache.

## GitHub checkpoints and stacked delivery

When a writable GitHub remote exists, push active-lane or integration branches
at useful checkpoints so another agent or machine can resume. A checkpoint
push does not open a PR, trigger review, or imply completion.

Before starting LFG, establish the named branch and its writable upstream. Run
a lane-owned checkpoint monitor beside LFG (on Claude Code, a background Bash
loop or the Monitor tool watching the branch head; on Codex, a background
thread): when the canonical branch advances to a clean, stable commit created
by the work stage, push it without opening a PR. Stop the monitor when LFG
enters commit/push/PR or returns. The monitor never edits, stages, or decides
readiness.

For dependent delivery against a GitHub upstream, use `gh-stack`. If missing,
install both agents' copies and verify, without prompting:

```bash
gh extension install github/gh-stack --force
gh skill install github/gh-stack --all --agent codex --scope user --force
gh skill install github/gh-stack --all --agent claude-code --scope user --force
gh stack --version
```

Use `gh-stack` for the dependent chain; keep unrelated PRs independent.

## Verification cadence

When directed by Task Orchestrator, acknowledge its frozen paths, schemas,
permissions, ownership, hashes, and acceptance checks before writing; for a
standalone lane with parallel writers, establish the same contract locally.
One canonical writer per shared file; run the thinnest real seam canary before
downstream code expands.

- Targeted checks in the edit loop. Run a component gate only when its input
  hash changes; one full integration gate after all writers freeze; rerun only
  evidence a relevant shared-code fix invalidated. Preserve command,
  toolchain, input hashes, result, and timestamp so reviewers reuse receipts
  instead of rerunning suites.
- At kickoff, verify the carrier/model and exact CI-parity toolchain once.
  Classify native gates as hosted, locally runnable native,
  interactive-elevation, or recoverable-host; one class never proves another.
  Keep `executionHost` separate from `targetPlatform`; WSL never proves native
  Windows.
- Implement a coherent vertical chunk before pausing: the smallest
  behaviorally complete slice with a focused check that can fail for that
  behavior. At the boundary run the minimum focused checks; do not rerun an
  unchanged check because another file was edited.
- At seam freeze and before integration, surface disproportionate line
  growth, execution time, or fixture cost, then simplify or rescope. After
  interface convergence, freeze scope; reject adjacent abstractions unless the
  user explicitly reopens.

Before a substantial implementation unit, name its observable user operation
and the secondary state proving the result reached the real consumer; a new
platform, manager, carrier, or privileged capability needs one end-to-end
exemplar before sibling expansion. Before scaling a compiled/native helper,
service, daemon, or material complexity increase, write a simplification
receipt comparing an existing helper, stdlib, platform API, and repository
primitive, name the exact security property a simpler choice loses, and prove
the build→package→install→invoke chain — else stop after one bounded spike.

Treat hosted CI and remote/native matrices as frozen-input proof, not the
default debugger: after the first opaque failure, isolate the smallest stage,
add bounded secret-free progress evidence, and allow at most one instrumented
diagnostic push per unresolved stage.

Maintain a compact restart receipt (plan digest, objective epoch, governing
skill digest, active lanes, frozen inputs, decisions, reusable evidence);
resume at the next invalidated action rather than rereading the repository.
Render status from one terminal-gate ledger: implementation units, changed
repositories, frozen checks, native/hosted/lifecycle gates, review,
Git/PR/merge state, release coupling, and clean-state proof. "No currently
known implementation defects" is not terminal completion; "only X remains" is
allowed only when every other gate is satisfied, intentionally excluded, or
explicitly blocked. Report wall time, active-agent time, external wait, and
tool time separately from model tier and token/cost; neither metric weakens
final proof.

## Evidence and blockers

Report the selected route, terminal state, checks, review or CI evidence, and
branch/PR/merge evidence that applies. If blocked, stop with the exact failing
gate, evidence, and next human decision while leaving the work resumable.

## Thermos gate

For every Thermos gate, invoke the sibling skills in this plugin:
`railyard:thermos` (orchestration and synthesis),
`railyard:thermo-nuclear-review` (correctness, breakage, security,
devex, feature-leak), and `railyard:thermo-nuclear-code-quality-review`
(maintainability, structure, code health). If plugin-qualified names are not
exposed, read the sibling `../thermos/SKILL.md`, `../thermo-nuclear-review/SKILL.md`, and `../thermo-nuclear-code-quality-review/SKILL.md` files directly.

Run the two review passes in parallel when subagents are supported, give both
the same scoped diff plus enough source context, synthesize and deduplicate,
fix every real finding before committing the chunk, and record any non-fix
with evidence. Thermos is the pre-commit "would review have caught this?"
gate, not a substitute for tests, React Doctor, CE review, or CI.

## React gate

If a chunk touches React, Next UI, JSX/TSX, component packages, styling
recipes, client/server boundaries, or browser-visible behavior, run React
Doctor from the project root before committing that chunk:

```bash
npx react-doctor@latest --staged --no-score
```

Use `--staged` after staging the chunk; use `--diff` for an unstaged
branch/local scan; add `--json` for machine-readable output. Do not invent
project scripts, assume a local install, or add it as a dependency without
explicit request. Fix real findings before commit; run again before PR on
UI-heavy branches; skip for backend-only, schema-only, script-only, and
docs-only diffs.

## macOS/iOS app work

When the change targets a macOS or iOS app and the lane needs to run Xcode
builds, simulator tests, or XCUITests, prefer the `tart-xcode-runner` plugin
(disposable Tart VMs — UI tests never seize the host display, and every run
starts from a pristine image). If it is not installed, suggest it once —
`claude plugin install tart-xcode-runner@novotnyllc` plus the `tart` CLI —
and proceed with host-local tooling if declined; never install it silently.

## PR feedback and monitoring

Use `ce-babysit-pr` whenever the request is to watch, babysit, or drive an
open PR toward merge readiness; it owns the watch loop and delegates feedback
fixes to `ce-resolve-pr-feedback` and CI fixes to `ce-debug` — do not pre-run
those stages. Use `mode:pipeline` when another workflow needs a bounded
non-interactive result; interactive mode when the user asks to keep watching.
Babysitting never authorizes merging; Goal Driven Delivery owns the merge and
post-merge tail after a settled mergeable result. On an LFG route, never
invoke `ce-babysit-pr` separately — LFG owns its pipeline invocation.

## Route A: standard LFG delivery

For normal feature and bug-fix work, invoke `compound-engineering:lfg`
directly with the feature brief. Do not wrap it in `/goal`, insert Thermos
into its internal order, or start a duplicate babysitter. Template (the
routing line is stage-scoped control data, not plan content):

```text
Implementation routing: apply the claimed `railyard/model-routing/v1` snapshot verbatim. Pass its emitted LFG implementation binding only at the ce-work seam. Apply any named stage-scoped override without changing the CE workflow, persona, artifact schema, authority, or terminal boundary. Disclose requested and actual model, effort, adapter, transport, and fallback.

Deliver <FEATURE> through merge and post-merge proof.

Outcome: <measurable behavior>.
Verification: <targeted tests/checks>, plus the repo final gate.
Constraints: preserve <critical existing behavior/security/data boundaries>.

Invoke compound-engineering:lfg for implementation delivery. Inspect its structured handoff, verify the applicable local evidence, and continue through authorized merge and post-merge proof. If the user explicitly requested local-only work, invoke ce-plan then ce-work mode:return-to-caller instead. If blocked, report the exact gate, evidence, and next human decision while leaving the work resumable. If the work produces a reusable lesson, invoke compound-engineering:ce-compound mode:headless depth:full before the final summary.
```

When LFG returns an explicit follow-up watch invocation, run exactly that
continuation, then execute the delivery tail above.

## Route B: chunked hardening goal

Only when the user explicitly requests Thermos review after each chunk. On
Codex, prefix the first line with `/goal `; on Claude Code, run the same
workflow tracking the stages with the native task list:

```text
Deliver <FEATURE> with chunk-level hardening through merge and post-merge proof.

Outcome: <measurable behavior>.
Verification: <targeted tests/checks>, plus the repo final gate.
Constraints: preserve <critical existing behavior/security/data boundaries>.

Workflow:
1. Invoke compound-engineering:ce-plan; no code until an implementation-ready plan exists.
2. Implement one vertical chunk at a time with the selected implementation model; one canonical writer per chunk.
3. After each non-trivial chunk: smallest relevant checks, React Doctor if UI, the Thermos gate, fix all real findings, inspect the diff. Commit explicit paths only when authorized.
4. Before final review, invoke compound-engineering:ce-simplify-code unless the diff is docs-only or trivial.
5. Re-run React Doctor after simplify on UI-heavy branches.
6. Invoke compound-engineering:ce-code-review mode:agent with the plan path; apply all eligible findings.
7. Invoke compound-engineering:ce-test-browser mode:pipeline when UI behavior changed.
8. Stop at a locally verified tree only for an explicit local-only stop; otherwise continue the delivery tail.
9. Invoke compound-engineering:ce-commit-push-pr, then ce-babysit-pr with the PR URL; Goal Driven Delivery owns merge and post-merge proof.
10. Invoke compound-engineering:ce-compound mode:headless depth:full for reusable patterns.
```

The chunk loop forces local review before the branch accumulates enough
mistakes for CI and GitHub review to become the first real QA pass.

## When to run ce-compound

Run `compound-engineering:ce-compound mode:headless depth:full` after the
work, before the final summary, when a review/CI failure found a real reusable
mistake, a new repo pattern or vocabulary was established, a provider/
migration/auth/data/deployment edge case was solved, or recurring churn got
clarified. Skip for typo fixes, one-liners, and mechanical docs edits.

## First-pass quality rules

Stop and fix before PR when any of these are true:

- Tests are all mocked around a cross-layer behavior.
- A status, provider intent, email, import, or migration can partially write
  and then fail without an idempotent retry story.
- The code adds a new helper while an existing helper already does the job.
- The code adds config, UI, worker, queue, or abstraction not required for the
  current behavior.
- A public/API contract changes without a test at the boundary.
- The plan or PR cannot name the exact verification surface.
- A React/Next UI diff has not passed the React gate.
- Risky work skipped its final Thermos gate, or a chunk-hardened route skipped
  a chunk gate.
