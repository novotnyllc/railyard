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
