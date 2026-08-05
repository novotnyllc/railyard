# Upstream Sources

`upstreams.json` is the authoritative machine-readable source ledger. This
document records human-readable provenance and adaptation notes for skills
adapted from upstream repositories.

The agent-scripts imports were most recently reviewed against:

- Repository: `https://github.com/steipete/agent-scripts`
- Commit: `c46ea65b6323e8a2b6f441f8b6449ae731bc8f81`
- License: MIT

The `oracle` skill was refreshed from:

- Repository: `https://github.com/steipete/oracle`
- Commit: `0f0bdb6a752efb2c736ec4dcaa6d3cc29743d851`
- Path: `skills/oracle`

## Copied Skills

| Local skill | Upstream path |
| --- | --- |
| `oracle` | `skills/oracle` |
| `thermos` | `thermos/skills/thermos` |
| `thermo-nuclear-review` | `thermos/skills/thermo-nuclear-review` |
| `thermo-nuclear-code-quality-review` | `thermos/skills/thermo-nuclear-code-quality-review` |

The thermos-family skill names track their upstream source and are not
renamed. Preserve attribution when refreshing; do not overwrite local
adaptations blindly.

## Adaptation Notes

- Replaced fixed Oracle package/repo/account examples with `ORACLE_*`
  configuration knobs.
- Added Oracle's portable, skill-local lifecycle bootstrap: resolve the active
  installed skill directory, run `scripts/ensure-oracle.sh` once, and invoke
  only its returned absolute Oracle 0.17.0-or-newer path. It prefers
  `steipete/tap/oracle`, has a bounded `$HOME/.local` npm fallback, treats an
  explicit `ORACLE_BIN` as validation-only, and preserves user-owned Oracle
  configuration, authentication, sessions, and browser state.
- Added local Oracle browser-profile guidance: honor nested
  `browser.manualLogin`, never combine it with `--copy-profile`, and leave any
  profile-mode or authentication change to the user.
- Thermos and its two reviewer rubrics are tracked from Cursor's
  `cursor/plugins` at `fa16d695b35ccf4ea179d976e5aaee0834a25b0b`. Their local
  wrappers retain provider/model-routing-safe dispatch, package for both
  harnesses, and preserve deterministic frozen review-packet and
  coverage-portfolio behavior. Cursor's `disable-model-invocation: true`
  frontmatter is deliberately handled by those wrappers rather than copied as
  an unconditional local restriction. Refresh review presents these expected
  adaptations and never raw-copies over them.
