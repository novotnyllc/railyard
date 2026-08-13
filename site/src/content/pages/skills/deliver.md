---
layout: default
title: Deliver
parent: Skills
nav_order: 1
---

# Deliver

Deliver turns an implementation request into a bounded workflow that reaches merge and post-merge proof.

## What it adds

The skill selects the delivery route from the requested artifact, invokes model routing before work starts, and hands implementation to the workflow engine. It owns the requested terminal boundary and the delivery tail that settles review, branch currency, merge, and proof.

## How it works

Route selection distinguishes plan, diagnosis, local implementation, and full delivery outcomes. The implementation path uses isolated work boundaries, focused checks, Thermos review, and a configured GitHub flow.

## Scope

One host-local implementation or pull-request lane belongs here. Multi-lane or cross-host placement belongs to [Orchestrate](/skills/orchestrate/).

## Source

Ships in the `railyard` plugin. Source: `plugins/railyard/skills/deliver/SKILL.md`.

## Proof point

The delivery source defines merge ancestry plus a real post-merge check as the terminal proof pair.

Next: [read the lifecycle](/delivery/lifecycle/).
