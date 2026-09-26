---
layout: default
title: Oracle
parent: Skills
nav_order: 5
---

# Oracle

Oracle gets a second opinion on a concrete question. It sends a scoped prompt and the selected files to GPT-6 Pro in the ChatGPT browser, using the `oracle` CLI. Use it when another model's perspective helps or the user asks for one. Verify its findings against the repository; the current workflow still owns implementation and completion.

## How it works

The skill runs `ensure-oracle.sh` once per activation. The script installs or validates Oracle 0.20.3 or later and returns an absolute executable path, which every later command uses. A browser consult selects the `Latest` model and Pro thinking:

```sh
"$ORACLE_CLI" --engine browser --model gpt-6-pro \
  --browser-model-strategy select --browser-thinking-time pro \
  --prompt "Review the selected parser for cancellation errors." --file parser.mjs
```

The browser needs a signed-in ChatGPT account with Pro access. If Oracle hits a login or account-selection screen, it stops without interacting. A long session is reattached, never resubmitted.

## Setup knobs

- `ORACLE_BIN` points at an existing Oracle executable to validate instead of installing one.
- `ORACLE_MODEL` / `ORACLE_MODELS` pick a manual target or an explicit API model set.
- `ORACLE_REPO` points at an Oracle source checkout, for Oracle development only.

## Scope

Oracle advises; it isn't a routine review gate. The selected controls are verified in the observed browser session, and that doesn't prove which backend model answered. Nothing falls back silently to another model, provider, or effort.

## Source

Ships in the `railyard` plugin.
