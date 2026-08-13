---
layout: default
title: Trust ratchet
parent: Roundhouse
nav_order: 5
---

# The roster advances only from trusted history

A roster edit counts only when a key trusted by the roster at the commit's parent signs it. A merge checks every parent independently. This parent-position rule gives every receiving host the same answer about who could write at the exact history position being adopted.

## Six checks per commit

1. The signature is cryptographically good.
2. The signature identity equals the committer identity.
3. The principal appears in the roster derived from every parent.
4. The principal remains present at the current reviewed head.
5. The principal is absent from the KRL.
6. The membership class permits every touched path.

For a merge, an any-parent proof that admits a removed member is a held result. Every parent must verify independently before the roster advances.

## Membership is the boundary

| Class | Fleet-layer writes | Own host evidence | Sponsorship |
| --- | --- | --- | --- |
| `durable` | allowed | allowed | may sponsor durable and ephemeral members |
| `ephemeral` | held | allowed for its own host-keyed paths | cannot sponsor; the graph stays one hop deep |

Signing keys belong to the commit's author. If another host rewrites the commit, the signature is stripped rather than attributed to the rewriting host.

Revocation freezes a key's position in future history while preserving the validity of past commits. The KRL is the deliberate exception: it burns the key's history too. TTL is hygiene; membership class remains the authority boundary.

## Worked receipt

```text
commit=enroll-01 parent=genesis signer=durable-key result=accepted roster=host-a
commit=write-02 parent=enroll-01 signer=durable-key path=skills.my-review result=accepted
commit=roster-03 parent=write-02 signer=unknown-key path=trust/signers.yaml result=HELD
reason=principal-not-in-parent-roster alert=unknown-key
```

The held roster edit leaves the last reviewed roster in place and names the principal for operator action. A valid addition can advance only from a trusted parent position.

Next: [anti-rollback](/roundhouse/security/anti-rollback/) or [enrollment and TOFU](/roundhouse/security/enrollment-and-tofu/).
