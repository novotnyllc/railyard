# Upstream Sources

`upstreams.json` is the authoritative machine-readable source ledger. This
document records human-readable provenance and adaptation notes for skills
adapted from upstream repositories.

## Copied Skills

| Local skill | Upstream path |
| --- | --- |
| `thermos` | `thermos/skills/thermos` |
| `thermo-nuclear-review` | `thermos/skills/thermo-nuclear-review` |
| `thermo-nuclear-code-quality-review` | `thermos/skills/thermo-nuclear-code-quality-review` |

The thermos-family skill names track their upstream source and are not
renamed. Preserve attribution when refreshing; do not overwrite local
adaptations blindly.

## Adaptation Notes

- Thermos and its two reviewer rubrics are tracked from Cursor's
  `cursor/plugins` at `fa16d695b35ccf4ea179d976e5aaee0834a25b0b`. The rubric
  bodies are upstream verbatim, with two local adaptations:
  `thermo-nuclear-review` adds a Failure Memory Guidelines section linking to
  its local `references/failure-memory.md` lens, and both frontmatter
  descriptions are local. Thermos keeps upstream's workflow (gather the diff
  without guessing, give both reviewers the same scoped diff/file context,
  weight overlapping findings more heavily) but replaces Cursor's registered
  `thermo-nuclear-*-subagent` types with native Claude Code `Agent` or Codex
  `explorer` subagents that each receive the sibling rubric in a
  self-contained brief. It also reuses a completed review covering the same
  inputs and concern, asks reviewers to validate an actual delivery/packaging
  risk, supports an opt-in frozen review packet, and leaves review settlement
  and CI to CE. All three package for both harnesses. Cursor's
  `disable-model-invocation: true` is not copied; the descriptions instead
  reserve these skills for explicit or deep-review requests or substantial
  risk, which steers invocation but is not a hard restriction. Refresh review
  presents these expected adaptations and never raw-copies over them.
