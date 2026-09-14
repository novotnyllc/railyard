---
layout: default
title: Models, effort, and carriers
parent: Delivery
nav_order: 2
---

# Models, effort, and carriers

Select the model and reasoning effort as one decision. Astra Max is the baseline candidate for substantive engineering. Different settings need a reason grounded in the assignment, comparable completed outcomes, a specialist capability, or the user's priorities. There is no built-in assumption that a lower model tier or lower effort completes work more cheaply.

## Native choices

| Choice | Supported use |
| --- | --- |
| `gpt-6-astra` at `max` | Baseline candidate for substantive engineering, including implementation, coordination, and review |
| Explicit inheritance | The parent's model and reasoning effort suit the child; state that reason and use the supported inheritance path |
| Another model or effort | The active harness supports both settings and the assignment justifies the selection |
| Fixed specialist role | Use the role's authoritative model and effort without forbidden overrides |
| Deterministic tool | A mechanical operation can be completed directly without another agent |

For native child creation, full-history forks inherit settings. When overriding model or effort, use `fork_turns: "none"` or a supported bounded turn count and provide a sufficient brief. A native child remains part of its parent task. Creating a visible task requires an explicit user request.

The narrow gate validates the actual native controls. A catalog may record a candidate, but it cannot establish that the active harness supports it. Unsupported selections fail transparently; no silent substitution is allowed.

## Advanced carriers

The configured routing system retains specialized carriers for explicit account, fleet, or advisory work. These rows describe capability boundaries, not current live availability.

| Carrier or adapter | Boundary |
| --- | --- |
| `codex-astra` / native subagent | Native Astra selection when exposed by the current harness |
| Configured alternate native models | Must match the current supported model and effort controls |
| `codex-task-create` / `codex-task-message` | Visible task transport; creation requires the user's explicit request and verified destination capability |
| Configured GLM task profiles | Codex-only profile transport, subject to host attestation; not an invented native model selector |
| CE Claude review adapter | Uses CE's existing supported review seam; no parallel Railyard review runner |
| `oracle-browser` | Optional local browser advisor; requires selected-route capability and observed UI evidence |
| `oracle-homebrew-lifecycle` | Separate local install/upgrade capability; installation does not prove a subsequent review can run |

A change in provider also needs valid privacy and transport evidence. A matching model label does not prove that collaboration surfaces share a decryption boundary.

## Operator-owned tiers

Configured `roles` can retain ordered `tiers` and permitted soft priorities. The operator's order and hard requirements control eligibility. Soft cost, latency, quality, reliability, or learned estimates can compare candidates only within the allowed tier; they cannot create a fallback, expand privacy, or invent live capability.

Unknown cost is not zero. Subscription allowance, API charges, model usage, latency, and elapsed deadline remain separate measures. Do not derive a general cheap/medium/hard routing table from model names or per-token prices.

See [policy configuration](/delivery/model-routing/policy/) and [budgets and receipts](/delivery/model-routing/budgets/) for the advanced controls.
