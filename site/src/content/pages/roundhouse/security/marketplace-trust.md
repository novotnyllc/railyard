---
layout: default
title: Marketplace trust
parent: Security
nav_order: 12
---

# Marketplace trust

The [shared marketplace](https://github.com/novotnyllc/marketplace) is a public, reviewable repository that owns plugin version pinning under the trust ratchet. Inspect its catalog and release history before accepting a plugin update; the catalog is part of the evidence chain, not an invisible download step.

## Dependencies disclosed at install

Railyard depends on [Compound Engineering (EveryInc)](https://github.com/EveryInc/compound-engineering-plugin) for the workflow engine used by delivery. It depends on [ponytail (DietrichGebert)](https://github.com/DietrichGebert/ponytail) for the efficiency discipline carried into implementation and verification.

The grouped marketplace install is the consent step for both dependencies. This page documents the dependency boundary; it does not change install behavior.

## What to review

- Confirm the marketplace entry names the expected repository and plugin version.
- Compare the pinned version with the release and review trail of the owning repository.
- Treat a changed marketplace SHA as a new review decision, even when the version string stays the same.
- Keep signing, enrollment, and privileged host actions under their own explicit consent boundaries.
