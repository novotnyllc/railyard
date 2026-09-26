---
layout: default
title: Audit
parent: Delivery
nav_order: 4
---

# Audit

Use an audit when requested or when a substantial run leaves a concrete question about decisions, quality, latency, or cost. Routine work needs a clear result and verification; it does not need a separate audit or retrospective artifact.

## Read the evidence that exists

The audit can combine dispatches, checks, review findings, retries, Git state, PR state, and post-merge proof. It separates observed facts from requested settings and unresolved state. Missing evidence stays missing; a dispatch argument doesn't prove which model ran.

Existing logs are usually enough. Optional metadata notes can preserve consequential decisions without recording prompts, diffs, provider output, or secrets:

```sh
RAILYARD_PLUGIN_ROOT=/path/to/railyard/plugin
node "$RAILYARD_PLUGIN_ROOT/hooks/run-log.js" note \
  '{"event":"decision","what":"focused follow-up","because":"review identified one affected behavior"}'
```

## Compare completed assignments

Model and effort choices should be evaluated against comparable accepted results. Include all subagents, retries, repairs, verification, elapsed time, and available usage data. A lower per-token rate or slower quota burn does not establish a lower cost per completed task.

The harness defaults (Opus 5.5 at `medium` in Claude Code, GPT-6 Sol at `medium` in Codex) aren't claims of universal cost superiority. Fable 5.1, Astra, and higher effort can fit harder work when the full accepted outcome supports them. Report missing or incomparable cost data explicitly.

## Optional learning

Capture a repository lesson through `compound-engineering:ce-compound` when it is useful. The [Audit skill](/skills/audit/) explains how to reconstruct a run.
