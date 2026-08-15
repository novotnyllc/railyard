---
layout: default
title: Fleet
nav_order: 5
---

# Fleet

Run the fleet as a set of accountable hosts, each converging from readable intent and publishing its own proof. Shared policy gives operators reach; signed trust, paced adoption, and host-owned evidence keep that reach explainable, so the fleet runs unattended with a durable answer to what changed, why, and where it landed.

The fleet surface centers on a readable store and host-owned evidence. The standalone product section is [Roundhouse](/roundhouse/), which owns this operating model beyond delivery placement.

- [Roundhouse store](/roundhouse/store/) — the layered desired-state repository.
- [Roundhouse convergence](/roundhouse/convergence/) — one edit from source to applied state.
- [Roundhouse security](/roundhouse/security/) — roster, signing ratchet, enrollment, and revocation.
- [Roundhouse operating](/roundhouse/operating/) — commands, cadence, doctor, and journals.

## Windows fleet mechanisms

Keep interactive profile work, unattended profile convergence, and machine privilege as separate Windows identities. Codex remote control owns visible native tasks in a saved project. `RoundhouseProfileV1` owns logged-off profile convergence as the configured ordinary user through a non-elevated S4U task. The protected broker owns only sealed machine actions in `windows-system-v1`.

Build a managed profile payload with the native CLI:

```text
roundhouse profile-bundle SPEC.json SOURCE-ROOT OUTPUT.bundle
```

The bundle's bounded contents are authorized config scalars, standalone skills, agent definitions, and local marketplace desired records. `register-profile-task-windows.ps1` registers the `RoundhouseProfileV1` S4U task for the profile SID; `profile-worker-windows.ps1` reopens and verifies the bundle before applying managed state. The task is non-elevated and local-profile scoped, which keeps profile authority distinct from machine authority.

Machine actions use `privilege-broker-windows.ps1` as LocalSystem and the fixed catalog described in [privilege isolation](/roundhouse/security/privilege-isolation/). The owner-operated `enroll-privilege-windows.ps1` ceremony installs that protected generation. A separate `enroll-windows-sftp.ps1` ceremony creates the dedicated standard `RoundhouseRequest` SID, CA/KRL trust, chroot, four fixed ingress slots, task definitions, ACLs, quota, OpenSSH restriction, and managed firewall boundary.

The `windows-sftp` lane carries signed requests through `ForceCommand internal-sftp`; it is the protected broker transport, while [Codex remote control](/integrations/codex-remote-control/) remains the native interactive-user lane. Native canaries prove the broker, profile task, transport, and protected generation on Windows itself.

```text
profile_task=RoundhouseProfileV1 identity=ordinary-user-s4u elevation=none
profile_bundle=verified managed_entries=4
broker=windows-system-v1 transport=windows-sftp
request_identity=RoundhouseRequest native_canary=passed
```

[Desired state](/desired-state/) gives the same model a short reader path. The [Roundhouse repository](https://github.com/novotnyllc/roundhouse) carries its release and review evidence.
