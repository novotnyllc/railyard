---
layout: default
title: Oracle
parent: Skills
nav_order: 5
---

# Oracle

Use a second frontier model as a bounded advisor: attach the exact files and source context, preserve the route claim, and verify every finding in the repository. The extra perspective strengthens judgment while implementation and merge authority remain with the owning workflow.

## What it adds

Oracle packages a prompt, file set, route claim, and budget context for a second frontier model, then returns a checkpointed result for verification by the owning workflow.

## How it works

The selected carrier establishes availability. Sessions can be reattached by claim, files are selected explicitly, and the result is checked against the repository and tests before it influences a change.

```text
> Ask Oracle for a read-only review of the selected parser files and return findings tied to the claim.
carrier=oracle-browser model=chatgpt_current_pro surface=chatgpt_standard
files=parser.mjs,parser.test.mjs  claim=claim-opaque-01
egress=selected-route  mutation=none
```

## Scope

Oracle advises. The repository workflow owns implementation, verification, and merge authority.

## Setup knobs

Resolve `ORACLE_CLI` once per activation from the shipped `ensure-oracle.sh` helper and use that validated absolute executable for later help, preflight, review, status, and reattach commands. `ORACLE_MODEL` selects one normal browser or API target; browser Pro uses the `gpt-5-pro` picker alias. `ORACLE_MODELS` supplies an explicit model set for API preflight or an advisory panel. `ORACLE_REPO` points only at an Oracle source checkout when debugging or rebuilding Oracle itself.

```text
ORACLE_CLI=/validated/absolute/oracle
ORACLE_MODEL=gpt-5-pro
ORACLE_MODELS=model-a,model-b
ORACLE_REPO=/developer/source/oracle
```

Routed `oracle-browser` reviews keep their own fixed carrier binding and ignore caller model/path overrides; the setup knobs above serve the ordinary manual Oracle workflow.

## Source

Ships in the `railyard` plugin.

## Proof point

```text
claim=claim-opaque-01 receipt=oracle-opaque-01
files_digest=sha256:12af... findings=2
repository_check=owner-verified merge_authority=workflow
result=advisory
```
