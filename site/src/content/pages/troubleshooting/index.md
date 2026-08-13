---
layout: default
title: Troubleshooting
nav_order: 4
---

# Troubleshooting

Use the failure's owning surface to recover. Keep the receipt, run log, and exact command that failed so the next check can distinguish a missing prerequisite from a held decision.

## Install failures

- **Marketplace add fails:** check authentication, network access, and the exact `novotnyllc/marketplace` slug. Retry the Claude Code or Codex marketplace command from [Install](/start/install/).
- **The plugin is already installed:** confirm the installed entry points at the expected marketplace, then update it through the same harness instead of creating a second copy.
- **The CLI is too old:** update Claude Code or Codex until its plugin marketplace command is available. The Codex equivalent is `codex plugin marketplace add`.
- **A plugin is present but a skill is missing:** run the harness plugin listing, restart the harness, and verify the plugin source before retrying the request.

## First-delivery failures

- **The skill cannot be found:** finish [Install](/start/install/) and confirm `railyard` is listed before asking for a delivery.
- **There is no GitHub remote:** verify `origin` before requesting a pull request. A local delivery can still run checks and report the missing publish step.
- **The repository has no test suite:** let the route choose the smallest existing verification command and record that no focused check is available when none exists.
- **The review gate is stuck:** inspect [delivery gates](/delivery/gates/) for unresolved review threads, settlement timing, or a missing post-merge proof.

## Fleet and Roundhouse failures

- **The agent cannot reach a host:** run [SSH Doctor](/skills/ssh-doctor/) and repair the first failing transport layer before changing enrollment.
- **Enrollment expired or was rejected:** inspect [enrollment and TOFU](/roundhouse/security/enrollment-and-tofu/), keep the old authority in place, and repeat the ceremony after its prerequisites are current.
- **The sponsor channel is unreachable:** restore the already-trusted channel. Do not substitute an unverified first contact.
- **Key generation failed:** generate the key on the target host, keep the private key there, and restart possession proof. The [enrollment recovery guide](/roundhouse/security/enrollment-and-tofu/#failure-and-recovery) names the recovery path.

## Where to look

The run log records the route, dispatches, checks, review rounds, retries, and terminal result. The delivery receipt identifies the merge and post-merge proof. For diagnosis, start with [Doctor](/skills/doctor/) and [SSH Doctor](/skills/ssh-doctor/); for a fleet-wide readiness question, use [Fleet readiness](/skills/fleet-readiness/).
