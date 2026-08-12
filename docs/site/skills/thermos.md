<!-- cross-repo links use site-absolute paths, resolved at site build -->

# Thermos

Thermos runs two independent, parallel review passes against a diff — one hunting for bugs,
breakage, security holes, and feature-flag leaks, the other hunting for structural code-quality
problems — and synthesizes both into one set of findings before you commit. It's the pre-commit
"would review have caught this?" check, standing in the gap between "it compiles" and the review
a human reviewer would actually give the PR.

## When to use it

- You're about to commit a chunk of risky or non-trivial work and want an independent pass
  before it lands.
- You ask for "thermos," "double thermo review," or a "thermonuclear" review.
- [Deliver](./deliver.md) invokes it automatically as part of its Thermos gate, either once
  before commit on the standard route or after every chunk on the chunked hardening route —
  you'll see it run even if you never call it by name.

Thermos is not a substitute for tests, React Doctor, CE code review, or CI — it's an additional,
focused gate that runs alongside them, not instead of them.

## How it works

### Two lenses, one packet

Thermos is the orchestrator; the actual reviewing is done by two sibling skills, each a distinct
lens on the same diff:

- **`railyard:thermo-nuclear-review`** — a comprehensive security and correctness audit. It
  looks only at code being added or modified in the diff (not pre-existing issues elsewhere),
  and is instructed to be extremely thorough about three specific failure classes: functionality
  breakage from subtle cross-module side effects, developer-experience breakage (changed secret
  locations, renamed env vars, remapped ports, new required setup steps), and feature-flag leaks
  — a feature meant to stay gated escaping its gate. It's explicitly told not to over-report:
  misreporting severity erodes trust, so every finding needs end-to-end tracing before it's
  called high-priority. If a PR has a linked discussion, it checks for existing bot findings
  (BugBot, etc.) only *after* finishing its own independent pass, so its first read stays
  unbiased — then folds in anything it missed or corroborates.
- **`railyard:thermo-nuclear-code-quality-review`** — an unusually strict maintainability
  review. It's explicitly told to be ambitious, not just tidy: look for "code judo" moves that
  delete whole categories of complexity rather than just rearranging them. It treats a file
  crossing 1,000 lines because of this PR as a default-blocking smell, flags ad-hoc conditionals
  bolted onto unrelated flows, pushes back on thin wrappers and cast-heavy type boundaries, and
  asks whether logic lives in the right layer or leaked across a boundary. Its approval bar is
  explicit: no structural regression, no missed obvious simplification, no unjustified file-size
  explosion, no spaghetti growth, no unnecessary wrapper/cast churn, no canonical-helper
  duplication.

These two are not separate documentation pages — they're implementation detail of the Thermos
gate, described here because that's where you'll actually encounter them.

Both reviewers get the exact same frozen packet: the objective and stop condition, exact
diff/file digests, relevant source excerpts, a requirement map, the changed runtime-artifact
chain, a simplification receipt where one applies, and any reusable hash-bound validation
receipts already available — so neither reviewer reruns a broad test suite that's already been
run. A runtime artifact missing producer/package/install/consumer proof, or a material
complexity increase missing a simplification receipt, is a mandatory finding for whichever lens
owns it — not an optional nice-to-have.

### Running both in parallel

Thermos checks concern coverage before launching anything — if a matching independent CE or Sol
review already covers a concern with the same input digest, scope, and authority, it reuses that
instead of launching a redundant pass. Otherwise both lenses launch together:

- On Claude Code, both run as two `Agent` tool calls in one message — fresh-context subagents,
  each given the frozen packet plus the full instructions of its sibling skill (there's no
  predefined subagent type for this, so the calling skill reads the sibling `SKILL.md` directly
  and includes it in the dispatch).
- On Codex, two `explorer` subagents spawn in parallel, each with the relevant skill attached
  (or its instructions inlined if structured attachment isn't available); Thermos waits for both
  before synthesizing.

Model routing runs before each reviewer dispatch — see [model-routing.md](./model-routing.md).
When Thermos is invoked standalone it admits its own two reviewer actions; when
[deliver](./deliver.md) invokes it, Thermos consumes the pre-reserved slots deliver already
claimed rather than charging the same edge twice.

If a routed decision calls for a Claude Fable or Opus reviewer, that swaps in only through
Compound Engineering's existing attested read-only Claude `-p` adapter — Thermos never stands up
a separate raw `claude -p` runner to get there. Until that seam is attested for the current
binding, the route is unsupported rather than improvised.

### Fix-before-commit

Once both dispositions are in (or validly reused), Thermos synthesizes: findings get
deduplicated, disagreements between the two lenses get resolved, and a third opinion only gets
added for a genuinely unique unresolved question — this is a concern-coverage exercise, not a
pile-on. Every real finding gets fixed before the chunk is committed; anything not fixed gets
recorded with its evidence rather than silently dropped. If individual reviewer summaries are
already visible to you, Thermos doesn't restate them wholesale — it surfaces the unified
verdict, the highest-signal findings, and whatever uncertainty remains.

## Scope

- Thermos reviews the diff; fixes are implemented by the owning workflow, and merge is decided by
  the workflow that invoked it (typically [deliver](./deliver.md)'s delivery tail).
- Thermos is the pre-commit gate alongside tests, React Doctor, CE code review, and CI; each remains
  an independent gate on its own schedule.
- The correctness lens reports issues in code touched by the diff; unrelated pre-existing code stays
  with its existing owner.
- The code-quality lens targets structural findings with a small number of high-conviction results;
  cosmetic style nits stay with ordinary style review.

## Example session

**Prompt (inside a deliver-driven fix):** a chunk of the retry-queue fix is staged and ready to
commit.

**What happens:** Deliver's Thermos gate calls `railyard:thermos`. Thermos freezes one packet —
the staged diff's digest, the relevant source context, and the requirement it's supposed to
satisfy — and launches both lenses in parallel as two `Agent` calls, each carrying an explicit
model and effort from model routing. The correctness lens traces the retry logic's interaction
with the existing queue consumer and finds a case where a partial write on failure has no
idempotent retry story; it also checks the PR discussion for existing bot comments after
finishing its own pass, finding none. The code-quality lens notices the fix added a second,
near-duplicate retry helper when an existing one already covers the case, and flags it as a
canonical-helper duplication rather than a style nit. Thermos synthesizes both into one findings
list, both get fixed before commit, and the chunk proceeds to the React gate (skipped here — no
UI touched) and then commit.
