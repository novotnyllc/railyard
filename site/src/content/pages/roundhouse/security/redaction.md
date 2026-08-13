---
layout: default
title: Redaction
parent: Roundhouse
nav_order: 8
---

# Keep secrets out of the store before publication

Fleet evidence must remain safe to replicate across unattended hosts and canary gates, so scan each signed commit at the publication boundary while sensitive bytes are still local and recoverable. Operators get useful receipts and alerts while the shared store stays free of secret values.

Roundhouse's redaction floor scans every commit before it can publish. It combines named secret classes, an entropy check, and a 400-byte cap, then sweeps findings, alerts, commit descriptions, and trailers for that commit. A match refuses the push while the sensitive value is still local.

## Per-commit boundary

Attach the scan to the exact publication decision. It follows the new commit, not a range diff, and includes metadata surfaces that often carry copied command output. The remedy happens before publication; a later un-publish cannot retract bytes already sent.

```text
commit=write-02
scan=secret-classes+entropy
surfaces=findings,alerts,description,trailers
cap=400-bytes
result=refused
reason=secret-class-match
action=keep-local-and-rewrite
```

The 400-byte cap bounds the scanned candidate and prevents a large opaque blob from becoming an unreviewed bypass. The entropy test filters ordinary prose while the named classes preserve precision for known secret shapes.

## Operator receipt

An operator who accidentally carries a secret-shaped value in a trailer gets a local, actionable refusal with the class, surface, size, and entropy signal:

```text
[roundhouse] push refused: commit write-02 contains a redaction finding
class=named-secret-class surface=trailers bytes=48 entropy=high
publication=stopped
```

The only successful publication receipt is a commit with a clean per-commit scan. The store and its journals therefore contain the decision without carrying the secret value.

Next: [privilege isolation](/roundhouse/security/privilege-isolation/) or [trust ratchet](/roundhouse/security/trust-ratchet/).
