---
layout: default
title: Orchestrate
parent: Skills
nav_order: 2
---

# Orchestrate

Orchestrate turns a multi-lane objective into dependency-aware work placed on machines with current readiness evidence.

## What it adds

The skill classifies each turn, freezes an objective and acceptance contract, consults fleet readiness, creates bounded lanes, and tracks each lane to a terminal result.

## How it works

Host, task, and transport evidence feed placement. Dependency-ready lanes can start together, while handoffs carry the same scope, owner, constraints, and evidence contract.

## Scope

Orchestrate owns decomposition, placement, coordination, and synthesis. Delivery owns implementation inside each software lane; remote administration owns one-host operating work.

## Source

Ships in the `railyard` plugin. Source: `plugins/railyard/skills/orchestrate/SKILL.md`.

## Proof point

The source requires readiness before a remote task is created and preserves a frozen contract through the task graph.

Next: [run work on another machine](/what-it-does/run-work-on-another-machine/).
