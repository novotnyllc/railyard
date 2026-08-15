---
layout: default
title: SSH automation identity
parent: Roundhouse
nav_order: 11
---

# Give automation a fixed certificate lane

Separate the identity that requests fleet work from the owner identity that signs it. Each node keeps one private key locally, an isolated owner account keeps the offline fleet CA, and enrolled endpoints accept only finite certificates with fixed principals, source restrictions, revocation state, and `ForceCommand` dispatch.

## The run

The operator prepares a node identity, carries only the public request to the isolated signer, inspects the manifest, signs a finite certificate, and enrolls the public trust on a POSIX endpoint. The turn is the offline signing ceremony: the helper digest, principals, source CIDRs, serial, validity, and CA generation are reviewed before the CA acts. The run closes when the endpoint canary accepts the fixed automation principal and the KRL generation is current.

## Three bounded steps

```text
prepare-ssh-identity prepare
certify-ssh-node status
certify-ssh-node sign
enroll-ssh-posix
```

`roundhouse prepare-privilege-identity` wraps the fixed preparation helper and emits a public certificate request plus preparation record. The passphrase-less Ed25519 private key remains in a nonsynced, owner-only state directory on the originating node.

The isolated signer obtains the expected `certify-ssh-node` digest through a separate trusted path, compares it with its protected helper record, hashes the executing helper, and inspects the public manifest before signing. The fleet CA private key stays outside fleet nodes, service accounts, ordinary agent configuration, and unattended secret access.

`enroll-ssh-posix` installs the public CA, KRL, principals, and fixed dispatcher on the target through the owner-operated enrollment boundary. The resulting lane bypasses ambient SSH configuration and agents; host key, node certificate, principal, management network, and fixed command all remain explicit.

## ForceCommand is the authority surface

The certificate opens the named Roundhouse request lane. POSIX endpoints route the fixed principal through `ForceCommand`; Windows uses the same certificate identity for its dedicated SFTP request account. The dispatcher receives a signed semantic request and the privilege broker decides among cataloged actions.

Certificates expire. Renewal prepares a replacement locally, canaries it against representative POSIX and Windows endpoints, and switches the overlay after those checks. Revocation publishes an owner-generated KRL whose generation is confirmed on every target; CA rotation uses a dual-trust window until the new public trust and renewed nodes are proven.

```text
node=node-opaque private_key=local-only
certificate_principal=roundhouse-posix validity=finite
source_restriction=management-cidr ca_generation=4
endpoint=host-a force_command=roundhouse-dispatch
krl_generation=9 canary=passed
```

[Tailscale SSH](/integrations/tailscale-ssh/) can supply an authenticated network path; this page supplies the automation identity, certificate authority, and fixed-command boundary carried across that path. [Privilege isolation](/roundhouse/security/privilege-isolation/) shows how the semantic request reaches root-owned actions.
