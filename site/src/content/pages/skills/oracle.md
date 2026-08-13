---
layout: default
title: Oracle
parent: Skills
nav_order: 5
---

# Oracle

Oracle adds an advisory second-model review with the selected files and real source context attached.

## What it adds

The skill packages a prompt, file set, route claim, and budget context for a second frontier model, then returns a checkpointed advisory result for verification by the owning workflow.

## How it works

Availability is established through its selected carrier. Sessions can be reattached by claim, files are selected explicitly, and the result is checked against the repository and tests before it influences a change.

```text
> Ask Oracle for a read-only review of the selected parser files and return findings tied to the claim.
carrier=oracle-browser model=chatgpt_current_pro surface=chatgpt_standard
files=parser.mjs,parser.test.mjs  claim=claim-opaque-01
egress=selected-route  mutation=none
```

## Scope

Oracle advises. The repository workflow owns implementation, verification, and merge authority.

## Source

Ships in the `railyard` plugin.

## Proof point

```text
claim=claim-opaque-01 receipt=oracle-opaque-01
files_digest=sha256:12af... findings=2
repository_check=owner-verified merge_authority=workflow
result=advisory
```

Next: [read harden review](/what-it-does/harden-review/).
