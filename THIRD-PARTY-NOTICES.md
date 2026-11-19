# Third-party notices

railyard incorporates the material below. This file is the licensing record;
the [public credits page](https://novotnyllc.github.io/railyard/credits/) is the
human-facing credit page, and [`upstreams.json`](upstreams.json) is the
machine-readable pin ledger.

Only *incorporated* material is listed — code or text copied or adapted into
this repository. Projects railyard merely depends on or was inspired by
(Compound Engineering, ponytail, gh-stack, the Claude Code and Codex harnesses)
carry no license obligation here and are credited on the credits page instead.

Every incorporation below is MIT-licensed. Their copyright notices are
preserved in [`LICENSE`](LICENSE) alongside our own.

## Thermos review family

- **What:** `plugins/railyard/skills/thermos/SKILL.md`,
  `plugins/railyard/skills/thermo-nuclear-review/SKILL.md`, and
  `plugins/railyard/skills/thermo-nuclear-code-quality-review/SKILL.md`.
  The latter two are near-verbatim copies.
- **From:** https://github.com/cursor/plugins, paths `thermos/skills/<name>`,
  commit `fa16d695b35ccf4ea179d976e5aaee0834a25b0b`.
- **Copyright:** Copyright (c) 2026 Cursor.
- **License:** MIT (`thermos/LICENSE` upstream) — text in
  [`LICENSE`](LICENSE).
- **Modifications:** upstream's `disable-model-invocation: true` frontmatter
  is handled by our wrappers rather than copied; `thermos/SKILL.md` is
  substantially rewritten for two-harness packaging and native subagent
  dispatch. See [`UPSTREAM.md`](UPSTREAM.md).

Oracle previously shipped here and now lives in
[Agent Utilities](https://github.com/novotnyllc/agent-utilities), where its upstream attribution is maintained.

Corrections welcome — an incomplete or wrong notice here is a bug.
[File it](https://github.com/novotnyllc/railyard/issues).
