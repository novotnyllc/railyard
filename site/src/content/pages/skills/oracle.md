---
layout: default
title: Oracle
parent: Skills
nav_order: 5
---

# Oracle

Use Oracle as an optional, bounded advisor when another perspective can answer a concrete question. Attach the relevant files and context, then verify findings in the repository. The selected CE or native workflow retains implementation and completion ownership.

## What it adds

Oracle packages a prompt and file set for a selected model and returns an advisory result. Manual use does not require the routed accounting lifecycle. Explicit routed use additionally preserves the route claim and budget context.

## How it works

Check the selected Oracle mode and current host capability before use. Browser controls, API models, and native-agent settings are distinct surfaces. Files are selected explicitly, and findings are checked against the repository before they influence a change.

```text
> Ask Oracle for a read-only review of the selected parser files and return findings tied to the claim.
carrier=oracle-browser model=chatgpt_current_pro surface=chatgpt_standard
files=parser.mjs,parser.test.mjs  claim=claim-opaque-01
egress=selected-route  mutation=none
```

## Scope

Oracle advises. The repository workflow owns implementation, verification, and merge authority.

## Setup knobs

Resolve `ORACLE_CLI` through the shipped `ensure-oracle.sh` helper and use the validated absolute executable for subsequent commands. `ORACLE_MODEL` selects a manual browser or API target; `ORACLE_MODELS` supplies an explicit API model set. `ORACLE_REPO` points only at an Oracle source checkout for Oracle development.

```text
ORACLE_CLI=/validated/absolute/oracle
ORACLE_MODEL=gpt-6-pro
ORACLE_MODELS=model-a,model-b
ORACLE_REPO=/developer/source/oracle
```

Routed `oracle-browser` reviews keep their own fixed carrier binding and ignore caller model/path overrides; the setup knobs above serve the ordinary manual Oracle workflow.

Oracle 0.20.3+ can select the browser's Latest model control and Pro thinking with:

```sh
"$ORACLE_CLI" --engine browser --model gpt-6-pro \
  --browser-model-strategy select --browser-thinking-time pro \
  --prompt "Review the selected parser for cancellation errors." --file parser.mjs
```

Those settings must be verified in the observed browser controls. They do not prove a native or API backend model identity. An explicit API Astra assignment instead selects `gpt-6-astra`, `--reasoning-mode standard`, and `--reasoning-effort max` on the OpenAI API surface. No automatic API, provider, or lower-effort fallback is implied.

## Source

Ships in the `railyard` plugin.

## Illustrative routed result

```text
claim=claim-opaque-01 receipt=oracle-opaque-01
files_digest=sha256:12af... findings=2
repository_check=owner-verified merge_authority=workflow
result=advisory
```
