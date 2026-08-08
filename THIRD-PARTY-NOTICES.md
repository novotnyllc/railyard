# Third-party notices

railyard incorporates the material below. This file is the licensing record;
[`docs/site/credits.md`](docs/site/credits.md) is the human-facing credit
page, and [`upstreams.json`](upstreams.json) is the machine-readable pin
ledger.

Only *incorporated* material is listed — code or text copied or adapted into
this repository. Projects railyard merely depends on or was inspired by
(Compound Engineering, ponytail, gh-stack, the Claude Code and Codex harnesses)
carry no license obligation here and are credited on the credits page instead.

Every incorporation below is MIT-licensed. Their copyright notices are
preserved in [`LICENSE`](LICENSE) alongside our own.

## Oracle

- **What:** `plugins/railyard/skills/oracle/SKILL.md`, adapted.
- **From:** https://github.com/steipete/oracle, path `skills/oracle`,
  commit `0f0bdb6a752efb2c736ec4dcaa6d3cc29743d851`.
- **Copyright:** Copyright (c) 2026 Peter Steinberger.
- **License:** MIT — text in [`LICENSE`](LICENSE).
- **Modifications:** configuration knobs replacing fixed package/repo/account
  examples, and a portable skill-local lifecycle bootstrap. See
  [`UPSTREAM.md`](UPSTREAM.md).

Surrounding scripting in `plugins/railyard/skills/oracle/scripts/` is our own
work, reviewed against https://github.com/steipete/agent-scripts at commit
`c46ea65b6323e8a2b6f441f8b6449ae731bc8f81` (MIT, Copyright (c) 2026 Peter
Steinberger).

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
  substantially rewritten for two-harness packaging and model-routing-safe
  dispatch. See [`UPSTREAM.md`](UPSTREAM.md).

Corrections welcome — an incomplete or wrong notice here is a bug.
[File it](https://github.com/novotnyllc/railyard/issues).
