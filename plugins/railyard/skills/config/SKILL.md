---
name: config
description: "Show or change a repository's Railyard settings: turn Railyard off or on for a repository and its worktrees, set the pre-push review level (full, light, checks), or stop steering toward Compound Engineering stages. Use when the user asks to disable, quiet, lighten, or configure Railyard for a repository."
---

# Railyard Config

Settings live in the repository's git config, so every worktree shares them,
they are never committed, and a clone starts from defaults. Run the script from
inside the repository (or pass `--repo <dir>`); it prints the effective settings
after every change. Resolve `SKILL_DIR` to the directory containing this file.

| Request | Command |
| --- | --- |
| Show settings | `node "$SKILL_DIR/scripts/config.mjs"` |
| Turn Railyard off here | `node "$SKILL_DIR/scripts/config.mjs" off` |
| Turn it back on | `node "$SKILL_DIR/scripts/config.mjs" on` |
| Pre-push review level | `node "$SKILL_DIR/scripts/config.mjs" review full\|light\|checks` |
| Stop CE nudges | `node "$SKILL_DIR/scripts/config.mjs" ce off` (`ce on` restores) |

- **off**: the startup guide becomes a one-line notice and every hook stands
  down, including the opt-in default-branch push guard. It covers the
  repository and all its worktrees. A copy or move of the repository comes back
  on; submodules are configured separately.
- **review**: `full` (default) is the whole-candidate review gate with Thermos
  and Codex review. `light` is the repository's checks plus one combined
  correctness and maintainability review. `checks` is the repository's checks
  only.
- **ce off**: Railyard keeps its gates and routing but no longer suggests
  Compound Engineering stages.

New sessions pick up a change at startup; tell the user to start a new session
for it to apply to the guide. `review` and `ce` can also be set as personal
defaults with `git config --global`; a repository's own value wins.
