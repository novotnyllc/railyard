---
layout: default
title: Review bakeoff
parent: Delivery
nav_order: 5
---

# Review bakeoff

The end-of-PR review is [Thermos](/skills/thermos/) plus `codex review`. A small bakeoff on past Railyard and Roundhouse bugs chose that pairing: Thermos caught the most bugs at moderate cost, and `codex review` is fast and caught a bug that no other tool found.

## Method

The cases were five past Railyard and Roundhouse commits whose bugs were later fixed. A control commit was later found to contain real merge-gate bypasses. Each tool reviewed each pre-fix commit once, and every Claude arm ran on Opus 5.5.

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

Cost per case:

| Tool | Tokens | Wall time |
| --- | --- | --- |
| Thermos | about 0.5–0.9M | 3–11 min |
| Compound Engineering `ce-code-review` | about 1.2–2M | 12–22 min |
| `codex review` | — | 1–7 min |

## Why Thermos won

- Reviewers proved their findings with probes.
- It uses a few broad lenses, each with whole-file context.
- It has no synthesis step that drops findings. Compound Engineering demoted two real bugs that its own Codex pass had found.
- The failure-memory lens targets fail-open checks, the dominant bug shape.

`codex review` is cheap by comparison, and its Astra run found the one bug nothing else caught.

## Caveats

The sample is small, each tool ran once per case, and one grader scored the results. The cases also come from the repository the failure-memory lens was drawn from, which may favor Thermos.

## Not adopted: a change-coverage lens

A follow-up test added a "change coverage" lens to Thermos, inspired by a community code-review skill. It did not improve recall, so it was not adopted.

## Next

[Thermos](/skills/thermos/) or [harden review](/what-it-does/harden-review/).
