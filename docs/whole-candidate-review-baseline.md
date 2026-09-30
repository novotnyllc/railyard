# Whole-candidate review baseline

PR18 in `clairernovotny/dotfiles` provides an observed baseline on September 29,
2026: six unique actionable findings escaped local review and were identified
by the external Codex reviewer. This is one migration PR, not an estimated
fleet-wide escape rate. The following comment IDs identify the source evidence:

| Finding | Source comment |
| --- | --- |
| Tilde-based OpenCodex/Codex home paths | https://github.com/clairernovotny/dotfiles/pull/18#discussion_r4138976317 |
| Valid agents-table TOML spellings | https://github.com/clairernovotny/dotfiles/pull/18#discussion_r4139039498 |
| Quoted root review_model keys | https://github.com/clairernovotny/dotfiles/pull/18#discussion_r4139066047 |
| Duplicate unrelated disabled-model entries | https://github.com/clairernovotny/dotfiles/pull/18#discussion_r4139066053 |
| Skipped catalog sync reported on stderr | https://github.com/clairernovotny/dotfiles/pull/18#discussion_r4139276692 |
| Portable writes before Sol prerequisite checks | https://github.com/clairernovotny/dotfiles/pull/18#discussion_r4139276698 |

Initial review findings, local catches, successful push count, external revision
round count, and final settlement elapsed are unknown in this bounded baseline.
The six comments do not establish six revision rounds. Do not convert missing
values into zeros or assert a 98% improvement.

For subsequent deliveries, use the compact ledger in
[the shipped review gate](../plugins/railyard/references/whole-candidate-review.md).
Record receipts, unique local catches, escaped actionable findings, successful
pushes, external revision rounds, and settlement timestamps. Evaluate fewer
external revision rounds only after comparable completed deliveries supply
those measurements; this instruction change alone proves no outcome improvement.
