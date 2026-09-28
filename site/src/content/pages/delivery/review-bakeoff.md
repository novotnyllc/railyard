---
layout: default
title: Review bakeoff
parent: Delivery
nav_order: 5
---

# Review bakeoff

[Railyard's end-of-PR review](/skills/deliver/) pairs [Thermos](/skills/thermos/) with `codex review`. A small bakeoff on past Railyard and Roundhouse bugs chose that pairing: Thermos caught the most known bugs, and one `codex review` run caught the only bug no other tool found.

## Method

There were five cases, each a past Railyard or Roundhouse commit reviewed as it was before a later fix. Each tool reviewed each case once, and every Claude arm ran on Opus 5.5.

The ground truth has 8 units, one per known bug:

- R1, RH1, and R2 each had one known bug.
- R2 also had a confirmed bonus bug.
- R3 had four known bugs.

A catch with the right mechanism earns the full unit, and a partial catch earns half. The fifth case, C1, was a control meant to have no known bug and does not count toward the 8. It later turned out to contain real merge-gate bypasses, which were scored separately as false-positive checks.

## Results

Ground-truth units caught, out of 8:

| Tool | Units |
| --- | --- |
| Railyard Thermos | 6.5 |
| Cursor upstream Thermos (agent form) | 5 |
| Compound Engineering `ce-code-review` | 4 |
| `codex review` on GPT-6 Sol, medium effort | 2 |
| `codex review` on GPT-6 Astra, high effort | 2 (different ones, including the one bug nothing else caught) |
| Codex Security `$security-diff-scan` | 1 |
| Semgrep | 0 |

The bug only the Astra-high `codex review` run caught was R3's relaunch accepted on incomplete evidence.

Approximate cost per case:

| Tool | Tokens | Wall time |
| --- | --- | --- |
| Railyard Thermos | 0.5–0.9M | 3–11 min |
| Cursor upstream Thermos | 0.4–0.6M | — |
| Compound Engineering `ce-code-review` | 1.2–2M | 12–22 min |
| `codex review` | — | 1–7 min |
| Codex Security `$security-diff-scan` | 68k–159k | 2.5–8 min |
| Semgrep | — | seconds |

## Why Thermos won

- Reviewers proved their findings with probes.
- It uses a few broad lenses, each with whole-file context.
- Its synthesis keeps and weights overlapping findings rather than discarding unconfirmed ones. By contrast, Compound Engineering's own Codex cross-model pass flagged the R1 bug and one R3 bug, but its validation and synthesis step demoted both to "residual".
- The failure-memory lens targets fail-open checks, the dominant bug shape.

## Caveats

The sample is small, each tool ran once per case, and one grader scored the results. The cases also come from the repository the failure-memory lens was drawn from.

## Not adopted: a change-coverage lens

A follow-up test added a "change coverage" lens to Thermos, inspired by a community code-review skill. It did not improve recall, so it was not adopted.

## Next

[Deliver](/skills/deliver/), [Thermos](/skills/thermos/), or [harden review](/what-it-does/harden-review/).
