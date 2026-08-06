# Skill authoring

- Keep skills usable by both Codex and Claude Code unless a skill explicitly
  documents an agent-specific branch; the harness-surface tables in
  `orchestrate` and `deliver` are the pattern.
- Skill names and descriptions stay functional, not themed. A cold reader
  must be able to pick the right skill from its description alone.
- Preserve upstream attribution when copying or refreshing skills; the
  thermos-family names track their upstream source and are not renamed.
- Validate JSON manifests and skill frontmatter before committing.
