---
layout: default
title: Trust ratchet
parent: Roundhouse
nav_order: 5
---

# The roster advances only from trusted history

Every receiving host in an unattended fleet should derive authority from the same signed point in history before a change earns its canary gate, so membership remains deterministic across merges, offline returns, and revocation. That shared answer lets the fleet advance autonomously while preserving an exact account of who could write each path.

Roundhouse makes a roster edit count only when a key trusted by the roster at the commit's parent signs it. A merge checks every parent independently. This parent-position rule gives every receiving host the same answer about who could write at the exact history position being adopted.

## Decision path

**Action arrives:** a signed commit proposes a roster or fleet-layer change. **Authority check:** each host verifies signature identity, the roster at every parent position, current membership, KRL status, and path class. **Propagation gate:** merges require every parent to admit the signer before the roster can advance. **Outcome:** trusted history advances; an unknown or class-refused signer produces `result=HELD reason=principal-not-in-parent-roster` and leaves the reviewed roster in place. **Residual:** instruction-chain compromise remains an operator-held risk, while the receipt keeps the technical authority decision exact.

![Trust ratchet parent rule: every parent verifies a roster edit before the roster advances; unknown, removed, or class-refused signers are held and alerted.](/diagrams/m3-trust-ratchet.svg)

The sequence reads left to right for the decision and top to bottom for the resulting host action: accepted history advances the roster, while a refusal keeps held items at their last reviewed value.

## Six checks per commit

Before a commit can advance the roster, each receiving host proves six facts:

1. The signature is cryptographically good.
2. The signature identity equals the committer identity.
3. The principal appears in the roster derived from every parent.
4. The principal remains present at the current reviewed head.
5. The principal is absent from the KRL.
6. The membership class permits every touched path.

For a merge, an any-parent proof that admits a removed member is a held result. Every parent must verify independently before the roster advances.

## Membership is the boundary

Give each signer only the reach its job requires:

| Class | Fleet-layer writes | Own host evidence | Sponsorship |
| --- | --- | --- | --- |
| `durable` | allowed | allowed | may sponsor durable and ephemeral members |
| `ephemeral` | held | allowed for its own host-keyed paths | cannot sponsor; the graph stays one hop deep |

Signing keys belong to the commit's author. If another host rewrites the commit, the rewrite strips the original signature and records only authorship it can prove.

Revocation freezes a key's position in future history while preserving the validity of past commits. The KRL is the deliberate exception: it burns the key's history too. TTL is hygiene; membership class remains the authority boundary.

## Worked receipt

An anonymized fleet accepts a durable enrollment and a skill update. When an unknown key later tries to rewrite the roster, every host needs the same held outcome and the same named principal for operator action:

```text
commit=enroll-01 parent=genesis signer=durable-key result=accepted roster=host-a
commit=write-02 parent=enroll-01 signer=durable-key path=skills.my-review result=accepted
commit=roster-03 parent=write-02 signer=unknown-key path=trust/signers.yaml result=HELD
reason=principal-not-in-parent-roster alert=unknown-key
```

The held roster edit leaves the last reviewed roster in place and names the principal for operator action. A valid addition can advance only from a trusted parent position.
