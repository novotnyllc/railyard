---
layout: default
title: Delivery
nav_order: 4
has_children: true
---

# Delivery

Use native tools for routine work and focused Compound Engineering workflows for planning, debugging, review, or PR delivery.

When the user or repository owner has authorized automatic delivery, implementation and fix requests continue through confirmed merge. Narrower approval requirements and repository holds take precedence. Shipping requests and repository requirements can extend delivery through release or deployment and consumer verification. Local-only and plan-only requests stop at their stated endpoint. CE owns PR feedback and CI.

Native subagents handle bounded parallel work. Fleet/account orchestration is explicit, and visible tasks are created only when the user asks for them. Select LFG or paired review when the change calls for it.

- [Lifecycle](/delivery/lifecycle/) — native work and the selected shipping path.
- [Work across harnesses](/what-it-does/work-across-harnesses/) — coordinate different implementation engines from one chat.
- [Gates](/delivery/gates/) — proportional verification and one owner for review settlement.
- [Review bakeoff](/delivery/review-bakeoff/) — why the optional full review pairs Thermos with `codex review`.

The [ship a change scenario](/what-it-does/ship-a-change/) shows an authorized PR delivery. Machine readiness and convergence are documented separately under [Roundhouse](/roundhouse/).
