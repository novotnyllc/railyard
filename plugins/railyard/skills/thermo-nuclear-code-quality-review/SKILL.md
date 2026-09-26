---
name: thermo-nuclear-code-quality-review
description: Deep maintainability review for abstraction quality, module cohesion, and branching complexity. Use for an explicit thermo-nuclear code quality review, deep code quality audit, or a selected maintainability review of concrete structural risks.
---

# Thermo-Nuclear Code Quality Review

A deep maintainability audit of the current branch's changes, or a selected
lens on concrete structural risks. Keep the scope the caller provides. Review
only, unless the task also authorizes implementation; a broad refactor is
never a prerequisite for an ordinary fix.

Examine abstractions, modularity, branching, and legibility in the changed
paths and their callers. Look especially for "code judo": a reframing that
makes whole branches, helpers, modes, or layers disappear while preserving
behavior. Weigh each suggestion's benefit against its migration cost and risk;
a plausible alternative design is not itself a defect.

## Standards

Each standard names what to look for and the remedy to prefer. Escalate on
concrete impact, not on the presence of a pattern.

1. **Structural simplification.** Could the change be reframed so fewer
   concepts, branches, or layers are needed? Watch for refactors that move
   complexity around without reducing what a reader must hold in mind.
   Prefer deleting a layer of indirection over polishing it, and reframing the
   state model so conditionals disappear rather than get centralized. Explain
   what complexity would disappear and why it matters.
2. **Branching discipline.** New ad-hoc conditionals, scattered special cases,
   one-off booleans or nullable modes, "temporary" branches, and edge-case
   handling wedged into a busy function are design problems, not style nits.
   Show which invariant or caller becomes harder to reason about. Compare a
   direct branch with a typed model, dispatcher, state machine, or dedicated
   module, and prefer whichever leaves less total complexity; often it is a
   simpler default flow with fewer exceptions.
3. **Cohesion and file growth.** Growth past about 1000 lines is a prompt to
   look, not a finding or gate unless repository policy says so. Identify
   mixed responsibilities, new coupling or state, or invariants that became
   hard to locate before suggesting a split; keep a cohesive file together when
   splitting would only add indirection.
4. **Direct over magical.** Flag brittle or "magic" behavior, generic
   mechanisms hiding simple data-shape assumptions, and thin wrappers,
   identity abstractions, or pass-through helpers that add indirection without
   clarity. Prefer the direct flow.
5. **Types and boundaries.** Question unnecessary optionality, `unknown`,
   `any`, casts, and loosely shaped objects when a clearer typed model or
   shared contract could exist. A silent fallback papering over an unclear
   invariant suggests the boundary should be explicit.
6. **Canonical layer and reuse.** Call out feature logic leaking into shared
   paths, implementation details leaking through APIs, copy-pasted logic, and
   bespoke helpers duplicating an existing canonical utility. Move logic to the
   package or layer that already owns the concept.
7. **Orchestration and atomicity.** When the cleaner structure is obvious,
   flag independent work serialized for no reason and related updates that
   can leave state half-applied. Separate orchestration from business logic;
   skip micro-optimizations.

## Tone

Be direct and serious about quality without being rude. Say plainly when a
change makes the codebase messier, and do not soften a major maintainability
issue into a mild suggestion. For example:

- `this adds a second responsibility to the module, so callers now need to understand both lifecycles. can we separate their ownership?`
- `this new branch duplicates the cancellation rule in three paths; keeping one owner would prevent them from diverging.`
- `optional: the existing state model could replace these branches; worth a follow-up if the migration cost is justified.`

## Output

Prioritize findings by demonstrated impact:

1. Structural code-quality regressions
2. Branching complexity and boundary, abstraction, or type-contract problems
3. Cohesion, modularity, and legibility concerns

For each finding, give the changed code, the consequence, supporting evidence,
and the smallest remedy that resolves it. List optional simplifications
separately and briefly, only when they add value. Prefer a few high-conviction
comments over many cosmetic ones; a review with no material findings is a
valid result.

## Approval bar

Block only for a material maintainability regression, a concrete correctness
or safety consequence, or an explicit repository requirement, such as
duplicated policy that can diverge, an ownership leak that breaks a module
contract, or a partial update that violates an invariant. Explain the affected
path and why the remedy is needed before shipping. File size, an alternative
abstraction, or a possible broad simplification alone does not block.

Return findings to the existing review owner. CE owns PR review settlement and
CI monitoring; this lens starts no settlement or watch loop of its own.
