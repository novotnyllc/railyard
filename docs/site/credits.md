<!-- cross-repo links use site-absolute paths, resolved at site build -->

# Credits and upstream sources

railyard stands on work we either ship directly (adapted, with attribution
preserved) or depend on at runtime. This page names that work plainly —
these projects earned it. The machine-readable ledger lives at
[`upstreams.json`](https://github.com/novotnyllc/railyard/blob/main/upstreams.json),
with adaptation notes in
[`UPSTREAM.md`](https://github.com/novotnyllc/railyard/blob/main/UPSTREAM.md).

## Shipped and adapted (with attribution)

**Oracle** — the [oracle](skills/oracle.md) skill is adapted from
[Peter Steinberger](https://steipete.me/)'s
[steipete/oracle](https://github.com/steipete/oracle) (MIT). Peter's oracle
is the pattern this skill exists to carry: a second, independent frontier
model consulted through its own surface. Our adaptations are configuration
knobs and a portable lifecycle bootstrap; the idea and the core are his.
Parts of the surrounding scripting were also reviewed against
[steipete/agent-scripts](https://github.com/steipete/agent-scripts) (MIT).

**The Thermos review family** — [thermos](skills/thermos.md) and its two
review lenses (`thermo-nuclear-review`,
`thermo-nuclear-code-quality-review`) are tracked from
[Cursor](https://cursor.com)'s
[cursor/plugins](https://github.com/cursor/plugins) (MIT). The skill names
deliberately keep their upstream identity — the "would review have caught
this?" pre-commit discipline is Cursor's design; our wrappers add
two-harness packaging and model-routing-safe dispatch.

## Direct dependencies

**Compound Engineering** — [deliver](skills/deliver.md) drives
[Every](https://every.to)'s
[compound-engineering plugin](https://github.com/EveryInc/compound-engineering-plugin)
as its workflow engine: planning, implementation, review, PR babysitting.
It is a required dependency we never modify — railyard routes work into it
and owns what happens after it returns.

**The harnesses** — railyard is a plugin for
[Claude Code](https://code.claude.com) (Anthropic) and
[Codex](https://openai.com/codex) (OpenAI). Everything here rides on those
two CLIs and their plugin, hook, and subagent surfaces.

**gh-stack** — dependent-PR delivery uses
[github/gh-stack](https://github.com/github/gh-stack).

## The sibling

[roundhouse](/roundhouse) keeps the machines ready — see
[its credits page](/roundhouse/credits) for the fleet-side dependencies
(chezmoi, Jujutsu, the package managers, and more).

Corrections welcome: if an attribution here is incomplete or wrong, that is
a bug — [file it](https://github.com/novotnyllc/railyard/issues).
