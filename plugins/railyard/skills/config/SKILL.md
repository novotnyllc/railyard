---
name: config
description: "Show or change a repository's Railyard settings: turn Railyard off or on for a repository and its worktrees, set the pre-push review level (full, light, checks). Use when the user asks to disable, quiet, lighten, or configure Railyard for a repository; not for installation (use setup)."
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

- **off**. A one-line notice replaces the publishing guide for this
  repository and its worktrees. Copies, moves, and submodules use their own
  settings.
- **review**. `light` is the default. Run repository checks before each push.
  Use one independent whole-change review for initial publication, and focus
  routine feedback repairs on the changes and affected behavior. Repeat the
  whole-change review when design or risk changes materially or the previous
  local review baseline is uncertain. `full` adds Thermos, Codex review, and
  evidence accounting for each candidate. `checks` runs repository checks only.
  See the [review policy](../../references/whole-candidate-review.md).

New sessions pick up these settings. Set a personal default with
`git config --global railyard.review <level>`. A repository value wins.
