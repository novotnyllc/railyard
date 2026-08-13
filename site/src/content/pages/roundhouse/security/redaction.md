---
layout: default
title: Redaction
parent: Roundhouse
nav_order: 8
---

# Keep secrets out of the store before publication

The redaction floor scans every commit before it can publish. It combines named secret classes, an entropy check, and a 400-byte cap, then sweeps findings, alerts, commit descriptions, and trailers for that commit. A match refuses the push while the sensitive value is still local.

## Per-commit boundary

The scan follows the new commit, not a range diff. That keeps a finding attached to the exact publication decision and includes metadata surfaces that often carry copied command output. The remedy happens before publication; a later un-publish cannot retract bytes already sent.

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

```text
[roundhouse] push refused: commit write-02 contains a redaction finding
class=named-secret-class surface=trailers bytes=48 entropy=high
publication=stopped
```

The only successful publication receipt is a commit with a clean per-commit scan. The store and its journals therefore contain the decision without carrying the secret value.

Next: [privilege isolation](/roundhouse/security/privilege-isolation/) or [trust ratchet](/roundhouse/security/trust-ratchet/).
