---
layout: default
title: Audit
parent: Delivery
nav_order: 4
---

# Audit

Use an audit when requested or when a substantial run leaves a concrete question about decisions, quality, latency, or cost. Routine work needs a clear result and verification; it does not need a separate audit or retrospective artifact.

## Read the evidence that exists

The audit can combine route metadata, dispatches, checks, review findings, retries, Git state, PR state, and post-merge proof. It separates observed facts from requested settings and unresolved state. A missing receipt remains missing; an offline route decision does not prove which model ran.

Existing logs are usually enough. Optional metadata notes can preserve consequential decisions without recording prompts, diffs, provider output, or secrets:

```sh
RAILYARD_PLUGIN_ROOT=/path/to/railyard/plugin
node "$RAILYARD_PLUGIN_ROOT/hooks/run-log.js" note \
  '{"event":"decision","what":"focused follow-up","because":"review identified one affected behavior"}'
```

## Compare completed assignments

Model and effort choices should be evaluated against comparable accepted results. Include all subagents, retries, repairs, verification, elapsed time, and available usage data. A lower per-token rate or slower quota burn does not establish a lower cost per completed task.

Astra Max is a baseline candidate for substantive engineering, not a claim of universal cost superiority. Missing or incomparable cost data should be reported explicitly.

## Optional learning

Capture a repository lesson through `compound-engineering:ce-compound` when it is useful. Configured local routing learning remains optional and content-free; it cannot expand authority, change privacy, raise budgets, or rewrite policy.

The [Audit skill](/skills/audit/) explains how to reconstruct a run. [Model-routing learning](/delivery/model-routing/learning/) documents the advanced local aggregate store.
