---
name: thermo-nuclear-code-quality-review
description: Deep maintainability review for abstraction quality, module cohesion, and branching complexity. Use for an explicit thermo-nuclear code quality review, deep code quality audit, or a selected maintainability review of concrete structural risks.
---

# Thermo-Nuclear Code Quality Review

Use this skill for a requested deep maintainability review or a selected lens
on concrete structural risks. Keep the branch or concern scope provided by
the caller. Review only unless the task also authorizes implementation; this
skill does not make a broad refactor a prerequisite for an ordinary fix.

Look for structural simplifications, including "code judo" moves that remove
unnecessary concepts while preserving behavior. Evaluate the actual benefit,
migration cost, and risk of each suggestion. A possible alternative design is
not itself a defect; distinguish a material regression from optional improvement.

## Core Prompt

Start from this baseline:

> Perform a deep code quality audit of the current branch's changes.
> Examine abstractions, modularity, branching, and legibility in the changed paths.
> Identify concrete maintainability consequences and proportionate remedies that preserve behavior.
> Consider a broader restructuring when its benefit is clear, and label it as an optional follow-up unless the change requires it or the user requested that scope.
> Support findings with evidence from the code and its callers.

## Review Standards

Apply the baseline prompt above, plus these explicit review rules:

0. **Look for concrete structural simplification.**
   - Explain what complexity would disappear and why that matters.
   - Look for opportunities to reframe the change so that whole branches, helpers, modes, conditionals, or layers disappear entirely.
   - Prefer a simpler use of the existing architecture when it reduces the total concepts and indirection.
   - Do not assume a restructuring is necessary; compare the proposed design with the current implementation and the cost of changing it.

1. **Use file growth as a signal to inspect cohesion.**
   - Crossing 1000 lines can prompt a closer look, but line count alone is not a finding or an approval gate unless repository policy explicitly makes it one.
   - Identify mixed responsibilities, coupling, or navigation problems caused by the change before suggesting decomposition.
   - Extract helpers, subcomponents, or modules when that improves cohesion; keep a well-organized cohesive file together when splitting it would add indirection.

2. **Do not allow random spaghetti growth in existing code.**
   - Be highly suspicious of new ad-hoc conditionals, scattered special cases, or one-off branches inserted into unrelated flows.
   - If a change adds "weird if statements in random places", treat that as a design problem, not a stylistic nit.
   - Compare a direct branch with a dedicated abstraction, helper, state machine, policy object, or separate module; prefer the option with less total complexity.
   - Show how the change makes a specific invariant or caller harder to reason about, even if the current behavior works.

3. **Assess maintainability as well as current behavior.**
   - Recommend a cleaner structure when the benefit justifies the change and its risk.
   - Identify material regressions even when tests pass; label unrelated cleanup or a plausible alternative as optional.
   - Strongly prefer simplifications that remove moving pieces altogether over refactors that merely spread the same complexity around.

4. **Prefer direct, boring, maintainable code over hacky or magical code.**
   - Treat brittle, ad-hoc, or "magic" behavior as a code-quality problem.
   - Be skeptical of generic mechanisms that hide simple data-shape assumptions.
   - Flag thin abstractions, identity wrappers, or pass-through helpers that add indirection without buying clarity.

5. **Push hard on type and boundary cleanliness when they affect maintainability.**
   - Question unnecessary optionality, `unknown`, `any`, or cast-heavy code when a clearer type boundary could exist.
   - Prefer explicit typed models or shared contracts over loosely-shaped ad-hoc objects.
   - If a branch relies on silent fallback to paper over an unclear invariant, ask whether the boundary should be made explicit instead.

6. **Keep logic in the canonical layer and reuse existing helpers.**
   - Call out feature logic leaking into shared paths or implementation details leaking through APIs.
   - Prefer existing canonical utilities/helpers over bespoke one-offs.
   - Push code toward the right package, service, or module instead of normalizing architectural drift.

7. **Treat unnecessary sequential orchestration and non-atomic updates as design smells when the cleaner structure is obvious.**
   - If independent work is serialized for no good reason, ask whether the flow should run in parallel instead.
   - If related updates can leave state half-applied, push for a more atomic structure.
   - Do not over-index on micro-optimizations, but do flag avoidable orchestration complexity that makes the implementation more brittle.

## Primary Review Questions

For every meaningful change, ask:

- Is there a "code judo" move that would make this dramatically simpler?
- Can this change be reframed so fewer concepts, branches, or helper layers are needed?
- Does this improve or worsen the local architecture?
- Did the diff add branching complexity where a better abstraction should exist?
- Did a previously cohesive module become more coupled, more stateful, or harder to scan?
- Is this logic living in the right file and layer?
- Did this change enlarge a file or component past a healthy size boundary?
- Are there repeated conditionals that signal a missing model or missing helper?
- Is the implementation direct and legible, or does it rely on special cases and incidental control flow?
- Is this abstraction actually earning its keep, or is it just a wrapper?
- Did the diff introduce casts, optionality, or ad-hoc object shapes that obscure the real invariant?
- Is this logic living in the canonical layer, or did the diff leak details across a boundary?
- Is this orchestration more sequential or less atomic than it needs to be?

## What to Investigate

Use these signals to investigate. Escalate based on concrete impact, not the
presence of a pattern alone:

- A complicated implementation where a cleaner reframing could delete whole categories of complexity.
- Refactors that move code around but fail to reduce the number of concepts a reader must hold in their head.
- File growth that mixes responsibilities or makes changed invariants difficult to locate.
- New conditionals bolted onto unrelated code paths.
- One-off booleans, nullable modes, or flags that complicate existing control flow.
- Feature-specific logic leaking into general-purpose modules.
- Generic "magic" handling that hides simple structure and makes the code harder to reason about.
- Thin wrappers or identity abstractions that add indirection without simplifying anything.
- Unnecessary casts, `any`, `unknown`, or optional params that muddy the real contract.
- Copy-pasted logic instead of extracted helpers.
- Narrow edge-case handling implemented in the middle of an already busy function.
- Refactors that technically pass tests but make the code less modular or less readable.
- "Temporary" branching that is likely to become permanent debt.
- Bespoke helpers where the codebase already has a canonical utility for the job.
- Logic added in the wrong layer/package when it should live somewhere more central.
- Sequential async flow where obviously independent work could stay simpler and clearer with parallel execution.
- Partial-update logic that leaves state less atomic than necessary.

## Preferred Remedies

When you identify a code-quality problem, prefer suggestions like:

- Delete a whole layer of indirection rather than polishing it.
- Reframe the state model so conditionals disappear instead of getting centralized.
- Change the ownership boundary so the feature becomes a natural extension of an existing abstraction.
- Turn special-case logic into a simpler default flow with fewer exceptions.
- Extract a helper or pure function.
- Split a large file into smaller focused modules.
- Move feature-specific logic behind a dedicated abstraction.
- Replace condition chains with a typed model or explicit dispatcher.
- Separate orchestration from business logic.
- Collapse duplicate branches into a single clearer flow.
- Delete wrappers that do not meaningfully clarify the API.
- Reuse the existing canonical helper instead of introducing a near-duplicate.
- Make type boundaries more explicit so the control flow gets simpler.
- Move the logic to the package/module/layer that already owns the concept.
- Parallelize independent work when that also simplifies the orchestration.
- Restructure related updates into a more atomic flow when partial state would be harder to reason about.

When the issue is structural, explain it directly and suggest a remedy that
addresses it. Prefer the smallest change that resolves the demonstrated
problem; keep broader simplifications separate when they are optional.

## Review Tone

Be direct, serious, and demanding about quality.
Do not be rude, but do not soften major maintainability issues into mild suggestions.
If the code is making the codebase messier, say so clearly.
If a broader simplification would help, state its benefit and whether it is
required for this change or an optional follow-up.

Good phrases:

- `this adds a second responsibility to the module, so callers now need to understand both lifecycles. can we separate their ownership?`
- `this new branch duplicates the cancellation rule in three paths; keeping one owner would prevent the paths from diverging.`
- `this feels like feature logic leaking into a shared path. can we isolate it?`
- `this abstraction seems unnecessary. can we just keep the direct flow?`
- `why does this need a cast / optional here? can we make the boundary more explicit instead?`
- `this looks like a bespoke helper for something we already have elsewhere. can we reuse the canonical one?`
- `optional: the existing state model could replace these branches; that may be useful in a follow-up if the migration cost is justified.`
- `this refactor moves complexity around, but doesn't really delete it. is there a way to make the model itself simpler?`

## Output Expectations

Prioritize findings by their demonstrated impact. The main categories are:

1. Structural code-quality regressions
2. Branching complexity and boundary / abstraction / type-contract problems
3. Cohesion, modularity, legibility, and maintainability concerns

For each finding, identify the changed code, consequence, supporting evidence,
and proportionate remedy. Put optional simplifications in a separate short list
only when they add value. A review with no material findings is a valid result.

Do not flood the review with low-value nits if there are larger structural issues.
Prefer a smaller number of high-conviction comments over a long list of cosmetic notes.

## Approval Bar

Blocking feedback needs a material maintainability regression, a concrete
correctness or safety consequence, or an explicit repository requirement.
Examples include duplicated policy that can diverge, ownership leaks that
break module contracts, or partial updates that violate an invariant. Explain
the affected path and why the remedy is needed before this change ships.

File size, an alternative abstraction, or a possible broad simplification alone
does not block approval. An explicit architecture audit can explore those
options in depth without converting every suggestion into a required refactor.
Return findings to the existing review owner; CE owns PR review settlement and
CI monitoring, so this lens does not start another settlement or watch loop.
