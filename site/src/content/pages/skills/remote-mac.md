---
layout: default
title: Remote Mac
parent: Skills
nav_order: 18
---

# Remote Mac

Remote Mac gives one remote operation a named, reconnectable session with identity, shell, directory, command, and log evidence.

## What it adds

The skill checks the destination first, uses the configured login shell, starts long work inside a named tmux session, and returns the session and log handles for follow-up.

## How it works

Read-only checks establish the target identity and transport. The operator can inspect the session, collect its result, and hand off the evidence to delivery or fleet operations.

## Scope

Remote Mac owns one bounded remote Mac operation. Fleet placement, SSH diagnosis, and Windows-specific transport contracts stay with their owning surfaces.

## Source

Ships in the `roundhouse` plugin. Source: `plugins/roundhouse/skills/remote-mac/SKILL.md`.

## Proof point

The source skill defines destination checks, login-shell execution, Tailscale-aware transport, and named tmux sessions.

Next: [administer remotely](/what-it-does/administer-remotely/).
