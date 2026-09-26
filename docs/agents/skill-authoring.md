# Skill authoring

- Keep skills usable by both Codex and Claude Code unless a skill explicitly
  documents an agent-specific branch; the harness-surface tables in
  `orchestrate` and `agent-coordination.md` are the pattern.
- Skill names and descriptions stay functional, not themed. A cold reader
  must be able to pick the right skill from its description alone, and the
  description should not trigger on unrelated requests.
- Write for current models: a clear goal and constraints, each rule stated
  once, no ALL-CAPS or "never/always" pileups, no motivational or threatening
  framing, and no rules against rituals the model would not invent. State
  model/effort guidance only in `skills/model-routing/SKILL.md` and
  `references/harness-model-invocation.md`; other files point there.
- Shipped skills and references carry runtime instructions only. Maintainer
  notes, provenance, and dated verification snapshots live under `docs/`.
- Preserve upstream attribution when copying or refreshing skills; the
  thermos-family names track their upstream source and are not renamed.
- Validate JSON manifests and skill frontmatter before committing.
  `skills/orchestrate/scripts/delivery-contracts.test.mjs` checks frontmatter,
  relative links, retired-contract references, word budgets, and the
  load-bearing delivery policy.
