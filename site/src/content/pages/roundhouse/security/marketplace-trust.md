---
layout: default
title: Marketplace trust
parent: Security
nav_order: 12
---

# The change that waited for evidence

An agent item with no state-alignment verb reached the canary gate, where the only accepted proof was `applied`. No host could produce that receipt for the item. The canary journaled `held`, and the downstream host waited on evidence that could never exist. The operating lesson was sharper than the implementation bug: trust needs a truthful positive receipt for “nothing to do,” while a genuine refusal must remain held.

## The run

The operator asks for agent state to converge beyond its canary without turning refusal into success. Roundhouse verifies the exact digest and signed store history, then looks for a canary outcome that proves the item is correct at that digest. The turn came from the real hold cause: this category had no state-alignment verb, so `applied` was impossible even when the desired state was already correct. The recovery introduced `satisfied` as a distinct positive outcome, kept exit 75 as `held`, and reran the two-host real-`jj` fixture. The run closed when the canary and downstream journaled `satisfied` for the same digest while a review hook refused by the trust gate still remained held.

```text
before  canary=held cause="no state-alignment verb; applied receipt impossible"
before  downstream=waiting evidence="could never exist"
recover canary=satisfied gate=accepted-for-same-digest
after   downstream=satisfied outcome=converged
control refused-review-hook=held downstream=waiting
```

That sequence is the anonymized receipt from the [merged Roundhouse recovery](https://github.com/novotnyllc/roundhouse/pull/2): a two-host fixture, the real hold cause, the recovery action, and both terminal paths. No private machine identity or invented recovery receipt enters the story.

## The reviewable boundary

The [shared marketplace](https://github.com/novotnyllc/marketplace) is a public repository that owns plugin version pinning under the trust ratchet. Inspect its catalog and release history before accepting a plugin update; the catalog is part of the evidence chain, not an invisible download step. A changed marketplace SHA is a new decision even when the version label stays the same.

## Dependencies disclosed at install

Railyard depends on [Compound Engineering (EveryInc)](https://github.com/EveryInc/compound-engineering-plugin) for the workflow engine used by delivery. It depends on [ponytail (DietrichGebert)](https://github.com/DietrichGebert/ponytail) for the efficiency discipline carried into implementation and verification.

The grouped marketplace install is the consent step for both dependencies. This page documents the dependency boundary; it does not change install behavior.

## What to review

- Confirm the marketplace entry names the expected repository and plugin version.
- Compare the pinned version with the release and review trail of the owning repository.
- Treat a changed marketplace SHA as a new review decision, even when the version string stays the same.
- For Roundhouse itself, adopt the authenticated release pin with `roundhouse fleet-adopt-pin roundhouse PIN.json` before convergence updates the code that enforces these checks.
- Keep signing, enrollment, and privileged host actions under their own explicit consent boundaries.

The [canary evidence walkthrough](/roundhouse/security/canary-evidence/) carries the general propagation gate, and [attack shapes](/roundhouse/security/attack-shapes/) separates the contained outcome from its residual.
