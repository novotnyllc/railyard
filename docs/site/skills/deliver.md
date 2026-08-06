<!-- cross-repo links use site-absolute paths, resolved at site build -->

# Deliver

Deliver is the front door for one host-local software change or pull request. Ask for a fix, a
feature, a refactor, or ask it to watch an existing PR through to merge, and it picks the right
workflow, routes the model, runs the review gates, and stays on the hook until the work is
actually merged and proven — not just "tests pass, PR open."

## When to use it

- You say "implement X," "fix X," "ship X," or "go do X" — this is the implicit entry point. You
  don't have to name the skill; a plain implement/fix/ship request routes here even when you
  never say "deliver."
- You ask to brainstorm, design, spec, or debug a piece of software work — including when that
  intent shows up mid-conversation ("update the plan," weighing two approaches, talking through
  requirements) rather than in the opening message. These route through deliver to the matching
  Compound Engineering stage and stop at that stage's artifact; they don't fall through to
  implementation.
- You have an existing PR you want watched, driven to merge, or fixed.
- You want a risky refactor or a long-running implementation carried through to a merged,
  verified result.
- You explicitly ask for this skill by name — naming it doesn't change the routing, it still
  goes through the same child skills below.

Use [orchestrate.md](./orchestrate.md) instead when the outcome needs more than one
independently resumable piece of work, or when the work belongs on a different machine. Deliver
owns one lane; orchestrate owns the graph of lanes. A worker inside an orchestrate lane can
still use deliver for its own single lane.

## How it works

### Model routing runs before anything else

Before any work-starting action, deliver calls `railyard:model-routing` with exact contract
`railyard/model-routing/v1` — see [model-routing.md](./model-routing.md). This runs first, with
no model call, provider probe, or task creation ahead of it. Configured fleet or account
delivery gets handed to `orchestrate` (even when that just fast-paths a single lane back to
deliver); explicit local work or the no-config default stays here.

Every subagent this skill dispatches — implementation workers, researchers, reviewers — names an
explicit model and effort. That's not a style preference: an omitted model field silently
inherits the session's own tier, which on a premium session means routine work burns premium
spend. A Claude Code `PreToolUse` hook refuses any subagent dispatch that skips the model field
(see [model-routing.md](./model-routing.md#the-pretooluse-gate)).

### Picking the route

Deliver resolves the requested artifact and its stop point before invoking anything else. An
explicit narrower outcome always wins over "just implement it":

| Situation | Route | Stops at |
| --- | --- | --- |
| Brainstorm only | `compound-engineering:ce-brainstorm` | framing artifact |
| Plan only | `compound-engineering:ce-plan` | plan artifact |
| Diagnosis only | `compound-engineering:ce-debug` | findings |
| Diagnose and fix | `ce-debug`, then LFG | merge + post-merge proof |
| Generic implement, fix, or ship | `compound-engineering:lfg` | merge + post-merge proof |
| Explicit local-only implementation | `ce-plan` + `ce-work mode:return-to-caller` | requested local checks |
| Explicit Thermos after each chunk | chunked hardening route (below) | merge + post-merge proof |
| Existing PR — review or watch only | CE review route or `ce-babysit-pr` | requested artifact |
| Existing PR — fix, drive, or deliver | CE review route or `ce-babysit-pr`, then the delivery tail | merge + post-merge proof |
| One-shot review cleanup | `compound-engineering:ce-resolve-pr-feedback` | resolved feedback |
| One-shot CI or code failure | `compound-engineering:ce-debug` | diagnosis/fix |
| Explicit tiny local edit | direct edit + targeted check | check green |
| Solved issue with a reusable lesson | `ce-compound mode:headless depth:full` | captured learning |

"Plan and implement" counts as implementation delivery — LFG owns its own plan stage and is
never wrapped in a second top-level plan/work route. Picking an implementation route authorizes
the ordinary repository merge once required checks and reviews pass; any explicit approval
requirement, merge restriction, or protected-branch policy still wins over that default.

The boundary is re-evaluated on every later instruction: if you later say "just get it to a
local checkpoint," that halts shipping even mid-route; a later "okay, ship it" instruction
reopens shipping unless something with higher priority still blocks it.

### Route A: standard delivery

For ordinary feature and bug-fix work, deliver invokes `compound-engineering:lfg` directly with
the feature brief — the workflow engine that actually plans, implements, simplifies, reviews,
browser-tests, and opens the PR. Deliver doesn't wrap LFG in anything, doesn't reorder its
internal stages, and doesn't start a second, duplicate PR-watcher alongside it. Compound
Engineering itself (`EveryInc/compound-engineering-plugin`) is a required external dependency
here — deliver drives it but never modifies it; its internals aren't documented on this page.

### Route B: chunked hardening

Only when you explicitly ask for a Thermos review after every chunk. Instead of one LFG pass,
deliver tracks an explicit multi-stage workflow: plan first with `ce-plan`, then implement one
vertical chunk at a time, running the smallest relevant checks, React Doctor when the chunk
touches UI, and a full [Thermos](./thermos.md) gate after each non-trivial chunk — fixing every
real finding before moving on. Before final review it runs `ce-simplify-code`, then
`ce-code-review`, then `ce-test-browser` if UI behavior changed, then the same
commit/PR/babysit/merge tail as Route A. This loop exists to force local review before a branch
accumulates enough mistakes that CI and GitHub review become the first real QA pass.

### The delivery tail: what "done" actually means

This is the part deliver owns that LFG doesn't. When LFG (or the chunked route) returns, deliver
doesn't just report "merge ready" — it runs the tail:

1. Consumes any bounded follow-up watch that LFG hands back, and keeps going until review, CI,
   branch currency, and stack state are all settled — without waiting for a new request from
   you.
2. Confirms the review evidence includes an independent Sol High or Sol Max pass. If that's
   missing, it runs that read-only review before merge, fixes anything actionable with the
   selected implementation model, and reruns the affected checks.
3. Once no explicit hold remains, it merges with the repository's configured strategy (`gh pr
   merge <pr> --squash|--merge|--rebase`). For a stacked set of PRs, it uses `gh-stack` and
   merges in dependency order.
4. It proves the merge actually landed: `gh pr view <pr> --json state,mergedAt,mergeCommit`,
   fetches the base branch, confirms `git merge-base --is-ancestor <merge-commit>
   origin/<base>`, then runs the smallest applicable post-merge check — and reports those
   artifacts, not just a claim.

A pushed checkpoint, a review-ready branch, an open PR, green CI, a merged change, and
post-merge proof are five different states. Deliver treats them as five different states too —
an explicit stop from you or the repository can still end the route at any earlier one.

### The Thermos gate

For every Thermos gate — whether inside Route A's review step or Route B's per-chunk hardening —
deliver invokes the sibling skills directly: [thermos.md](./thermos.md) for orchestration and
synthesis, plus its two review lenses. Both review passes run in parallel against the same
scoped diff, get synthesized and deduplicated, and every real finding gets fixed before the
chunk is committed; any non-fix is recorded with its evidence. Thermos answers "would review
have caught this?" before commit — it doesn't replace tests, React Doctor, CE review, or CI.

### The React gate

If a chunk touches React, Next UI, JSX/TSX, component packages, styling recipes, client/server
boundaries, or any browser-visible behavior, deliver runs React Doctor from the project root
before committing that chunk:

```bash
npx react-doctor@latest --staged --no-score
```

Use `--staged` after staging the chunk, `--diff` for an unstaged branch/local scan, and `--json`
for machine-readable output. Deliver doesn't invent a project script for this, assume a local
install, or add it as a dependency without you asking — real findings get fixed before commit,
and it runs again before PR on UI-heavy branches. Backend-only, schema-only, script-only, and
docs-only diffs skip this gate entirely.

### macOS/iOS app work

When a change targets a macOS or iOS app and needs Xcode builds, simulator tests, or XCUITests,
deliver prefers the `tart-xcode-runner` plugin — disposable Tart VMs, so UI tests never seize
your screen and every run starts from a clean image. If it isn't installed, deliver suggests it
once (`claude plugin install tart-xcode-runner@novotnyllc` plus the `tart` CLI) and falls back
to host-local tooling if you decline. It never installs anything silently.

### PR feedback and monitoring

`ce-babysit-pr` is deliver's watch loop for an existing open PR — it owns watching and delegates
feedback fixes to `ce-resolve-pr-feedback` and CI fixes to `ce-debug`, rather than deliver
pre-running those stages itself. Babysitting alone never authorizes a merge; deliver owns the
merge and post-merge tail once the PR settles into a mergeable state. On an LFG route, deliver
never invokes `ce-babysit-pr` separately — LFG already owns that invocation internally.

### GitHub checkpoints and stacks

When a writable GitHub remote exists, deliver pushes active-lane or integration branches at
useful checkpoints — so another agent or machine can resume — without opening a PR or implying
the work is done. It runs a lightweight checkpoint monitor alongside LFG that pushes a clean,
stable commit when the canonical branch advances, and stops that monitor once LFG reaches
commit/push/PR. For dependent, stacked delivery against a GitHub upstream, it uses `gh-stack`,
installing it first if missing.

### When ce-compound runs

Deliver invokes `compound-engineering:ce-compound mode:headless depth:full` after the work,
before the final summary, whenever a review or CI failure surfaced a real reusable mistake, a
new repo pattern or vocabulary got established, a provider/migration/auth/data/deployment edge
case got solved, or recurring churn got clarified. It skips this for typo fixes, one-liners, and
mechanical docs edits.

### First-pass quality rules

Deliver stops and fixes before opening a PR whenever any of these are true: tests are all mocked
around a cross-layer behavior; a status, provider intent, email, import, or migration can
partially write and then fail without an idempotent retry story; the diff adds a new helper
while an existing one already does the job; it adds config, UI, a worker, a queue, or an
abstraction the current behavior doesn't actually need; a public or API contract changed without
a boundary test; the plan or PR can't name its exact verification surface; a React/Next UI diff
skipped the React gate; or risky work skipped its final Thermos gate (or a chunk-hardened route
skipped a chunk gate).

## Boundaries

- Deliver owns one host-local implementation or PR lane, start to its requested terminal state.
  If the outcome needs multiple independently resumable scopes, multiple PRs, or work on another
  host, that's [orchestrate.md](./orchestrate.md) — deliver doesn't duplicate decomposition,
  host allocation, or cross-lane dependency tracking.
- It never archives tasks or mutates agent runtime when returning locally verified,
  review-ready, PR-ready, blocked, or owner-action-required work — the work stays visible and
  resumable. A harness "stopped" or "idle" signal is never treated as cleanup or completion
  authority.
- Compound Engineering is a required external dependency, never modified. PR monitoring needs
  `ce-babysit-pr` at CE v3.20.0 or newer; if CE is missing or too old, deliver offers to install
  or update it rather than hand-rolling a watcher.
- If blocked, deliver stops with the exact failing gate, the evidence, and the next decision
  that needs a human — and leaves the work resumable rather than half-finished and silent.

## Example session

**Prompt:** "Fix the flaky retry test in the billing service and get it merged."

**What happens:** Deliver classifies this as a generic implement/fix — Route A. It runs model
routing first, gets back the implementation model/effort for this harness, and invokes
`compound-engineering:lfg` with the feature brief. LFG plans, implements the fix, runs
`ce-simplify-code`, invokes the Thermos gate (both review lenses run in parallel against the
diff, findings get fixed), runs React Doctor if the fix touches any UI, then commits, pushes,
and opens a PR. When LFG returns, deliver runs the delivery tail: confirms an independent Sol
High/Max review pass exists, waits out CI and any remaining review feedback via `ce-babysit-pr`,
merges once nothing is holding it, and then proves the merge with `gh pr view` and a `git
merge-base --is-ancestor` check plus the smallest applicable post-merge test run. The final
report includes the merge commit, the post-merge proof, and — if the fix revealed a reusable
pattern — a `ce-compound` learning capture.

